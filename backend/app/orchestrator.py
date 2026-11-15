import dataclasses
import json
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from app import conversation_service
from app import task_service
from app.agent_actions import ActionGate, redact
from app.ai import registry
from app.ai import fallback as ai_fallback
from app.ai import rotation as ai_rotation
from app.ai.base import AIProvider, Persona, ProviderResult
from app.ai.personas import COORDINATOR, MANAGER, QC_REVIEWER, REVIEWER, persona_for_role
from app.database import SessionLocal
from app.models import Agent, Conversation, Handoff, Message, Plan, QcReview, Task
from app.plan_schema import VALID_ROLES, PlanStep, TaskPlan, extract_json
from app.qc_evidence import build_evidence
from app.qc_schema import criterion_ids, validate_qc_payload
from app.settings_store import (ai_enabled, ai_fallback_enabled, ai_model, ai_model_for,
                                ai_provider, ai_retry_max, ai_timeout_s, get_setting,
                                lease_seconds, max_concurrency, max_parallel_jobs, merge_policy,
                                plan_max_depth, plan_max_steps, rotate_models_enabled,
                                rotate_models_max)
from app.task_service import (add_event, save_result, transition, say,
                              force_transition, claim_task, heartbeat, release_lease,
                              seat_agent, TransitionError)
from app.rooms import room_for_role
from app.tools import repo
from app.tools.workspace import resolve_root

logger = logging.getLogger("agentville.orchestrator")

__all__ = ["Orchestrator", "VALID_ROLES", "PlanStep", "TaskPlan", "extract_json"]


class Orchestrator(threading.Thread):
    """Background scheduler for the office.

    Tick phases:
      1. conversation turn  — a clarifying anchor whose last message is from the user
                              gets a Coordinator reply (ask a question or propose a plan).
      2. approved anchors   — move into the queue.
      3. dispatch           — each queued conversation/anchor is handed to its own worker
                              thread, so several requests run at the same time. Inside a
                              request, independent DAG steps also run concurrently.
    All state changes go through task_service so events, agent status and the transition
    table stay consistent."""

    RETRY_BACKOFF_S = 5.0
    POLL_INTERVAL_S = 1.0
    # One request consumes a slot, so the office never starts more jobs than the configured
    # worker budget; each job may still fan out its own DAG across the steps pool.
    MAX_RUNNING_REQUESTS = 4

    def __init__(self, provider: AIProvider | None = None) -> None:
        super().__init__(daemon=True, name="agentville-orchestrator")
        self._stop_event = threading.Event()
        self._injected_provider = provider
        self._owner = uuid.uuid4().hex[:8]
        # SQLite serialises writes; with concurrent workers we funnel every DB mutation
        # through one lock so parallel steps never clobber each other's row state. The slow
        # part (the provider call) runs outside this lock, so nodes still execute in parallel.
        self._db_lock = threading.RLock()
        # Anchors currently executing in a worker thread, so the next tick does not start
        # the same request twice while it is legitimately in flight.
        self._jobs: dict[int, threading.Thread] = {}
        self._jobs_lock = threading.Lock()

    def stop(self) -> None:
        self._stop_event.set()

    def _provider(self) -> AIProvider:
        if self._injected_provider is not None:
            return self._injected_provider
        with SessionLocal() as db:
            name = ai_provider(db)
            model = ai_model_for(db, name)
            rotate = rotate_models_enabled(db)
        provider = registry.make_provider(name)
        if not rotate:
            return provider
        return self._rotating(provider, name, model)

    # -- engine rotation (quota / limit / gateway failures) -------------------

    def _coding_engines(self) -> set[str]:
        """Installed providers whose CLI can take a coding step."""
        avail = registry.availability()
        return {name for name in registry.PROVIDERS
                if avail.get(name, {}).get("available") and avail.get(name, {}).get("coding")}

    def _rotation_candidates(self, current_name: str, current_model: str) -> list[tuple[str, str]]:
        """Engines to try after the current one is exhausted. Free models first, and never
        the pair that just failed. Providers with no model list still join with the model
        configured for them, so an installed CLI is never left out of the chain."""
        with SessionLocal() as db:
            limit = rotate_models_max(db)
            configured = {name: ai_model_for(db, name) for name in registry.PROVIDERS}
        avail = registry.availability()
        names = [name for name in registry.PROVIDERS if avail.get(name, {}).get("available")]
        models: dict[str, list[str]] = {}
        for name in names:
            try:
                listed = registry.list_models(name)
            except Exception:
                logger.exception("could not list %s models for rotation", name)
                listed = []
            if not listed:
                listed = [configured[name]] if configured.get(name) else []
            models[name] = listed
        return ai_rotation.candidate_chain(current_name, current_model, names, models, limit=limit)

    def _rotating(self, provider: AIProvider, name: str, model: str) -> AIProvider:
        return ai_rotation.RotatingProvider(provider, name, model,
                                            self._rotation_candidates(name, model),
                                            self._coding_engines())

    def _log_switches(self, provider: object, task_id: int, **fields) -> None:
        """Journal every engine swap the run made, so the feed tells the truth about who
        actually finished the work."""
        notes = getattr(provider, "switched", None)
        if not notes:
            return
        seen: set[str] = set()
        with self._db_lock, SessionLocal() as db:
            for note in notes:
                if note in seen:
                    continue
                seen.add(note)
                add_event(db, task_id, "provider_switched", note, **fields)
            db.commit()

    def run(self) -> None:
        self.recover_interrupted()
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("orchestrator tick failed")
            self._stop_event.wait(self.POLL_INTERVAL_S)
        self._join_jobs()

    def _join_jobs(self, timeout: float = 5.0) -> None:
        with self._jobs_lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.join(timeout=timeout)

    def _prune_jobs(self) -> None:
        with self._jobs_lock:
            for anchor_id, job in list(self._jobs.items()):
                if not job.is_alive():
                    self._jobs.pop(anchor_id, None)

    def recover_interrupted(self) -> None:
        with SessionLocal() as db:
            for task in db.query(Task).filter(Task.status == "running").all():
                force_transition(db, task, "failed", "Run interrupted by backend restart", "interrupted")

    def _tick(self, wait: bool = True) -> None:
        """One scheduling pass.

        `wait=True` runs this pass synchronously (deterministic for tests and for callers
        that want the work finished). The live worker loop uses wait=False so the next
        conversation turn is not blocked by long-running jobs."""
        self._prune_jobs()
        with SessionLocal() as db:
            if not ai_enabled(db):
                return
            # phase 0: approved conversation anchors join the queue
            for anchor in (db.query(Task)
                           .filter(Task.run_mode == "conversation", Task.status == "approved")
                           .order_by(Task.id).all()):
                transition(db, anchor, "queued", "Approved plan queued for execution")
            # phase 1: one conversation turn per tick (cheap text call, keeps ordering simple)
            turn = self._next_conversation_turn(db)
            if turn is not None:
                anchor_id, conv_id, timeout_s = turn
                jobs = []
            else:
                jobs = self._claim_jobs(db)
        if turn is not None:
            self._conversation_turn(anchor_id, conv_id, timeout_s)
            return
        self._start_jobs(jobs, wait=wait)

    def _claim_jobs(self, db) -> list[tuple[int, str, str, int]]:
        """Mark every queued anchor as running and return the work each job should do."""
        with self._jobs_lock:
            in_flight = {aid for aid, job in self._jobs.items() if job.is_alive()}
        budget = max(1, max_parallel_jobs(db)) - len(in_flight)
        jobs: list[tuple[int, str, str, int]] = []
        if budget <= 0:
            return jobs
        queued = (db.query(Task)
                  .filter(Task.parent_id.is_(None), Task.status == "queued",
                          Task.run_mode.in_(["ai", "ai_plan", "conversation"]))
                  .order_by(Task.id).all())
        for task in queued:
            if len(jobs) >= budget:
                break
            if task.id in in_flight:
                continue
            run_mode = task.run_mode
            qc_rerun = bool(task.qc_rerun_requested) and run_mode == "conversation"
            model = ai_model(db)
            timeout_s = ai_timeout_s(db)
            transition(db, task, "running", "QC rerun started" if qc_rerun else "AI run started")
            jobs.append((task.id, "conversation_qc" if qc_rerun else run_mode, model, timeout_s))
        return jobs

    def _start_jobs(self, jobs: list[tuple[int, str, str, int]], wait: bool = True) -> None:
        """Run each request on its own thread so several jobs share the office at once."""
        if not jobs:
            return
        errors: list[BaseException] = []

        def run_job(anchor_id: int, run_mode: str, model: str, timeout_s: int) -> None:
            try:
                if run_mode == "conversation_qc":
                    self._execute_conversation_qc(anchor_id, timeout_s)
                elif run_mode == "conversation":
                    self._execute_conversation(anchor_id, timeout_s)
                else:
                    self._execute(anchor_id, run_mode, model, timeout_s)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
                logger.exception("job %s failed", anchor_id)
                self._abort_anchor(anchor_id, f"Worker crashed: {exc}")

        threads: list[threading.Thread] = []
        for anchor_id, run_mode, model, timeout_s in jobs:
            job = threading.Thread(target=run_job, name=f"agentville-job-{anchor_id}",
                                   args=(anchor_id, run_mode, model, timeout_s), daemon=True)
            with self._jobs_lock:
                self._jobs[anchor_id] = job
            job.start()
            threads.append(job)
        if wait:
            for job in threads:
                job.join()

    # -- conversation turns --------------------------------------------------

    def _next_conversation_turn(self, db) -> tuple[int, int, int] | None:
        """Anchors in 'clarifying' whose newest message is from the user need a Coordinator reply."""
        anchors = (db.query(Task)
                   .filter(Task.run_mode == "conversation", Task.status == "clarifying")
                   .order_by(Task.id).all())
        for anchor in anchors:
            if not anchor.conversation_id:
                continue
            last = (db.query(Message)
                    .filter(Message.conversation_id == anchor.conversation_id)
                    .order_by(Message.id.desc()).first())
            if last is not None and last.role == "user":
                return anchor.id, anchor.conversation_id, ai_timeout_s(db)
        return None

    def _transcript(self, db, conversation_id: int) -> str:
        messages = (db.query(Message).filter(Message.conversation_id == conversation_id)
                    .order_by(Message.id.desc()).limit(20).all())
        lines = []
        for msg in reversed(messages):
            who = "User" if msg.role == "user" else ("Assistant" if msg.role == "assistant" else "System")
            lines.append(f"{who}: {msg.content[:1200]}")
        return "\n".join(lines)

    def _store_assistant_reply(self, conversation_id: int, anchor_id: int, event_type: str, text: str) -> None:
        with SessionLocal() as db:
            msg = Message(conversation_id=conversation_id, role="assistant", content=text)
            db.add(msg)
            add_event(db, anchor_id, event_type, text[:300], conversation_id=conversation_id)
            db.commit()
            # Telegram conversations are two-way: every Coordinator reply must also reach
            # the originating chat. The outbox dedupe key makes restarts/retries safe.
            from app.channels import outbox
            outbox.enqueue(db, conversation_id, text, f"assistant-{msg.id}")

    def _conversation_turn(self, anchor_id: int, conversation_id: int, timeout_s: int) -> None:
        provider = self._provider()
        with SessionLocal() as db:
            model = ai_model_for(db, ai_provider(db))
            transcript = self._transcript(db, conversation_id)
        persona = dataclasses.replace(COORDINATOR, model=model)
        prompt = (f"Conversation so far:\n{transcript}\n\n"
                  "Respond to the latest user message with an ask or a proposal.")[:6000]
        result = provider.run(persona, prompt, timeout_s=timeout_s,
                              should_cancel=lambda: self._cancelled(anchor_id))
        self._log_switches(provider, anchor_id, conversation_id=conversation_id)
        if self._cancelled(anchor_id):
            return
        payload = extract_json(result.text) if result.ok else None
        action = payload.get("action") if payload else None
        if action == "ask" and str(payload.get("question", "")).strip():
            self._store_assistant_reply(conversation_id, anchor_id, "coordinator_question",
                                        str(payload["question"]).strip()[:2000])
            return
        if action == "propose":
            try:
                plan = TaskPlan.model_validate(payload.get("plan") or payload)
                with SessionLocal() as db:
                    row = conversation_service.propose_plan(db, conversation_id, plan,
                                                            summary=str(payload.get("summary", "")))
                    conv = conversation_service.get_conversation(db, conversation_id)
                    # The whole plan travels with the proposal: the transcript and Telegram
                    # show scope, owners, order, criteria and the version to approve, and the
                    # outbox splits it at paragraph boundaries if it exceeds one message.
                    text = conversation_service.proposal_message(db, conv, row, plan)
                self._store_assistant_reply(conversation_id, anchor_id, "plan_proposed", text)
                return
            except (ValueError, conversation_service.ConversationError) as e:
                self._store_assistant_reply(conversation_id, anchor_id, "plan_error",
                                            f"I could not turn that into a valid plan ({e}). "
                                            "Tell me a bit more and I will redraft.")
                return
        reason = result.error if not result.ok else "coordinator reply was not a valid ask/propose JSON"
        self._store_assistant_reply(conversation_id, anchor_id, "coordinator_error",
                                    f"(Coordinator error: {str(reason)[:400]}. "
                                    "Send another message to retry.)")

    # -- execution -----------------------------------------------------------

    def _cancelled(self, parent_id: int) -> bool:
        with self._db_lock, SessionLocal() as db:
            parent = db.get(Task, parent_id)
            return parent is not None and parent.status == "cancelled"

    def _call(self, provider: AIProvider, persona: Persona, prompt: str, timeout_s: int,
              parent_id: int) -> ProviderResult:
        result = provider.run(persona, prompt, timeout_s=timeout_s,
                              should_cancel=lambda: self._cancelled(parent_id))
        if not result.ok and result.error != "Cancelled" and "not found" not in (result.error or ""):
            time.sleep(self.RETRY_BACKOFF_S)
            if self._cancelled(parent_id):
                return result
            result = provider.run(persona, prompt, timeout_s=timeout_s,
                                  should_cancel=lambda: self._cancelled(parent_id))
        return result

    def _persona(self, role: str | None, name: str | None, model: str,
                 coding: bool = False, workspace: str | None = None) -> Persona:
        base = persona_for_role(role or "AI Coordinator", name or "", "coding" if coding else "text")
        return dataclasses.replace(base, model=model, mode="coding" if coding else "text",
                                   workspace=workspace if coding else None)

    def _execute(self, parent_id: int, run_mode: str, model: str, timeout_s: int) -> None:
        provider = self._provider()
        if run_mode == "ai_plan":
            self._execute_plan(provider, parent_id, model, timeout_s)
        elif run_mode == "conversation":
            self._execute_conversation(parent_id, timeout_s)
        else:
            self._execute_direct(provider, parent_id, model, timeout_s)

    def _execute_direct(self, provider: AIProvider, parent_id: int, model: str, timeout_s: int,
                        prompt_override: str | None = None) -> None:
        with SessionLocal() as db:
            task = db.get(Task, parent_id)
            if task is None:
                return
            persona = self._persona(task.agent.role if task.agent else None,
                                    task.agent.name if task.agent else None, model)
            prompt = prompt_override or f"{task.title}\n{task.description}".strip()
            result = self._call(provider, persona, prompt, timeout_s, parent_id)
            self._log_switches(provider, task.id)
            if self._cancelled(parent_id):
                return
            if result.ok:
                add_event(db, task.id, "step_completed", f"Agent {persona.name} finished in {result.latency_s:.1f}s")
                save_result(db, task, result.text)
                transition(db, task, "completed", "AI finished the task")
            else:
                add_event(db, task.id, "run_failed", result.error or "Provider returned no result")
                transition(db, task, "failed", "AI run failed")

    def _execute_plan(self, provider: AIProvider, parent_id: int, model: str, timeout_s: int) -> None:
        with SessionLocal() as db:
            parent = db.get(Task, parent_id)
            if parent is None:
                return
            instruction = f"{parent.title}\n{parent.description}".strip()

        plan = self._make_plan(provider, model, instruction, parent_id, timeout_s)
        if plan is None:
            if self._cancelled(parent_id) or self._parent_failed(parent_id):
                return
            with SessionLocal() as db:
                add_event(db, parent_id, "plan_fallback", "Plan was unparseable; running as a single task")
                db.commit()
            self._execute_direct(provider, parent_id, model, timeout_s, prompt_override=instruction)
            return

        # create subtasks
        with SessionLocal() as db:
            agents_by_role: dict[str, Agent] = {}
            for agent in db.query(Agent).order_by(Agent.id).all():
                agents_by_role.setdefault(agent.role, agent)
            for step in plan.steps:
                agent = agents_by_role.get(step.agent_role)
                child = Task(title=step.title[:160], description=step.instruction,
                             status="pending", priority="normal",
                             agent_id=agent.id if agent else None,
                             parent_id=parent_id, run_mode="ai")
                db.add(child)
            db.commit()
            plan_created = ", ".join(f"{i}:{step.agent_role}:{step.title}" for i, step in enumerate(plan.steps))
            add_event(db, parent_id, "plan_created", f"Plan with {len(plan.steps)} steps ({plan_created})")
            db.commit()
            children = db.query(Task).filter(Task.parent_id == parent_id).order_by(Task.id).all()
            child_ids = [c.id for c in children]

        outputs: dict[int, str] = {}
        for index, (step, child_id) in enumerate(zip(plan.steps, child_ids)):
            if self._cancelled(parent_id):
                self._cancel_remaining(child_ids[index:])
                return
            persona = self._persona(step.agent_role, None, model)
            result = self._run_step(step, index, child_id, parent_id, persona, outputs,
                                    instruction, timeout_s)
            if result is None:  # cancelled mid-step
                self._cancel_remaining(child_ids[index:])
                return
            if result.ok:
                outputs[index] = result.text
                with SessionLocal() as db:
                    child = db.get(Task, child_id)
                    add_event(db, child_id, "step_completed", f"Step {index} done in {result.latency_s:.1f}s")
                    save_result(db, child, result.text)
                    transition(db, child, "completed", "Step completed")
            else:
                with SessionLocal() as db:
                    child = db.get(Task, child_id)
                    add_event(db, child_id, "run_failed", result.error or "No result")
                    transition(db, child, "failed", "Step failed")
                    add_event(db, parent_id, "run_failed", f"Step {index} failed; plan aborted")
                    db.commit()
                    parent = db.get(Task, parent_id)
                    transition(db, parent, "failed", "AI plan failed")
                return

        self._review_and_finish(provider, parent_id, model, timeout_s, instruction, outputs)

    def _run_step(self, step: PlanStep, index: int, child_id: int, parent_id: int,
                  persona: Persona, outputs: dict[int, str], instruction: str,
                  timeout_s: int, extra_prompt: str = "") -> ProviderResult | None:
        """Run one plan step: legacy single-provider path (conversation path uses _run_specialist)."""
        context = instruction
        if step.depends_on:
            prior = "\n\n".join(f"[Result of step {dep}: {outputs.get(dep, '')}]" for dep in step.depends_on)
            context = f"{instruction}\n\nEarlier results you must use:\n{prior}"[:4000]
        provider = self._provider()
        with SessionLocal() as db:
            child = db.get(Task, child_id)
            transition(db, child, "queued", "Step queued by plan")
            transition(db, child, "running", "Step started")
        prompt = f"{step.instruction}\n\nContext:\n{context}"
        if extra_prompt:
            prompt = f"{prompt}\n\n{extra_prompt}"
        result = self._call(provider, persona, prompt[:6000], timeout_s, parent_id)
        self._log_switches(provider, child_id)
        if self._cancelled(parent_id):
            return None
        return result

    # -- leader & team conversation ------------------------------------------

    def _leader(self, db) -> Agent | None:
        """The one leader of the office: the Coordinator's seat. Every instruction, rescue
        and report to the user is signed by this agent."""
        return db.query(Agent).filter(Agent.role == "AI Coordinator").order_by(Agent.id).first()

    def _report_done(self, db, anchor_id: int, conversation_id: int, text: str) -> None:
        leader = self._leader(db)
        add_event(db, anchor_id, "task_done", text[:600], conversation_id=conversation_id,
                  actor_agent_id=leader.id if leader else None,
                  agent_id=leader.id if leader else None)

    def _rescue_candidates(self, db, step: PlanStep, blocked_id: int | None) -> list[Agent]:
        """Who the leader may hand a blocked step to: never the agent that just reported it,
        free agents before busy ones, and a role that can actually do the work (a step that
        writes files must land on a coding-capable role)."""
        busy = {t.agent_id for t in db.query(Task).filter(Task.status == "running").all()
                if t.agent_id}
        if step.uses_tools:
            order = ["Developer", "Backend Developer", "Frontend Developer", "QA Engineer"]
        else:
            order = [step.agent_role, "Researcher", "Data Analyst", "Administrator",
                     "AI Coordinator"]
        agents = db.query(Agent).order_by(Agent.id).all()
        ranked: list[Agent] = []
        for role in order:
            for agent in agents:
                if agent.role == role and agent.id != blocked_id and agent not in ranked:
                    ranked.append(agent)
        if not step.uses_tools:
            for agent in agents:  # last resort: anyone not blocked, keep the office moving
                if agent.id != blocked_id and agent not in ranked:
                    ranked.append(agent)
        return ([a for a in ranked if a.id not in busy]
                + [a for a in ranked if a.id in busy])

    def _escalate_step(self, step: PlanStep, index: int, child_id: int, anchor_id: int,
                       conversation_id: int, cfg: dict, workspace, timeout_s: int,
                       instruction: str, outputs: dict[int, str],
                       reason: str) -> ProviderResult | None:
        """A specialist that cannot finish says so to the leader (`needs_help`); the leader
        diagnoses, picks a replacement from the roster and hands the step over, and the
        replacement retries immediately. Bounded to one rescue per step so a broken provider
        still fails the plan instead of looping forever."""
        with self._db_lock, SessionLocal() as db:
            child = db.get(Task, child_id)
            owner = db.get(Agent, child.agent_id) if child is not None and child.agent_id else None
            leader = self._leader(db)
            say(db, child_id, owner,
                f"Lapor, langkah {index} ({step.title}) macet: {redact(reason, 220)}. "
                "Saya butuh arahan untuk melanjutkan.",
                recipient=leader, conversation_id=conversation_id,
                event_type="needs_help", step_index=index)
            if "merge conflict" in reason.lower():
                # Two agents changed the same lines: no roster swap can fix that safely, so the
                # leader reports the blocker to the user instead of silently overwriting work.
                say(db, anchor_id, leader,
                    f"Langkah {index} tidak bisa saya selesaikan otomatis: {redact(reason, 200)}. "
                    "Dua agent mengubah bagian yang sama. Saya butuh keputusan user: beri tahu "
                    "versi mana yang dipertahankan, lalu minta revisi.",
                    conversation_id=conversation_id, event_type="needs_help", step_index=index)
                db.commit()
                return None
            candidates = self._rescue_candidates(db, step, owner.id if owner else None)
            replacement = candidates[0] if candidates else None
            if replacement is None:
                say(db, anchor_id, leader,
                    f"Langkah {index} tidak bisa diselamatkan: {redact(reason, 180)}. "
                    "Tidak ada pengganti di kantor ini, jadi saya hentikan permintaan.",
                    conversation_id=conversation_id, event_type="agent_chat", step_index=index)
                db.commit()
                return None
            if child is not None:
                child.agent_id = replacement.id
                child.status = "running"
            room = room_for_role(replacement.role)
            seat_agent(db, replacement.id, room=room, workstation=f"{room}-{index}",
                       step_index=index, target_room="")
            say(db, child_id, leader,
                f"{replacement.name}, ambil alih langkah {index} dari "
                f"{owner.name if owner else 'pemegang sebelumnya'}. Penyebab macet: "
                f"{redact(reason, 180)}. Fokus: {step.title}. "
                f"Kriteria diterima: {'; '.join(step.acceptance_criteria) or 'selesaikan sesuai instruksi'}.",
                recipient=replacement, conversation_id=conversation_id, step_index=index)
            add_event(db, child_id, "reassigned",
                      f"Langkah {index} dialihkan ke {replacement.name} ({replacement.role})",
                      conversation_id=conversation_id, agent_id=replacement.id,
                      step_index=index, actor_agent_id=replacement.id)
            db.commit()
        persona = self._persona(replacement.role, replacement.name,
                                self._step_model(cfg, step.uses_tools),
                                coding=step.uses_tools and workspace is not None,
                                workspace=str(workspace) if workspace is not None else None)
        extra = (f"Kamu mengambil alih langkah ini dari rekan yang gagal: {redact(reason, 300)}. "
                 "Kerjakan sampai tuntas dan laporkan hasilnya.")
        return self._run_specialist_step(step, index, child_id, anchor_id, persona, outputs,
                                         instruction, timeout_s, cfg, workspace,
                                         conversation_id, extra_prompt=extra)

    # -- conversation execution ----------------------------------------------

    def _exec_config(self) -> dict:
        with SessionLocal() as db:
            name = ai_provider(db)
            return {
                "provider": name,
                "text_model": ai_model_for(db, name),
                "coding_models": {
                    "opencode": ai_model_for(db, "opencode"),
                    "qoder": ai_model_for(db, "qoder"),
                    "claude": ai_model_for(db, "claude"),
                },
                "fallback": ai_fallback_enabled(db),
                "rotate": rotate_models_enabled(db),
                "retry_max": ai_retry_max(db),
                "workspace_root": get_setting(db, "workspace_root"),
            }

    def _step_provider(self, cfg: dict, coding: bool) -> tuple[AIProvider | None, str, str, AIProvider | None, str]:
        """Returns (primary, provider_name, model, alternate_or_None, error_or_empty)."""
        if self._injected_provider is not None:
            name = getattr(self._injected_provider, "name", cfg["provider"])
            coding_model = cfg["coding_models"].get(name, cfg["text_model"])
            return (self._injected_provider, name,
                    coding_model if coding else cfg["text_model"], None, "")
        avail = registry.availability()
        if coding:
            name, _cls = registry.coding_provider(cfg["provider"])
            if name is None or not avail.get(name, {}).get("available"):
                return (None, cfg["provider"], cfg["coding_models"].get(cfg["provider"], ""), None,
                        "coding steps need an installed CLI with coding support (opencode, qodercli or claude) — "
                        "install one, or edit the step to run without tools")
            model = cfg["coding_models"].get(name, "")
            alternate = None
            if cfg["fallback"]:
                other = next((n for n in registry.PROVIDERS
                              if n != name and avail.get(n, {}).get("available")), None)
                alternate = registry.make_provider(other) if other else None
            primary = registry.make_provider(name)
            if cfg["rotate"]:
                primary = self._rotating(primary, name, model)
            return (primary, name, model, alternate, "")
        name = cfg["provider"]
        alternate = None
        if cfg["fallback"]:
            # Prefer another provider whose CLI is actually installed; otherwise keep the old
            # opencode <-> qoder pairing so the failure message stays actionable.
            avail = registry.availability()
            other = next((n for n in registry.PROVIDERS if n != name and avail.get(n, {}).get("available")),
                         "qoder" if name == "opencode" else "opencode")
            alternate = registry.make_provider(other)
        primary = registry.make_provider(name)
        if cfg["rotate"]:
            primary = self._rotating(primary, name, cfg["text_model"])
        return (primary, name, cfg["text_model"], alternate, "")

    def _run_specialist(self, primary: AIProvider, alternate: AIProvider | None, persona: Persona,
                        prompt: str, timeout_s: int, anchor_id: int,
                        diff_probe=None) -> ProviderResult:
        if alternate is None:
            return self._call(primary, persona, prompt, timeout_s, anchor_id)
        first, second = ai_fallback.run_with_fallback(
            primary, alternate, persona, prompt, timeout_s=timeout_s,
            should_cancel=lambda: self._cancelled(anchor_id), diff_probe=diff_probe)
        return second if second is not None else first

    def _execute_conversation(self, anchor_id: int, timeout_s: int) -> None:
        cfg = self._exec_config()
        with SessionLocal() as db:
            anchor = db.get(Task, anchor_id)
            if anchor is None:
                return
            instruction = f"{anchor.title}\n{anchor.description}".strip()
            conv = db.get(Conversation, anchor.conversation_id) if anchor.conversation_id else None
            if conv is None:
                add_event(db, anchor_id, "run_failed", "Conversation is missing for this anchor")
                transition(db, anchor, "failed", "Conversation missing")
                return
            plan_row = db.query(Plan).filter(Plan.conversation_id == conv.id,
                                             Plan.version == conv.current_plan_version).first()
            if plan_row is None or plan_row.status != "approved":
                add_event(db, anchor_id, "run_failed", "No approved plan version to execute")
                transition(db, anchor, "failed", "Execution blocked: plan not approved")
                return
            try:
                plan = TaskPlan.model_validate(json.loads(plan_row.steps_json))
            except (ValueError, TypeError):
                add_event(db, anchor_id, "run_failed", "Approved plan steps are corrupt")
                transition(db, anchor, "failed", "Execution blocked: corrupt plan")
                return
            anchor.plan_json = plan_row.steps_json

            children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
            created_here = False
            if not children:
                created_here = True
                agents_by_role: dict[str, Agent] = {}
                for agent in db.query(Agent).order_by(Agent.id).all():
                    agents_by_role.setdefault(agent.role, agent)
                for index, step in enumerate(plan.steps):
                    agent = agents_by_role.get(step.agent_role)
                    db.add(Task(title=step.title[:160], description=step.instruction,
                                status="pending", priority="normal",
                                agent_id=agent.id if agent else None, parent_id=anchor_id,
                                run_mode="ai", plan_step_index=index,
                                required="1" if step.required else "0",
                                depends_on_json=json.dumps(step.depends_on),
                                acceptance_criteria=json.dumps(step.acceptance_criteria)))
                db.commit()
                plan_created = ", ".join(f"{i}:{step.agent_role}:{step.title}" for i, step in enumerate(plan.steps))
                add_event(db, anchor_id, "plan_created",
                          f"Plan v{plan_row.version} materialised ({plan_created})",
                          conversation_id=conv.id)
                children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
            # Announce assignment so the office can seat each specialist at its station.
            for child in children:
                idx = child.plan_step_index if child.plan_step_index is not None else 0
                role = plan.steps[idx].agent_role if idx < len(plan.steps) else ""
                room = room_for_role(role)
                station = f"{room}-{idx}"
                if child.agent_id:
                    seat_agent(db, child.agent_id, room=room, workstation=station, step_index=idx)
                    add_event(db, child.id, "task_assigned",
                              f"Assigned to step {idx}: {child.title[:120]}",
                              conversation_id=conv.id, agent_id=child.agent_id,
                              step_index=idx, actor_agent_id=child.agent_id, to_room=room)
            # The leader opens the work: one instruction per step, spoken to its owner, so the
            # team feed shows who was told to do what before any output exists. Materialised
            # plans (the normal path) already carry these instructions from propose_plan.
            leader = self._leader(db)
            if leader is not None and created_here:
                say(db, anchor_id, leader,
                    f"Rekan-rekan, kita mulai permintaan #{anchor_id}: {anchor.title[:120]}. "
                    f"Rencana {len(plan.steps)} langkah sudah disetujui. "
                    "Kerjakan bagian masing-masing dan lapor kalau ada hambatan.",
                    conversation_id=conv.id)
                for child in children:
                    idx = child.plan_step_index if child.plan_step_index is not None else 0
                    if child.agent_id is None:
                        continue
                    owner = db.get(Agent, child.agent_id)
                    step = plan.steps[idx] if idx < len(plan.steps) else None
                    criteria = "; ".join(step.acceptance_criteria) if step else ""
                    deps = sorted(step.depends_on) if step else []
                    wait = f" Tunggu hasil langkah {deps} dulu." if deps else ""
                    say(db, child.id, leader,
                        f"{owner.name if owner else 'Rekan'}, pegang langkah {idx}: "
                        f"{child.title[:140]}.{wait} "
                        f"Kriteria diterima: {criteria or 'selesaikan sesuai instruksi'}.",
                        recipient=owner, conversation_id=conv.id, step_index=idx)
            # Backfill dependency edges for plans materialised before the DAG columns existed.
            if all(not c.depends_on_json for c in children):
                for child, step in zip(children, plan.steps):
                    child.depends_on_json = json.dumps(step.depends_on)
            child_ids = [c.id for c in children]
            db.commit()
        child_ids = child_ids[:len(plan.steps)]
        if len(child_ids) != len(plan.steps):
            with SessionLocal() as db:
                add_event(db, anchor_id, "run_failed", "Child count does not match the approved plan")
                anchor = db.get(Task, anchor_id)
                transition(db, anchor, "failed", "Execution blocked: plan/children mismatch")
            return

        deps = [set(step.depends_on) for step in plan.steps]

        # Base workspace (shared ancestor) for coding steps; per-task isolation happens below.
        base_ws = None
        if any(step.uses_tools for step in plan.steps):
            ws_root = resolve_root(cfg["workspace_root"] or None)
            base_ws = ws_root / f"project-{anchor_id}"
            base_ws.mkdir(parents=True, exist_ok=True)
            repo.ensure_git(base_ws)

        outputs: dict[int, str] = {}
        completed: set[int] = set()
        remaining: set[int] = set(range(len(plan.steps)))
        with SessionLocal() as db:
            concurrency = max_concurrency(db)
            lease = lease_seconds(db)
            policy = merge_policy(db)

        while remaining:
            if self._cancelled(anchor_id):
                self._cancel_remaining(child_ids)
                return
            ready = [i for i in sorted(remaining) if deps[i] <= completed]
            if not ready:
                stuck = sorted(remaining)[0]
                self._fail_plan(anchor_id, child_ids[stuck], stuck, conv.id,
                                f"Step {stuck} blocked: dependencies {sorted(deps[stuck]-completed)} did not complete")
                return
            outcomes = self._run_wave(ready, plan.steps, child_ids, anchor_id, outputs, instruction,
                                      timeout_s, cfg, base_ws, conv.id, concurrency, lease, policy)
            if any(r is None for r in outcomes.values()):
                self._cancel_remaining(child_ids)
                return
            for i in ready:
                result = outcomes[i]
                if not result.ok:
                    # The specialist reports the blocker to the leader instead of the plan
                    # dying silently: the leader finds a replacement and the step retries.
                    reason = f"Step {i} failed: {str(result.error)[:300]}"
                    rescued = self._escalate_step(
                        plan.steps[i], i, child_ids[i], anchor_id, conv.id, cfg, base_ws,
                        timeout_s, instruction, outputs, reason)
                    if rescued is None or not rescued.ok:
                        detail = reason if rescued is None else \
                            f"Step {i} failed again after reassignment: {str(rescued.error)[:300]}"
                        self._fail_plan(anchor_id, child_ids[i], i, conv.id, detail)
                        return
                    result = rescued
                outputs[i] = result.text
                completed.add(i)
                with SessionLocal() as db:
                    child = db.get(Task, child_ids[i])
                    add_event(db, child.id, "step_completed",
                              f"Step {i} done in {result.latency_s:.1f}s",
                              conversation_id=conv.id, agent_id=child.agent_id,
                              provider=result.provider, model=result.model, step_index=i)
                    save_result(db, child, result.text)
                    release_lease(db, child.id)
                    transition(db, child, "completed", "Step completed")
                    owner = db.get(Agent, child.agent_id) if child.agent_id else None
                    leader = self._leader(db)
                    say(db, child.id, owner,
                        f"Langkah {i} ({plan.steps[i].title}) selesai. "
                        f"Hasil tersimpan di {child.artifact_path or f'task-{child.id}.md'}.",
                        recipient=leader, conversation_id=conv.id, step_index=i)
                    db.commit()
                self._record_handoffs(i, plan.steps, child_ids, outputs, conv.id)
            remaining -= set(ready)

        self._qc_phase(anchor_id, conv.id, plan_row.id, plan, instruction, outputs, cfg, base_ws, timeout_s)

    def _run_wave(self, ready, steps, child_ids, anchor_id, outputs, instruction, timeout_s,
                  cfg, base_ws, conversation_id, concurrency, lease,
                  policy) -> dict[int, ProviderResult | None]:
        """Execute one DAG wave: independent nodes run concurrently (bounded by concurrency),
        each coding node in its own git worktree so peers never clobber the same files. The
        completed worktrees are merged back into the base workspace sequentially, so the next
        wave sees dependency-correct file state and a merge conflict is surfaced, not swallowed."""
        coding_in_wave = [i for i in ready if steps[i].uses_tools]
        isolate = (base_ws is not None and policy == "worktree"
                   and repo.git_available() and len(coding_in_wave) > 1)

        node_ws: dict[int, object] = {}
        node_wt: dict[int, tuple[str, object]] = {}
        for i in ready:
            step = steps[i]
            if not step.uses_tools or base_ws is None:
                node_ws[i] = None
            elif isolate:
                branch, wt = repo.add_worktree(base_ws, f"anchor{anchor_id}-step{i}")
                if wt is None:
                    node_ws[i] = base_ws
                else:
                    node_wt[i] = (branch, wt)
                    node_ws[i] = wt
            else:
                node_ws[i] = base_ws

        # Nodes that share a directory must not run concurrently; only isolated/text nodes do.
        parallel = [i for i in ready if i in node_wt or node_ws[i] is None]
        serial = [i for i in ready if i not in parallel]
        outcomes: dict[int, ProviderResult | None] = {}
        branches: dict[int, str] = {}

        def run_one(i: int):
            step = steps[i]
            child_id = child_ids[i]
            with self._db_lock, SessionLocal() as db:
                if not claim_task(db, child_id, self._owner, lease):
                    return i, ProviderResult(ok=False,
                                             error="step already claimed by another worker")
            persona = self._persona(step.agent_role, None, self._step_model(cfg, step.uses_tools),
                                    coding=step.uses_tools and node_ws[i] is not None,
                                    workspace=str(node_ws[i]) if node_ws[i] is not None else None)
            result = self._run_specialist_step(step, i, child_id, anchor_id, persona, outputs,
                                               instruction, timeout_s, cfg, node_ws[i], conversation_id)
            if result is not None and result.ok and i in node_wt:
                repo.commit_all(node_wt[i][1], f"step {i} of anchor {anchor_id}")
                branches[i] = node_wt[i][0]
            return i, result

        if parallel:
            with ThreadPoolExecutor(max_workers=max(1, min(concurrency, len(parallel)))) as ex:
                collected = [f.result() for f in [ex.submit(run_one, i) for i in parallel]]
            for i, result in collected:
                outcomes[i] = self._integrate(i, result, branches, base_ws, conversation_id, child_ids)
        for i in serial:
            i, result = run_one(i)
            outcomes[i] = self._integrate(i, result, branches, base_ws, conversation_id, child_ids)

        if base_ws is not None:
            for i in node_wt:
                repo.remove_worktree(base_ws, node_wt[i][1])
        return outcomes

    def _integrate(self, i, result, branches, base_ws, conversation_id, child_ids):
        """Merge an isolated coding node's branch into the base; a conflict becomes a step
        failure with the offending files recorded rather than silently overwriting a peer."""
        if result is not None and result.ok and i in branches and base_ws is not None:
            ok, conflicts = repo.merge_branch(base_ws, branches[i])
            if not ok:
                return ProviderResult(ok=False, error=self._conflict_note(i, conflicts, conversation_id, child_ids))
        return result

    def _conflict_note(self, i, conflicts, conversation_id, child_ids) -> str:
        with SessionLocal() as db:
            add_event(db, child_ids[i], "merge_conflict",
                      f"Step {i} branch conflicts with delivered work: {', '.join(conflicts[:20]) or 'unknown'}; manual resolution required",
                      conversation_id=conversation_id, step_index=i)
            db.commit()
        return f"merge conflict in {conflicts[:10]}; manual resolution required"

    def _record_handoffs(self, i, steps, child_ids, outputs, conversation_id) -> None:
        """A completed step hands its artifact to every step that depends on it. Persist the
        handoff as workflow data (not just text) and drive the office animation: the producer
        physically travels from their workstation to the recipient's, hands over, and returns."""
        consumers = [j for j, s in enumerate(steps) if i in set(s.depends_on)]
        if not consumers:
            return
        with SessionLocal() as db:
            producer = db.get(Task, child_ids[i])
            from_role = producer.agent.role if producer.agent else ""
            from_room = room_for_role(from_role)
            artifact = producer.artifact_path or f"task-{producer.id}.md"
            for j in consumers:
                consumer = db.get(Task, child_ids[j])
                to_role = steps[j].agent_role
                to_room = room_for_role(to_role)
                db.add(Handoff(task_id=producer.id, step_index=i, conversation_id=conversation_id,
                               from_agent_id=producer.agent_id, to_agent_id=consumer.agent_id,
                               artifact_ref=artifact, status="requested",
                               note=f"step {i} -> step {j}: {producer.title[:120]}"))
                if producer.agent_id:
                    # Outbound trip to the recipient's workstation.
                    if from_room != to_room:
                        seat_agent(db, producer.agent_id, target_room=to_room)
                        add_event(db, producer.id, "travel_started",
                                  f"Step {i} carries the artifact to step {j}",
                                  conversation_id=conversation_id, agent_id=producer.agent_id,
                                  step_index=i, actor_agent_id=producer.agent_id,
                                  from_room=from_room, to_room=to_room)
                        add_event(db, producer.id, "travel_arrived",
                                  f"Arrived at {to_room} for handoff",
                                  conversation_id=conversation_id, agent_id=producer.agent_id,
                                  step_index=i, actor_agent_id=producer.agent_id,
                                  from_room=from_room, to_room=to_room)
                    add_event(db, producer.id, "handoff_requested",
                              f"Handoff from step {i} to step {j} ({consumer.title[:120]})",
                              conversation_id=conversation_id, agent_id=producer.agent_id,
                              step_index=i, actor_agent_id=producer.agent_id,
                              recipient_agent_id=consumer.agent_id,
                              from_room=from_room, to_room=to_room)
                    if consumer.agent_id:
                        add_event(db, consumer.id, "handoff_accepted",
                                  f"Step {j} accepted the artifact from step {i}",
                                  conversation_id=conversation_id, agent_id=consumer.agent_id,
                                  step_index=j, actor_agent_id=consumer.agent_id,
                                  recipient_agent_id=producer.agent_id, from_room=to_room, to_room=to_room)
                    # Return trip home.
                    if from_room != to_room:
                        seat_agent(db, producer.agent_id, room=from_room, target_room=from_room)
                        add_event(db, producer.id, "travel_started",
                                  f"Step {i} returns to {from_room}",
                                  conversation_id=conversation_id, agent_id=producer.agent_id,
                                  step_index=i, actor_agent_id=producer.agent_id,
                                  from_room=to_room, to_room=from_room)
                        add_event(db, producer.id, "travel_arrived",
                                  f"Back at {from_room}",
                                  conversation_id=conversation_id, agent_id=producer.agent_id,
                                  step_index=i, actor_agent_id=producer.agent_id,
                                  from_room=to_room, to_room=from_room)
            db.commit()

    def _end_meeting(self, db, anchor_id: int, conversation_id: int, participants) -> None:
        """Close the QC meeting: clear the meeting target and send each specialist back to
        its department so the office reflects that the discussion really ended."""
        add_event(db, anchor_id, "meeting_ended", "QC meeting ended",
                  conversation_id=conversation_id, from_room="meeting")
        for aid in participants:
            agent = db.get(Agent, aid)
            if agent is not None:
                seat_agent(db, aid, room=room_for_role(agent.role), target_room="")
                agent.workstation = f"{room_for_role(agent.role)}"
        db.commit()


    def _review_visits(self, db, anchor_id: int, conversation_id: int, failed_steps, findings: str) -> None:
        """QC failed and the steps go back for revision: each responsible specialist returns to
        its own desk, and one `review_visit` frame per step records that the Reviewer brings the
        findings there (actor = Reviewer, recipient = step owner). The office replays the visit
        from that frame; without a Reviewer agent on the roster nothing is announced."""
        reviewer = db.query(Agent).filter(Agent.role == "Reviewer").order_by(Agent.id).first()
        line = redact(findings, 160) or "temuan QC"
        children = db.query(Task).filter(Task.parent_id == anchor_id).all()
        for child in children:
            if child.plan_step_index not in failed_steps or not child.agent_id:
                continue
            owner = db.get(Agent, child.agent_id)
            if owner is None:
                continue
            room = room_for_role(owner.role)
            seat_agent(db, owner.id, room=room, target_room="")
            if reviewer is not None and reviewer.id != owner.id:
                add_event(db, child.id, "review_visit",
                          f"Temuan QC untuk langkah {child.plan_step_index}: {line}",
                          conversation_id=conversation_id, agent_id=reviewer.id,
                          step_index=child.plan_step_index, actor_agent_id=reviewer.id,
                          recipient_agent_id=owner.id,
                          from_room=room_for_role(reviewer.role), to_room=room)

    def _step_model(self, cfg: dict, coding: bool) -> str:
        if not coding:
            return cfg["text_model"]
        name, _cls = registry.coding_provider(cfg["provider"])
        name = name or cfg["provider"]
        return cfg["coding_models"].get(name, cfg["text_model"])

    def _action_sink(self, child_id: int, index: int, conversation_id: int, agent_id: int | None,
                     provider_name: str, model: str):
        """Callback that journals one `action_<kind>` frame per observed tool call, attributed to
        the step's agent so the office can show it. Rate-limited, and never raises: a locked
        database must not fail the step it is describing."""
        gate = ActionGate()

        def sink(kind: str, summary: str) -> None:
            if not gate.allow():
                return
            try:
                with self._db_lock, SessionLocal() as db:
                    add_event(db, child_id, f"action_{kind}", summary[:300], conversation_id=conversation_id,
                              agent_id=agent_id, provider=provider_name, model=model, step_index=index)
                    db.commit()
            except Exception:  # noqa: BLE001
                logger.warning("could not journal an action event", exc_info=True)

        return sink

    def _run_specialist_step(self, step: PlanStep, index: int, child_id: int, anchor_id: int,
                             persona: Persona, outputs: dict[int, str], instruction: str,
                             timeout_s: int, cfg: dict, workspace, conversation_id: int,
                             extra_prompt: str = "") -> ProviderResult | None:
        provider, provider_name, model, alternate, error = self._step_provider(cfg, step.uses_tools)
        if model and persona.model != model:
            persona = dataclasses.replace(persona, model=model)
        with self._db_lock, SessionLocal() as db:
            child = db.get(Task, child_id)
            if child.status == "pending":
                transition(db, child, "queued", "Step queued (approved plan)", conversation_id=conversation_id)
            if child.status == "queued":
                transition(db, child, "running", "Step started", conversation_id=conversation_id)
            step_agent_id = child.agent_id
            add_event(db, anchor_id, "step_started", f"Step {index} ({step.agent_role}) on {provider_name}",
                      conversation_id=conversation_id, agent_id=child.agent_id,
                      provider=provider_name, model=model, step_index=index)
            if step.uses_tools and workspace is not None:
                pre_status, _pre = repo.capture_diff(workspace)
                add_event(db, child.id, "workspace_before",
                          f"Workspace before step: {pre_status[:200] or 'clean'}",
                          conversation_id=conversation_id, step_index=index,
                          provider=provider_name, model=model)
            db.commit()
        if provider is None:
            return ProviderResult(ok=False, error=error)
        # Providers that can observe their own tool calls report them live; the journal then says
        # what the agent is reading/writing/running instead of only "step started".
        persona = dataclasses.replace(persona, on_action=self._action_sink(
            child_id, index, conversation_id, step_agent_id, provider_name, model))
        context = instruction
        if step.depends_on:
            prior = "\n\n".join(f"[Result of step {dep}: {outputs.get(dep, '')}]" for dep in step.depends_on)
            context = f"{instruction}\n\nEarlier results you must use:\n{prior}"[:4000]
        criteria = "\n".join(f"- {c}" for c in step.acceptance_criteria)
        prompt = f"{step.instruction}\n\nContext:\n{context}"
        if criteria:
            prompt += f"\n\nThis step must satisfy:\n{criteria}"
        if extra_prompt:
            prompt += f"\n\n{extra_prompt}"
        diff_probe = (lambda: repo.capture_diff(workspace)) if (workspace and alternate) else None
        result = self._run_specialist(provider, alternate, persona, prompt[:6000], timeout_s,
                                      anchor_id, diff_probe)
        if not result.provider:
            result = dataclasses.replace(result, provider=provider_name, model=model)
        self._log_switches(provider, child_id, conversation_id=conversation_id,
                            agent_id=step_agent_id, step_index=index)
        with self._db_lock, SessionLocal() as db:
            # Provenance belongs on the step itself, not only on the journal: the result modal
            # and any later audit read the Task row.
            child = db.get(Task, child_id)
            if child is not None:
                child.provider_used = (result.provider or provider_name)[:32]
                child.model_used = (result.model or model)[:120]
            if step.uses_tools and workspace is not None:
                # Post-state on every outcome: QC, fallback decisions and humans need to see
                # what a coding step actually touched, even when it failed midway.
                post_status, _diff = repo.capture_diff(workspace)
                add_event(db, child_id, "diff_captured",
                          f"Workspace after step: {post_status[:300] or 'no-changes'}",
                          conversation_id=conversation_id, provider=result.provider or provider_name,
                          model=result.model or model, step_index=index)
            db.commit()
        if self._cancelled(anchor_id):
            return None
        return result

    def _fail_plan(self, anchor_id: int, child_id: int, index: int, conversation_id: int, reason: str) -> None:
        with SessionLocal() as db:
            child = db.get(Task, child_id)
            if child is not None and child.status not in ("cancelled",):
                add_event(db, child_id, "run_failed", reason[:500], conversation_id=conversation_id,
                          step_index=index)
                if child.status in ("pending", "queued", "running"):
                    transition(db, child, "failed", "Step failed")
            add_event(db, anchor_id, "run_failed", reason[:500], conversation_id=conversation_id,
                      step_index=index)
            db.commit()
            anchor = db.get(Task, anchor_id)
            if anchor is not None and anchor.status in ("queued", "running"):
                transition(db, anchor, "failed", "Conversation execution failed")

    # -- QC phase --------------------------------------------------------------

    def _execute_conversation_qc(self, anchor_id: int, timeout_s: int) -> None:
        """QC-only rerun: re-review the work that already exists, never revise a step or edit files."""
        cfg = self._exec_config()
        with SessionLocal() as db:
            anchor = db.get(Task, anchor_id)
            if anchor is None:
                return
            anchor.qc_rerun_requested = False
            conv = db.get(Conversation, anchor.conversation_id) if anchor.conversation_id else None
            if conv is None:
                add_event(db, anchor_id, "run_failed", "Conversation is missing for this anchor")
                transition(db, anchor, "failed", "Conversation missing")
                return
            plan_row = (db.query(Plan)
                        .filter(Plan.conversation_id == conv.id,
                                Plan.version == conv.current_plan_version).first())
            if plan_row is None or plan_row.status != "approved":
                add_event(db, anchor_id, "run_failed", "QC rerun blocked: no approved plan version")
                transition(db, anchor, "failed", "QC rerun blocked: plan not approved")
                return
            try:
                plan = TaskPlan.model_validate(json.loads(plan_row.steps_json))
            except (ValueError, TypeError):
                add_event(db, anchor_id, "run_failed", "QC rerun blocked: approved plan is corrupt")
                transition(db, anchor, "failed", "QC rerun blocked: corrupt plan")
                return
            if anchor.status == "failed":
                transition(db, anchor, "queued", "QC-only rerun queued", "qc_rerun_requested",
                           conversation_id=conv.id)
            if anchor.status == "queued":
                transition(db, anchor, "running", "QC rerun started", conversation_id=conv.id)
            anchor.plan_json = plan_row.steps_json
            children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
            outputs = {c.plan_step_index: c.result for c in children
                       if c.plan_step_index is not None and c.result}
            instruction = f"{anchor.title}\n{anchor.description}".strip()
            workspace = None
            if any(step.uses_tools for step in plan.steps):
                ws_root = resolve_root(cfg["workspace_root"] or None)
                candidate = ws_root / f"project-{anchor_id}"
                if candidate.exists():
                    workspace = candidate
            db.commit()
        self._qc_phase(anchor_id, conv.id, plan_row.id, plan, instruction, outputs, cfg,
                       workspace, timeout_s, allow_revision=False)

    def _qc_phase(self, anchor_id: int, conversation_id: int, plan_row_id: int, plan: TaskPlan,
                  instruction: str, outputs: dict[int, str], cfg: dict, workspace,
                  timeout_s: int, allow_revision: bool = True) -> None:
        with SessionLocal() as db:
            anchor = db.get(Task, anchor_id)
            transition(db, anchor, "reviewing", "QC review started")
            participants = sorted({c.agent_id for c in db.query(Task).filter(Task.parent_id == anchor_id).all()
                                   if c.agent_id})
            names = ", ".join(filter(None, (db.get(Agent, aid).name if db.get(Agent, aid) else None
                                            for aid in participants))) or "n/a"
            add_event(db, anchor_id, "meeting_started",
                      f"QC meeting: {anchor.title[:80]} (participants: {names})",
                      conversation_id=conversation_id, to_room="meeting")
            for aid in participants:
                seat_agent(db, aid, target_room="meeting")
            artifact_paths = [anchor.artifact_path] if anchor.artifact_path else []
            artifact_paths.extend(
                c.artifact_path for c in db.query(Task).filter(Task.parent_id == anchor_id).all()
                if c.artifact_path)
            db.commit()
        criteria = list(plan.acceptance_criteria)
        for step in plan.steps:
            criteria.extend(step.acceptance_criteria)
        if not criteria:
            criteria = ["Deliver the work described in the original request"]
        ids = criterion_ids(criteria)
        provider = self._provider()
        provider_name = getattr(provider, "name", "") or cfg["provider"]
        qc_persona = dataclasses.replace(QC_REVIEWER, model=cfg["text_model"])
        iteration = 0
        while True:
            iteration += 1
            status, diff = repo.capture_diff(workspace) if workspace is not None else ("", "")
            summary = "\n\n".join(f"## Step {i}: {text}" for i, text in sorted(outputs.items()))
            head = (
                "Original request:\n" + instruction[:900]
                + "\n\nAcceptance criteria (report every id exactly once):\n"
                + "\n".join(f"{cid}. {criterion[:240]}"
                            for cid, criterion in zip(ids, criteria))
                + "\n\nDelivered step outputs (text only, truncated):\n" + summary[:1200]
                + "\n\n"
            )
            # Keep the whole provider prompt (persona + task) inside the 12k CLI cap.
            budget = max(3200, min(6500, 10800 - len(head)))
            evidence = build_evidence(
                workspace=workspace,
                artifact_paths=artifact_paths,
                artifact_dir=task_service.ARTIFACTS_DIR,
                project_root=task_service.PROJECT_ROOT,
                diff=diff,
                budget=budget,
            )
            review_prompt = head + evidence.text
            result = self._call(provider, qc_persona, review_prompt, timeout_s, anchor_id)
            self._log_switches(provider, anchor_id)
            if self._cancelled(anchor_id):
                return
            provider_used = result.provider or provider_name
            model_used = result.model or cfg["text_model"]
            payload = extract_json(result.text) if result.ok else None
            verdict = "inconclusive"
            findings = ""
            evidence_text = ""
            failed_steps: list[int] = []
            criteria_payload: list[dict] = []
            artifacts_payload: list[str] = []
            diagnostic = ""
            if not result.ok:
                diagnostic = f"QC transport failure: {result.error or 'provider returned no result'}"
            elif payload is None:
                diagnostic = "QC reply was not a JSON object"
            else:
                try:
                    validated = validate_qc_payload(payload, criteria, evidence.refs,
                                                    len(plan.steps))
                except ValueError as exc:
                    # Parsed but contract-invalid is a fail, not an approval.
                    verdict = "fail"
                    diagnostic = f"QC payload rejected: {exc}"
                else:
                    verdict = validated.verdict
                    findings = validated.findings
                    evidence_text = validated.evidence
                    failed_steps = validated.failed_steps
                    criteria_payload = [item.model_dump() for item in validated.criteria]
                    artifacts_payload = list(validated.artifacts_checked)
            if diagnostic:
                findings = diagnostic[:2000]
                evidence_text = (result.text or "")[:2000]
            if not criteria_payload:
                criteria_payload = [{"id": cid, "criterion": criterion}
                                    for cid, criterion in zip(ids, criteria)]
            with SessionLocal() as db:
                db.add(QcReview(task_id=anchor_id, plan_id=plan_row_id, iteration=iteration,
                                verdict=verdict,
                                criteria_json=json.dumps(criteria_payload),
                                findings=findings[:2000], evidence=evidence_text[:2000],
                                artifacts_json=json.dumps(artifacts_payload),
                                provider=provider_used[:32] if provider_used else None,
                                model=model_used[:120] if model_used else None))
                add_event(db, anchor_id, "qc_reviewed",
                          f"QC iteration {iteration}: {verdict}"
                          + (f" — {diagnostic[:200]}" if diagnostic else ""),
                          conversation_id=conversation_id, provider=provider_used,
                          model=model_used)
                db.commit()
                anchor = db.get(Task, anchor_id)
                if verdict == "pass" and self._required_children_ok(anchor_id):
                    if workspace is not None:
                        self._store_diff_artifact(anchor_id, status, diff)
                    save_result(db, anchor, summary)
                    transition(db, anchor, "completed", "QC passed")
                    self._report_done(db, anchor_id, conversation_id,
                                      f"Selesai: {anchor.title[:120]}. QC lulus dan semua langkah "
                                      f"wajib tuntas. Hasil kerja ada di {anchor.artifact_path or 'artefak task'}.")
                    if conversation_id:
                        conversation_service.add_message(
                            db, conversation_id,
                            f"Pekerjaan selesai: {anchor.title}. QC lulus dan semua langkah wajib sudah "
                            f"tuntas. Hasil tersimpan di {anchor.artifact_path or 'artefak task'}.",
                            role="assistant")
                    self._end_meeting(db, anchor_id, conversation_id, participants)
                    return
                if verdict == "pass":
                    transition(db, anchor, "failed",
                               "QC passed but required steps are not completed")
                    self._end_meeting(db, anchor_id, conversation_id, participants)
                    return
                if (allow_revision and verdict == "fail"
                        and iteration <= cfg["retry_max"] and failed_steps):
                    transition(db, anchor, "running",
                               f"QC round {iteration} failed; revising steps {failed_steps}")
                    leader = self._leader(db)
                    if leader is not None:
                        say(db, anchor_id, leader,
                            f"QC putaran {iteration} menemukan masalah di langkah "
                            f"{failed_steps}: {redact(findings, 200)}. "
                            "Pemilik langkah saya minta perbaiki sekarang, lalu kita review ulang.",
                            conversation_id=conversation_id)
                    self._review_visits(db, anchor_id, conversation_id, failed_steps, findings)
                    db.commit()
                else:
                    reason = ("QC failed" if verdict == "fail"
                              else "QC verdict unreadable or QC run failed — treating as failure")
                    transition(db, anchor, "failed", reason)
                    leader = self._leader(db)
                    if leader is not None:
                        say(db, anchor_id, leader,
                            f"Permintaan #{anchor_id} gagal: {reason}. "
                            f"Temuan QC: {redact(findings, 220) or 'tidak ada detail'}. "
                            "Saya butuh keputusan user untuk melanjutkan (revisi atau batalkan).",
                            conversation_id=conversation_id, event_type="needs_help")
                    self._end_meeting(db, anchor_id, conversation_id, participants)
                    return
            if not allow_revision:
                return
            child_map = self._children_by_step(anchor_id)
            for idx in failed_steps:
                step = plan.steps[idx]
                child_id = child_map.get(idx)
                if child_id is None:
                    continue
                persona = self._persona(step.agent_role, None,
                                        self._step_model(cfg, step.uses_tools),
                                        coding=step.uses_tools and workspace is not None,
                                        workspace=str(workspace) if workspace else None)
                revised = self._run_specialist_step(
                    step, idx, child_id, anchor_id, persona, outputs, instruction, timeout_s,
                    cfg, workspace, conversation_id,
                    extra_prompt=f"Reviewer findings to address:\n{findings}")
                if revised is None:
                    return
                with SessionLocal() as db:
                    child = db.get(Task, child_id)
                    if revised.ok:
                        outputs[idx] = revised.text
                        child.provider_used = revised.provider or child.provider_used
                        child.model_used = revised.model or child.model_used
                        add_event(db, child_id, "step_revised", f"Step {idx} revised after QC {iteration}",
                                  conversation_id=conversation_id, provider=revised.provider,
                                  model=revised.model, step_index=idx)
                        save_result(db, child, revised.text)
                    else:
                        add_event(db, child_id, "run_failed", f"Revision failed: {str(revised.error)[:300]}",
                                  conversation_id=conversation_id, step_index=idx)
                        db.commit()
                        anchor = db.get(Task, anchor_id)
                        transition(db, anchor, "failed", "Revision step failed")
                        return
                    db.commit()

    def _required_children_ok(self, anchor_id: int) -> bool:
        with SessionLocal() as db:
            children = db.query(Task).filter(Task.parent_id == anchor_id).all()
            return all(c.status == "completed" for c in children if c.required != "0")

    def _children_by_step(self, anchor_id: int) -> dict[int, int]:
        with SessionLocal() as db:
            return {c.plan_step_index: c.id for c in db.query(Task).filter(Task.parent_id == anchor_id).all()
                    if c.plan_step_index is not None}

    def _store_diff_artifact(self, anchor_id: int, status: str, diff: str) -> None:
        task_service.ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
        (task_service.ARTIFACTS_DIR / f"task-{anchor_id}.diff.txt").write_text(
            f"workspace status:\n{status}\n\ndiff:\n{diff}", encoding="utf-8")

    # -- legacy planner paths ----------------------------------------------------

    def _make_plan(self, provider: AIProvider, model: str, instruction: str,
                   parent_id: int, timeout_s: int) -> TaskPlan | None:
        """Returns a validated plan, or None. On provider transport failure the parent task is
        already transitioned to failed here (no fallback). On unparsable JSON None is returned
        and the caller falls back to direct execution."""
        persona = dataclasses.replace(MANAGER, model=model)
        result = self._call(provider, persona,
                            f"Create a work plan for this request:\n{instruction}", timeout_s, parent_id)
        self._log_switches(provider, parent_id)
        if not result.ok:
            with SessionLocal() as db:
                parent = db.get(Task, parent_id)
                if parent is not None and parent.status == "running":
                    add_event(db, parent_id, "plan_failed", result.error or "Planner unavailable")
                    db.commit()
                    transition(db, parent, "failed", "Planning failed")
            return None
        payload = extract_json(result.text)
        if payload is None:
            return None
        try:
            return TaskPlan.model_validate(payload)
        except ValueError:
            return None

    def _parent_failed(self, parent_id: int) -> bool:
        with SessionLocal() as db:
            parent = db.get(Task, parent_id)
            return parent is not None and parent.status == "failed"

    def _cancel_remaining(self, child_ids: list[int]) -> None:
        with SessionLocal() as db:
            for child_id in child_ids:
                child = db.get(Task, child_id)
                if child is not None and child.status in ("pending", "queued"):
                    transition(db, child, "cancelled", "Cancelled with parent task")

    def _review_and_finish(self, provider: AIProvider, parent_id: int, model: str, timeout_s: int,
                           instruction: str, outputs: dict[int, str]) -> None:
        """Legacy ai_plan reviewer: a missing or unreadable verdict is a failure, never a pass."""
        summary = "\n\n".join(f"## Step {index}: {text}" for index, text in sorted(outputs.items()))
        reviewer = dataclasses.replace(REVIEWER, model=model)
        review = self._call(provider, reviewer,
                            f"Original request:\n{instruction}\n\nDelivered work:\n{summary}"[:4000],
                            timeout_s, parent_id)
        verdict = extract_json(review.text) if review.ok else None
        with SessionLocal() as db:
            parent = db.get(Task, parent_id)
            if parent is None or self._cancelled(parent_id):
                return
            if verdict is not None and "approved" in verdict:
                approved = bool(verdict.get("approved"))
                notes = str(verdict.get("notes", ""))[:500]
                add_event(db, parent_id, "reviewed", f"Reviewer {'approved' if approved else 'rejected'}: {notes}")
                db.commit()
                if not approved:
                    transition(db, parent, "failed", "Reviewer rejected the result")
                    return
                save_result(db, parent, summary)
                transition(db, parent, "completed", "AI plan completed")
            else:
                reason = review.error if not review.ok else "unparseable verdict"
                add_event(db, parent_id, "review_failed", f"Review could not run ({reason}); not treating as approval")
                db.commit()
                transition(db, parent, "failed", "Review unavailable")
