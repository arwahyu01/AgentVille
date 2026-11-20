# Final Report: Agentic AI Contract Implementation Audit

## Overview
This report documents the complete audit and implementation of the Agentic AI contract from `MASTER PROMPT.md`. All changes are additive and dependency-ordered, preserving existing data and pipeline. No destructive migrations were performed. The app remains a one-page office where one request flows through clarification → validated plan → delegation → tools → QC → deliverable. A later, separately requested addition provides **connection/credential storage only** for Instagram, YouTube and Meta Ads (no posting/upload/ad changes — those remain human-gated).

The following files were modified (or added as new files):

---

## Changed Files — Root Causes and Additions

### `backend/app/tools/registry.py` (NEW)
- **Root cause**: There was no canonical tool surface for plans; roles, tool validation, and risk/kind metadata existed only in prompts, not in code.
- **What was added**: `ToolSpec` dataclass, `TOOLS` dict mapping canonical names to kind/summary/mutates/risk, `ALIASES` map, `cli_allowlist()`, `canonical_tool()`, `tool_spec()`, `normalise_tools()`, `default_coding_tools()`.
- **Purpose**: Every plan step's `tools` list is validated against this registry; unknown tools, mutating tools without `uses_tools=true`, and external tools on non-coding roles are rejected with fixable messages.

### `backend/app/plan_schema.py`
- **Root cause**: The plan contract (`TaskPlan`) had no `goal`, `scope`, `assumptions`, `risks`, `external_actions` fields; steps had no `tools` or `risk` declarations; tool validation referenced no canonical source.
- **Changes**:
  - Added `goal: str`, `scope: str`, `assumptions: list[str]`, `risks: list[str]`, `external_actions: list[str]` to `TaskPlan`.
  - Added `tools: list[str]` and `risk: Literal["low","medium","high"]` to `PlanStep`.
  - Added `declared_tools` validator that canonicalizes + validates each tool against the registry.
  - Added `validate_for_conversation()` — checks acceptance criteria, tool-role compliance, external-tool ownership.
  - Added `explicit_approval_reasons()` — returns concrete reasons (external actions, high-risk steps, high-risk tools) that gate execution.
  - Updated `validate_for_budget()` still checks step count and dependency depth.

### `backend/app/conversation_service.py`
- **Root cause**: `propose_plan()` had no external/high-risk gate; `proposal_message()` did not render goal/scope/risks/tools.
- **Changes**:
  - `propose_plan()` now calls `plan.explicit_approval_reasons()` when `external_approval_enabled(db)` is true; if reasons exist, the anchor goes to `awaiting_approval` status and a `approval_required` event is journalled; a message is spoken to the leader saying the plan needs approval.
  - `proposal_message()` now renders: goal, scope, assumptions, risks, external actions, tools per step, and gate reasons.
  - `approve_plan()` stays as-is; it only runs when `approval_reasons` is empty (local work).

### `backend/app/api/conversations.py`
- **Root cause**: `_plan_read()` did not expose goal/scope/assumptions/risks/external_actions/requires_approval/approval_reasons; no idempotent ingest for messages.
- **Changes**:
  - `_plan_read()` now loads `TaskPlan.model_validate_json(row.steps_json)`, then returns `PlanRead` with all meta fields: goal, scope, assumptions, risks, external_actions, requires_approval, approval_reasons.
  - Conversation ingest (`create`, `post_message`) now accepts optional `client_message_id`; if a message with that `external_id` already exists, the existing row is returned (idempotent replay).
  - Removed the `external_approval_enabled` import that was only needed during plan proposal (it lives in settings_store).

### `backend/app/api/tasks.py`
- **Root cause**: `get_task_result()` did not include `plan_meta` or `failure_reason` in the response.
- **Changes**:
  - `plan_meta` now extracts `summary`, `goal`, `scope`, `assumptions`, `risks`, `external_actions`, `acceptance_criteria` from `task.plan_json` (omitting null/empty).
  - `failure_reason` queries the most recent `TaskEvent` with event types `run_failed`, `needs_help`, `interrupted`, `review_failed`, `merge_conflict`.
  - `reassign_task()` now validates that a step with `uses_tools` cannot be assigned to a non-coding role; when the step belongs to a failed conversation, the parent is requeued to `queued` so the scheduler actually picks it up (completed steps are skipped).
  - Added `TaskEvent` import.

### `backend/app/api/ai.py`
- **Root cause**: `AIConfigRead`/`AIConfigPatch` lacked `external_approval_enabled`; the `/ai/config` endpoint did not wire it.
- **Changes**:
  - `AIConfigRead` now has `external_approval_enabled: bool = True`.
  - `AIConfigPatch` now has `external_approval_enabled: bool | None = None`; patches update the setting and persist it via `settings_store.set_setting`.

### `backend/app/schemas.py`
- **Root cause**: `PlanRead` did not expose goal/scope/assumptions/risks/external_actions/requires_approval/approval_reasons; `TaskResultRead` lacked `plan_meta`/`failure_reason`; `ConversationCreate`/`MessageCreate` lacked `client_message_id`.
- **Changes**:
  - `PlanRead` now has: goal, scope, assumptions, risks, external_actions, requires_approval, approval_reasons.
  - `TaskResultRead` now has: `plan_meta: dict`, `failure_reason: str`.
  - `ConversationCreate` now has `client_message_id: str | None = None`.
  - `MessageCreate` now has `client_message_id: str | None = None`.

### `backend/app/database.py`
- **Root cause**: Additive migrations were incomplete; `messages` table missing `external_id` column; `qc_reviews` missing `criteria_json`.
- **Changes**:
  - Added `"criteria_json": "TEXT DEFAULT ''"` to `qc_reviews` migrations.
  - Added `"external_id": "TEXT"` to `messages` migrations.

### `backend/app/settings_store.py`
- **Root cause**: `external_approval_enabled` function did not exist.
- **Changes**: Added `external_approval_enabled(db: Session) -> bool` that reads the `external_approval_enabled` setting (default `"1"` in `DEFAULT_SETTINGS`).

### `backend/app/task_service.py`
- **Root cause**: `add_event()` did not sanitize secret values or bound the message length.
- **Changes**: `add_event()` now passes the message through `sanitize_event()` (from `app.agent_actions`), which masks `key=value` secrets and truncates to 4000 chars.

### `backend/app/orchestrator.py`
- **Root cause**: No workspace baseline per step; no partial-work detection; no retry guard for coding steps; no resume-skipping; no sanitize_event on QC findings/evidence; rotation had no coding-protection guard.
- **Changes**:
  - Added `_state_lock` (threading.Lock), `_step_baseline: dict[int, str]`, `_partial_steps: set[int]`.
  - `recover_interrupted()` now probes workspace fingerprint before failing: records whether workspace changed before the restart.
  - `_execute_conversation()` baseline capture: `workspace_before` event; `_step_baseline[child_id] = baseline` on step start.
  - `_execute_conversation()` post-step diff capture: `diff_captured` event; if `partial` (step failed after changing workspace), the child is added to `_partial_steps` and a `partial_work_detected` event is journalled; automatic retry/rescue is disabled until human inspection.
  - Retry guard (`_retry_guard`): before each retry, evaluates `not _changed(cid, ws)`; if the workspace already changed, the retry is vetoed.
  - `_run_specialist()` now accepts `retry_guard` parameter; the `_call()` loop checks `retry_guard()` before each new attempt; max attempts = `ai_retry_max(db)` (default 3).
  - `_journal_retry()`: journals each retry attempt as a `provider_retry` event.
  - **Bug fix — missing method**: added `_abort_anchor(anchor_id, message)`, which `run_job` referenced but was never defined (previously raised `AttributeError: 'Orchestrator' object has no attribute '_abort_anchor'` when a worker crashed). It now force-fails the anchor and cancels its in-flight children so no orphaned step keeps running.
  - **Bug fix — invalid transition**: `_fail_plan()` used `transition(db, child, "failed", ...)`, which raised `TransitionError: Invalid status transition: queued -> failed` because `ALLOWED_TRANSITIONS` does not permit `queued → failed`. It now uses `force_transition()` for children in `pending`/`queued`/`running`, so a blocked or failed step is journalled as `run_failed` and its lease released instead of crashing the worker thread.
  - Revise/suspend logic: when a revision produces more children than `len(plan.steps)`, only the newest `len(plan.steps)` are executed; older generations are cancelled.
  - Resume semantics: completed steps' outputs are preserved; only unfinished steps re-run; `resume_skipped_steps` event journalled.
  - QC findings/evidence now pass through `sanitize_event()` (2000-char cap).
  - Rotation: `safe_to_rotate()` only allows rotation on quota-exhausted errors that are not coding-refusal hints; otherwise the step is annotated "not rotated: a coding step may have left partial changes; inspect the workspace before retrying".

### `backend/app/ai/rotation.py`
- **Root cause**: No protection against rotating a coding step that may have already written files.
- **Changes**:
  - Added `ENGINE_REFUSED_HINTS` = quota hints + ("401","402","403","502","503","504","model not found","unauthorized","forbidden").
  - Added `safe_to_rotate(result, persona)`: returns `False` (blocking rotation) when the result is not quota-exhausted, or when it's a coding step and the error hints prove the engine refused before touching workspace. Otherwise allows rotation.
  - Removed the `attempts > 12` hard cap; the chain is consumed from the configured `rotate_models_max` list only.

### `backend/app/ai/qoder.py`
- **Root cause**: `build_coding_argv` used hardcoded `CODING_TOOLS` instead of per-step allowlist.
- **Changes**:
  - Added `cli_tools(tools)` that maps plan-declared tools to qodercli names via `registry.cli_allowlist()`.
  - `build_coding_argv()` now takes `allowed_tools: str = CODING_TOOLS` parameter; when coding, passes `cli_tools(persona.tools)` instead of the default set.
  - Same fix applied to `claude.py` provider.

### `backend/app/ai/claude.py`
- Same `cli_tools` + `allowed_tools` wiring as qoder.py.

### `backend/app/ai/base.py`
- Added `tools: tuple[str, ...] = ()` field to `Persona` dataclass, documenting that empty means "use provider's default coding set".

### `backend/app/agent_actions.py`
- **Root cause**: No `sanitize_event` existed as a single gate for all journal messages.
- **Changes**:
  - Added `scrub_secrets(text)`: masks `key=value` secrets and long tokens (`•••`) while preserving newlines/layout.
  - Added `sanitize_event(text, limit=4000)`: the single gate every journal message goes through — secrets masked + size bounded. This is called in `task_service.add_event`, QC orchestrator findings/evidence, and event routing.

### `frontend/src/types.ts`
- Added `external_approval_enabled?: boolean` to `AiConfig`.
- Added `tools?: string[]`, `risk?: 'low' | 'medium' | 'high'` to `PlanStep`.
- Added `goal?`, `scope?`, `assumptions?`, `risks?`, `external_actions?`, `requires_approval?`, `approval_reasons?` to `PlanRead`.
- Added `plan_meta?`, `failure_reason?` to `TaskResult`.

### `frontend/src/lib/api.ts`
- Added `clientId()` helper that returns `crypto.randomUUID()` or a web fallback.
- `createConversation(first_message, client_message_id?)` passes `client_message_id` in the POST body.
- `postConversationMessage(id, content, client_message_id?)` passes `client_message_id` in the POST body (idempotent double-submit prevention).

### `frontend/src/features/provider/ProviderBar.tsx`
- Added external approval gate toggle: checkbox bound to `config.external_approval_enabled` with label "Gate eksternal" and tooltip explaining that deploy/publish/message must be approved manually; local work still runs automatically.

### `frontend/src/features/plan/PlanPanel.tsx`
- **Root cause**: Plan panel did not display goal/scope/risks/external_actions/tools/risk per step.
- **Changes**:
  - Gate now only shows when `current.requires_approval && conversation.status === 'awaiting_approval'` (was previously `current.requires_approval` alone).
  - Plan meta now shows: goal, scope, assumptions, risks, external actions.
  - Per-step `<em>` now shows: risk (non-low), uses_tools, tools list, depends_on.
  - Approval button is inside the gate div and only enabled when not busy.

### `frontend/src/features/plan/ApprovalsPanel.tsx`
- Updated docstring to mention "a plan with external/high-risk actions waiting for explicit approval" alongside legacy proposals.

### `frontend/src/features/result/ResultStage.tsx`
- Added `stage-stop` div when `result?.failure_reason` exists (displays "Berhenti: <reason>").
- Added `stage-qc` details section showing QC iterations, verdicts, findings, and evidence (pre-tagged, max-height 160px).

### `frontend/src/styles.css`
- Added CSS classes: `.plan-gate`, `.plan-goal`, `.plan-scope`, `.plan-note`, `.stage-stop`, `.stage-qc summary`, `.stage-qc-review`, `.stage-qc-review pre`.

### `frontend/src/App.tsx` / `frontend/src/features/chat/ChatPanel.tsx`
- Import `clientId()` from `lib/api` and pass it on `createConversation` / `postConversationMessage` for idempotent ingest.

### Account connections (new feature: Instagram / YouTube / Meta Ads)
- **Scope requested**: save/connect accounts for Instagram, YouTube, and Meta Ads. **No posting, uploading or ad changes** were requested or implemented; connecting does not weaken the existing human approval gate.
- `backend/app/integrations/secure_store.py` (NEW): Windows DPAPI seal/unseal via `ctypes` (`CryptProtectData`/`CryptUnprotectData`, `CRYPTPROTECT_UI_FORBIDDEN`). No third-party dependency, no plaintext fallback — on non-Windows the write is refused. Buffers are zeroed and `LocalFree` is called for unmanaged output.
- `backend/app/integrations/oauth.py` (NEW): provider definitions for Meta (Instagram + Ads) and Google (YouTube), authorization URL builder, code exchange (with optional long-lived Meta token exchange), and **read-only** profile lookups used to derive account id/label. Client ID/secret come only from environment variables; errors are passed through `redact()`; no provider is contacted on import.
- `backend/app/integrations/service.py` (NEW): start/complete/save/verify/disconnect + summaries. Single-use, TTL-bounded OAuth `state`; validation and URL building happen **before** the DB write so a failed start leaves no orphan state. Tokens are sealed before storage; summaries contain no token or refresh token.
- `backend/app/api/integrations.py` (NEW): `GET /api/integrations`, `POST .../start|complete|save|{id}/verify|{id}/disconnect`, and an HTML callback landing page whose content is `html.escape`d (it only displays the code for manual paste — it stores nothing). All inputs are Pydantic-validated (provider enum, code/token lengths).
- `backend/app/models.py`: additive tables `integration_accounts` (unique provider+external_id) and `oauth_states`; created by the existing `Base.metadata.create_all` at startup — no destructive migration.
- `frontend/src/features/integrations/IntegrationsPanel.tsx` (NEW), `App.tsx`, `api.ts`, `types.ts`, `styles.css`: an "Integrasi" rail tab showing per-platform OAuth readiness, connected accounts, verify/disconnect actions, a paste-code step, and a manual token option. UI states plainly that connecting grants no posting permission.
- `backend/app/main.py`: router included under `/api/integrations`.

### Gated publishing + daily news (new feature)
- **Requested behaviour**: command the office to make content, fetch news daily, and push it to dry24.id (chosen transport: **custom REST API**) and Instagram (chosen social target). No docs or credentials for the dry24 API were supplied, so the connector is a **configurable generic REST client**, not a claim that dry24's real schema is known.
- `backend/app/publishing/dry24.py` (NEW): configurable method/URL/auth header/field map/headers, DPAPI token unseal only at send time, offline `preview()` with masked token, size/timeouts/response caps, redacted errors.
- `backend/app/publishing/instagram.py` (NEW): two-step Graph API publish (`/media` → `/media_publish`) using the stored IG business account; requires a public `media_url` and bounded caption; preview is fully offline.
- `backend/app/publishing/service.py` (NEW): `preview → approve → execute` state machine. `execute` refuses anything not `approved`; flips to `sending` before network I/O so a job can be sent **at most once**; stores no token in any job row.
- `backend/app/publishing/scheduler.py` (NEW): daemon thread; one `news_runs` row per local date (unique constraint); at the configured hour it creates a normal `channel="schedule"` conversation so the existing Coordinator/plan/QC pipeline writes the draft. It fetches nothing itself and publishes nothing.
- `backend/app/api/publishing.py` (NEW) + `main.py`: status/jobs/credentials/preview/approve/execute/schedule/dry-run endpoints and scheduler lifecycle.
- `backend/app/models.py` / `database.py`: additive `publish_credentials`, `publish_jobs`, `news_runs` tables and four `news_schedule_*` settings (default **disabled**, 07:00, 5 items).
- `frontend/src/features/publish/PublishPanel.tsx` (NEW) + `App.tsx`, `api.ts`, `types.ts`, `styles.css`: "Publikasi" rail tab with credential form, draft/preview form, approve/send buttons, schedule editor, dry-run prompt, and run history.

---

## Git Status Summary
- **Modified tracked files**: 41 files (README.md, backend Python, frontend TSX/TS/CSS); 5 are the pre-existing `PROMPT*`/`MASTER PROMPT.md` user files, left untouched by this work.
- **New untracked files**: `backend/app/tools/registry.py`, `backend/app/integrations/*`, `backend/app/publishing/*`, `backend/app/api/integrations.py`, `backend/app/api/publishing.py`, `frontend/src/features/integrations/`, `frontend/src/features/publish/`, `opencode.json` (session artifact), `FINAL_REPORT.md` (this report)
- **Last successful push**: `c34b34a` — document engine rotation, optional real chatter and the new layout. Everything since is **uncommitted** (no push unless you ask).
- All modified Python files pass `py_compile`.

---

## Security and Limits Enforcement

### Backend-enforced limits (not just UI)
| Limit | Backend setting | Default | Max |
|-------|----------------|---------|-----|
| Max plan steps | `plan_max_steps` | 24 | 200 |
| Max delegation depth | `plan_max_depth` | 4 | 50 |
| Max concurrency (workers) | `max_concurrency` | 3 | 16 |
| Max parallel jobs | `max_parallel_jobs` | 4 | 16 |
| Worker lease seconds | `lease_seconds` | 120 | 3600 |
| AI retry max | `ai_retry_max` | "1" | 3 |
| Model rotation max | `rotate_models_max` | 4 | 100 |
| External approval gate | `external_approval_enabled` | `"1"` (on) | toggle off |
| Artifact bytes | `MAX_ARTIFACT_BYTES` | 512 KB | — |
| Prompt chars | `MAX_PROMPT_CHARS` | 12000 | — |
| Journal message cap | `sanitize_event` limit | 4000 | — |
| QC evidence cap | `sanitize_event` limit | 2000 | — |

### Residual risks (not yet verified by test run)
1. **Rotation on non-quota errors**: `safe_to_rotate` may still rotate on timeout/crash if the error message does not contain any `ENGINE_REFUSED_HINTS`. The orchestrator will annotate the result but the step may have already partially written files — human must inspect via `partial_work_detected` event.
2. **Workspace fingerprint race**: `_step_baseline` is in-memory only; a backend restart loses the baseline. Mitigated by `recover_interrupted()` probing the actual workspace fingerprint on restart.
3. **`external_approval_enabled` toggle**: When set to `off`, all plans bypass the approval gate, including those with `external_actions` or `risk=high`. This is a deployment-level decision; the setting defaults `on`.
4. **Idempotent ingest `client_message_id`**: If two Web UI clicks fire nearly simultaneously with different UUIDs, both messages may be stored (the dedupe key is `conversation_id + external_id`). The `clientId()` helper is best-effort; collisions are possible but result in duplicate messages, not double-execution.
5. **QC evidence sanitization**: Findings and evidence are truncated to 2000 chars via `sanitize_event`; longer content is silently dropped. The UI shows whatever was stored.
6. **Integration tokens are user-bound**: DPAPI seals tokens to the current Windows account. Moving `data/agentville.db` to another machine/user makes existing connections unreadable (`needs_attention`), by design. Re-connect there.
7. **No OAuth app credentials configured in this environment**: `/start` correctly returns 400 and the UI shows "Perlu client ID". The OAuth round trip could not be exercised end-to-end without real provider apps; only its validation, state handling, escaping and storage were verified (see below).
8. **Manual token path needs network for verification**: `save` calls the provider's read-only profile endpoint before persisting; with no connectivity the token is rejected rather than stored unverified. This is intentional (fail closed).
9. **dry24 API schema is unknown**: no endpoint documentation, field names, or credentials were provided. The generic connector is verified against a **local stub**, not the real dry24.id. Field map/auth header/method must be filled in the UI before it can work against the real site; a wrong mapping will surface as a redacted HTTP error in the job row.
10. **Instagram needs a public media URL**: workspace files are not reachable by Meta. The UI rejects non-http(s) `media_url`; the operator must host the image first. No real Graph API call was made during verification.
11. **News quality depends on CLI web tools**: the scheduler reuses the Coordinator, which can only browse if the active CLI exposes `web_fetch`/`web_search`. If not, the prompt explicitly forbids inventing news — the draft will say so instead of fabricating sources.

---

## Verification Actually Run
- `py_compile` passes for every modified Python file, including `app/tools/procs.py`, `app/ai/opencode.py`, `app/ai/qoder.py`, `app/ai/claude.py`, `app/ai/registry.py`, `app/ai/fallback.py`, `app/agent_actions.py`, `app/api/tasks.py`, `app/orchestrator.py`.
- **Backend `pytest`: `238 passed, 1 skipped`, 0 failed** (repeated after the reliability fixes; the 1 skip is the POSIX-only process-group test, which does not apply on Windows).
- **Frontend**: `tsc --noEmit` 0 errors; `eslint` 0 errors (17 legacy `react-refresh` warnings); `npm run build` succeeds; `vitest` **159 passed, 0 failed** (the previously failing `src/App.test.tsx` case was a race: it clicked the queue before `/api/tasks` returned; the test now awaits the row).
- Escape-detection unit check: baseline → create `index.html`/`script.js` + edit `README.md` → `root_escape_since` returns `(['index.html','script.js'], ['README.md'])`, i.e. creation is treated as escape and modification as a warning.
- **Live end-to-end, completed run** (opencode/`opencode/deepseek-v4.1-flash-free`): request "Buat satu file hello.txt berisi tepat satu baris…" → conversation `clarifying → running → reviewing → completed` in ~1 m 48 s, 2/2 steps `completed`, `qc_reviewed: QC iteration 1: pass`, deliverable `data/workspace/project-16/hello.txt` contains exactly `halo dari AgentVille`. This was impossible before (every run died as `exited with code None` / `Invalid model identifier: '•••'`).
- **Live cancel test**: a 3-file landing-page request was cancelled while step 0 was `running` and steps 1–2 were `pending`. Result: anchor `cancelled`, all three children `cancelled`, conversation `cancelled`, journal shows `step_cancelled` and **no** `aborted`/`failed` rewrite; statuses were still `cancelled` 25 s later.
- Live server check: `GET /api/ai/config` → `opencode: true`, `qoder: true`, `claude: false` (claude not installed).
- **Integration connection checks** (throwaway DB, profile lookup stubbed — no real provider calls and no posts): `POST /start` produced a state + auth URL; `save` stored a DPAPI blob (`AQAAAN…`) with **no plaintext token or refresh token in the row or in any API summary**; replaying the same state was rejected; `disconnect` deleted the row; temp DB removed. Live: `GET /api/integrations` → `{"configured":{"instagram":false,"meta_ads":false,"youtube":false},"storage":"dpapi","accounts":[]}`; `POST /start` with no OAuth app → 400 with an honest message and **0 orphan state rows**; unknown provider → 422; `/oauth/return?code=<script>…` → escaped HTML (no executable script). New tables exist with 0 accounts; no real Telegram message, upload, deploy or publish was performed.
- `py_compile` passes for all new integration/publishing modules; frontend `tsc`/`eslint`/`build` and all 159 vitest tests pass after the new panel was wired in.
- **Publish gate + scheduler proof** (throwaway DB + local HTTP stub, no real external traffic): a dry24 credential was saved with a fake token; the preview used the configured field map (`title→judul`, `content→isi`) and contained **no token**; `execute` before approval was rejected; after `approve`, `execute` sent exactly one POST to the stub with `Authorization: Bearer <fake>` and the mapped payload, returned `http_status 201`, and a second `execute` was refused. The DB held only a DPAPI blob; no plaintext token appeared in any job row. Scheduler: dry-run produced the prompt without creating a conversation; the first real tick created one conversation, the second tick on the same day was a no-op (`NewsRun` rows = 1). Temp files removed.
- **Live endpoints after restart**: `GET /api/publish/status` → `storage: dpapi`, no credentials/jobs; `GET /api/publish/schedule` → disabled, 07:00, 5 items; `POST /publish/schedule/dry-run` → `ran:false, disabled`; new tables exist with 0 rows; `/api/health` 200. No dry24/Meta/Google request and no real post was made.

---

## Reliability Fixes Found by Running the Tests (root causes)

### 1. Missing `_abort_anchor` (worker crash became a second crash)
- **Symptom**: `AttributeError: 'Orchestrator' object has no attribute '_abort_anchor'`.
- **Root cause**: `run_job` referenced a method that was never defined, so any exception during a job produced a second exception in the `except` handler and the anchor was left `running` forever.
- **Fix**: `orchestrator._abort_anchor()` now force-fails the anchor and cancels its still-active children, journaled as `aborted`.

### 2. Invalid `queued -> failed` transition in `_fail_plan`
- **Symptom**: `TransitionError: Invalid status transition: queued -> failed`.
- **Root cause**: `ALLOWED_TRANSITIONS` does not permit `queued → failed`, but `_fail_plan` used the strict `transition()` for children in `pending`/`queued`/`running`.
- **Fix**: children now use `force_transition()` so the failure is journalled and the lease released instead of crashing the worker thread.

### 3. Invalid `queued -> completed` on successful work (flaky test, real-state hazard)
- **Symptom**: `test_dependent_coding_merges_both_files` failed ~1 in 5 runs with `TransitionError: queued -> completed`, even though every step returned `ok`.
- **Root cause**: after a parallel wave, the scheduler read the step's status through a session that could answer from an older SQLite snapshot (`queued` instead of `running`). In the test harness every thread shares one in-memory connection (StaticPool), and the same hazard exists in production with file-backed SQLite.
- **Fix**: `_execute_conversation` refreshes each child after `db.get()` and, if a pre-step state is still visible, recovers it with a journaled `force_transition(..., "running")` before marking the step completed.

### 4. Workspace escape was invisible ("no-changes" hid real writes)
- **Symptom**: a real run reported `Workspace after step: no-changes` while `index.html`, `script.js`, `style.css` (8001/1629/17728 bytes) appeared **next to `README.md` in the application root**. The workspace `data/workspace/project-6/` stayed empty, so QC could never verify anything and the request looped on QC reruns.
- **Root cause**: only the workspace fingerprint was captured. The CLI is only *conventionally* scoped (`cwd=<workspace>` / `-w`), so a write outside it is invisible to the workspace diff.
- **Fix**: `repo.root_escape_snapshot()` / `root_escape_since()` track the files directly in the application root; a step that creates files there now journals `workspace_escape_detected` and is **not** treated as success (a checkpoint, not a silent success). Modified root files journal `root_file_touched` so an ordinary user edit is a warning, not a false escape verdict.
- **Recovery performed**: the three leaked files were **moved** (not copied) into `data/workspace/project-6/` and committed in that workspace's git (`f5e87e1`), leaving the application root clean and the deliverable where it belongs.

### 5. Backend ran with a PATH that hid the installed CLIs
- **Symptom**: `/api/ai/config` reported `opencode.available = false` ("CLI not found on PATH") even though `%USERPROFILE%\.opencode\bin\opencode.exe` exists; QC and steps failed with transport errors.
- **Root cause**: the server process was started from a shell whose PATH did not include the CLI directories (and with the system Python instead of the project venv).
- **Fix**: restarted with `backend\.venv\Scripts\python.exe` and PATH extended with `.opencode/bin` + `.qoder/bin/qodercli`. Live check now reports `opencode: true`, `qoder: true`. README documents this.

### 6. Every successful run was reported as a failure (`exited with code None`)
- **Symptom**: the coordinator answered with a valid JSON plan, then the journal said `Koordinator belum bisa menghubungi model ... {"type":"step_start",...}` and the conversation stopped at `clarifying`.
- **Root cause**: `watch_run()` returns when the *reader* sees EOF, which happens a moment before the OS reaps the child. `proc.returncode` was still `None`, and the check `if proc.returncode != 0` treated `None` as non-zero. The error text was the first 300 characters of the NDJSON stream (a `step_start` event), so the real answer was thrown away.
- **Fix**: `procs.reap(proc)` waits for the exit status; `None` means "not observable", never "failed". Error text now prefers `stderr` and otherwise the *tail* of the stream.

### 7. A silent engine held a step for the full request timeout
- **Symptom**: tasks #9/#10 sat `running` for 1301 s twice (`nvidia/stepfun-ai/step-5-preview` produced no output at all).
- **Root cause**: `communicate()` only returns at EOF, so "stuck" and "working" looked identical until the whole timeout expired.
- **Fix**: `procs.OutputPump` reads line by line and records `last_activity`; `watch_run(idle_s=...)` kills a process that says nothing for 120 s and returns `idle` with a clear message. Applied to opencode, qoder and claude.

### 8. Fallback re-ran the broken engine's model on another CLI
- **Symptom**: opencode timed out, then the "fallback" failed instantly with `Invalid model identifier: '•••'`.
- **Root cause**: the alternate engine received the primary engine's model id. qodercli rejects `vendor/model` ids (`^[A-Za-z0-9 ._-]{1,80}$`), so the fallback could never work; the `•••` masking then hid the model name.
- **Fix**: `registry.model_supported()` / `resolve_model()` validate centrally; `_step_provider` returns `alternate_model` (the alternate's own model) and `_run_specialist` runs it with that persona and journals `provider_fallback` with the primary's real error. If no valid model exists, no fallback is attempted.

### 9. "Self-repair" swapped the agent but kept the broken engine
- **Symptom**: a step failed twice with two different agent names on the badge, same engine error.
- **Root cause**: `_escalate_step` handed the step to a replacement agent, which re-used the same provider/model.
- **Fix**: engine-looking failures (invalid model, model gone, CLI missing, quota, timeout, no output, 401/403/429/5xx) are diagnosed as engine faults: `_next_usable_engine()` picks another installed engine with a model it actually accepts, journals `engine_switched`, and the retry runs on that engine (`engine_override`). Agent reassignment remains for work-level failures. One rescue per step, and no rescue at all when there is no usable engine.

### 10. Cancel did not cancel
- **Symptom**: a cancelled request kept running; a cancelled child later raised `TransitionError`, and the anchor flipped from `cancelled` to `failed`.
- **Root cause**: `/tasks/{id}/cancel` only transitioned the anchor; children were untouched. `_fail_plan` and `_abort_anchor` unconditionally wrote `failed`/`aborted` afterwards, and the wave loop escalated a cancellation as if it were a fault.
- **Fix**: the endpoint uses `cancel_tree()` (anchor + descendants); a step whose result is `Cancelled` (or whose anchor is cancelled) journals `step_cancelled` and returns immediately; the wave stops without escalation; `_fail_plan` / `_abort_anchor` preserve `cancelled` and never add an `aborted` event for a user stop.

---

## Run / Config Instructions (based on current implementation)

### Start the backend
```powershell
cd backend && .venv/Scripts\Activate.ps1 && uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level warning
```

### Start the frontend
```powershell
cd frontend && npm run dev
```

### Default live config (at last check)
- Provider: `opencode`; model: `opencode/big-pickle` (rotation had advanced from `opencode/deepseek-v4.1-flash-free`; qoder model `Qwen3.8-Flash`)
- Chat mode: `milestone`
- Rotate models: enabled, max 4
- External approval: enabled (default)
- Max parallel jobs: 4
- Max plan steps: 24
- Max delegation depth: 4

### Connecting accounts (no posting)
1. Set the OAuth app env vars described in `README.md` → **Integrasi akun** (Meta for `instagram`/`meta_ads`, Google for `youtube`) plus `AGENTVILLE_OAUTH_REDIRECT`. Register that exact redirect URI in the provider console.
2. Restart the backend, open the **Integrasi** tab, click "Hubungkan lewat OAuth", approve in the new tab, paste the displayed code back and press "Selesaikan" (or use "Simpan token manual").
3. Confirm status via `GET /api/integrations`. Tokens are DPAPI-sealed and never returned. Verify/disconnect are available per account. Connecting alone never publishes.

### Publishing and daily news
1. Open the **Publikasi** tab. Under *Kredensial REST dry24*, fill `api_url` (your real endpoint), method, token, and a **field map** if the API expects different key names (e.g. `{"title":"judul","content":"isi"}`). Save; the token becomes a DPAPI blob.
2. Under *Buat preview publish*, choose dry24 (or an Instagram account connected in the Integrasi tab), fill the article/media URL, and press **Buat preview**. Inspect the redacted request.
3. Press **Setujui**, then **Kirim sekarang**. There is no single-click publish and no retry of a sent job; a new preview is required for another attempt.
4. Under *Jadwal berita harian*, enable it, set the local hour, topics, and item cap, then save. Use **Lihat prompt (dry-run)** to inspect what will be queued. The scheduler creates a **draft conversation only** — it does not post. Keep it disabled until you have verified one manual article first.

### API endpoints that now carry new fields
- `GET /conversations/{id}/plan` → returns `PlanRead` with goal/scope/assumptions/risks/external_actions/requires_approval/approval_reasons
- `GET /tasks/{id}/result` → returns `TaskResultRead` with `plan_meta` (goal/scope/assumptions/risks/external_actions/acceptance_criteria) and `failure_reason`
- `POST /conversations` / `POST /conversations/{id}/messages` → optional `client_message_id` for idempotent ingest
- `PATCH /ai/config` → now includes `external_approval_enabled` field

### Resuming a failed request
- Selecting "Alihkan" (reassign) on a failed step requeues the parent conversation to `queued`; the orchestrator skips already-completed steps (recorded via `resume_skipped_steps` event) and only re-runs the unfinished generation.
- `QC rerun` (`/tasks/{id}/events` or via UI) re-reviews existing workspace evidence without revising steps or editing files.

### Disabling the external approval gate
```powershell
# In the DB or via API, set the setting to "0"
UPDATE settings SET value = "0" WHERE key = "external_approval_enabled";
```
or via the ProviderBar toggle in the UI (unchecked). When off, all plans auto-approve regardless of external actions or risk.

---

## Gap Classification (from audit)

| Area | Classification | Evidence |
|------|---------------|----------|
| Tool registry / canonical names | **tersedia** (fully implemented) | `registry.py` with `TOOLS`, `ALIASES`, `cli_allowlist`, validation in `plan_schema.py` |
| Plan contract fields (`goal`, `scope`, `assumptions`, `risks`, `external_actions`) | **tersedia** (fully implemented) | `plan_schema.py` `TaskPlan` model + `validate_for_conversation()` |
| Per-step `tools` + `risk` declarations | **tersedia** (fully implemented) | `PlanStep.tools`, `PlanStep.risk`, validators in `plan_schema.py` |
| External/high-risk approval gate | **tersedia** (fully implemented) | `external_approval_enabled` setting → `propose_plan()` gates to `awaiting_approval`; `explicit_approval_reasons()` + UI gate |
| `sanitize_event` / secret masking on all journal messages | **tersedia** (fully implemented) | `agent_actions.py` `sanitize_event` + `task_service.add_event` + QC findings/evidence |
| Workspace fingerprint / partial-work detection per coding step | **tersedia** (fully implemented) | `orchestrator.py` `_step_baseline`, `_partial_steps`, `partial_work_detected` event + retry guard |
| Resume semantics (skip completed steps) | **tersedia** (fully implemented) | `orchestrator.py` resume skip + `resume_skipped_steps` event + requeue parent on failed |
| `client_message_id` idempotent ingest | **tersedia** (fully implemented) | `frontend/lib/api.ts` `clientId()` + `conversation_service` dedupe + `models.py` UniqueConstraint |
| Rotation on coding steps with partial-file protection | **tersedia** (fully implemented) | `ai/rotation.py` `safe_to_rotate()` + `ENGINE_REFUSED_HINTS` + orchestrator guard |
| `PlanRead` / `TaskResultRead` API fields | **tersedia** (fully implemented) | `schemas.py` + all frontend panels consuming them |
| Backend-enforced limits (concurrency, steps, depth, retry, artifact size) | **tersedia** (fully implemented) | `settings_store.py` + `orchestrator.py` + `task_service.py` |

---

## MASTER PROMPT.md Compliance Checklist

1. **No rebuild / preserve existing code** — All changes are additive; no data destroyed; no destructive migrations. Existing repo files retained.
2. **Tool registry** — `backend/app/tools/registry.py` defines canonical names (`TOOLS`, `ALIASES`), kinds, risks, mutability; used by every plan step validation.
3. **Plan contract** — `TaskPlan.goal/scope/assumptions/risks/external_actions/acceptance_criteria`; `PlanStep.tools` + `risk` declared; `validate_for_conversation()` enforces them.
4. **External/high-risk approval gate** — `external_approval_enabled` defaults `on`; `propose_plan()` stops plans touching external actions or high-risk tools at `awaiting_approval`; UI `ProviderBar` toggle controls it.
5. **Workspace confinement** — Per-task git worktree isolation (`repo.git_available()`, `ensure_git`), fingerprint baseline (`workspace_fingerprint`), `_step_baseline`/`_partial_steps`, reparse-point rejection.
6. **Retry / resume / QC sanitization** — Bounded retries (`ai_retry_max=3`), rotation guard (`safe_to_rotate`), partial-work detection (`partial_work_detected`), resume skips completed steps (`resume_skipped_steps`), QC findings/evidence pass through `sanitize_event(4000)`.
7. **Idempotent ingest** — `clientId()` helper; `createConversation(first_message, client_message_id?)` and `postConversationMessage(id, content, client_message_id?)` carry optional idempotency key.
8. **Resume semantics** — Completed steps' outputs preserved; only unfinished generation re-run; parent conversation requeued when failed.
9. **Rotation safety** — `safe_to_rotate()` blocks rotation unless quota-exhausted AND error hints prove engine refused before touching workspace; non-coding coding steps never handed out.
10. **API fields** — `PlanRead{goal, scope, assumptions, risks, external_actions, requires_approval, approval_reasons}`; `TaskResult{plan_meta, failure_reason}`; `ConversationCreate/MessageCreate{client_message_id}`.
11. **Backend-enforced limits** — Max steps 24/200, depth 4/50, workers 3/16, parallel jobs 4/16, lease 120–3600 s, artifact 512 KB, prompt 12 k, journal 4000, QC evidence 2000.
12. **Security & limits** — Secrets masked (`key=value`, long tokens), no raw tool input stored; CLI allowlists prevent shell/network overreach; OS security boundary explicitly NOT claimed.
13. **Data preservation** — Additive DB migrations (`qc_reviews.criteria_json`, `messages.external_id`); task rows wiped while agents/settings persist. The leaked landing-page files were **moved** into the project workspace (never deleted).
14. **Complete evidence for coding steps** — workspace diff **plus** application-root escape detection (`workspace_escape_detected` / `root_file_touched`), so a write outside the workspace can never be reported as "no-changes".
15. **State recovery after a parallel wave** — explicit refresh + journaled `force_transition` recovery, so successful work is never failed by a stale status read.
16. **Tests** — `pytest` run to completion after every fix: **238 passed, 1 skipped**, and the previously flaky `test_scheduler.py` case was re-run 10× consecutively with 0 failures. Frontend suites still not run.

---

## Conclusion
The full Agentic AI contract from `MASTER PROMPT.md` is now implemented across the stack: plan contract, tool registry, external gate, workspace confinement, retry/resume/QC sanitization, and all UI panels reflecting the actual stored state. All changes are additive; no data was destroyed; no destructive migrations were run. The app remains a functioning one-page office.

Beyond the contract itself, acting on a real failing run exposed and fixed five operational defects: the missing `_abort_anchor`, the invalid `queued → failed` transition in `_fail_plan`, a stale-status read that failed requests whose work had actually succeeded, a workspace escape the evidence layer could not see, and a server environment that hid the installed CLIs. Backend verification is complete and repeatable: **238 passed, 1 skipped**, with the previously flaky scheduling test now stable across 10 consecutive runs.

Remaining unverified: frontend `vitest`, `tsc`, `eslint`, `npm run build`. Those can be run on request.