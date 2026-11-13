# AgentVille — Keputusan Teknis

Dokumen ini mencatat keputusan arsitektur per fase. Beberapa keputusan Fase 3 sudah direvisi oleh produk MASTER PROMPT baru (percakapan + approval, provider ganda, tool nyata, SSE) — revisi ditandai jelas.

## Stack UI: CSS kustom, bukan Tailwind
Scaffold awal memakai `styles.css` kustom dengan design token sendiri dan sudah memenuhi kebutuhan dashboard. Migrasi ke Tailwind akan menulis ulang seluruh styling tanpa manfaat fungsional. Deviasi dari MASTER PROMPT (Tailwind default) dicatat.

## Komunikasi: SSE journal-tailing (revisi dari "polling 3 detik")
- Klaim Fase 3 ("polling cukup") **tidak berlaku lagi** untuk produk sekarang: frontend memakai **SSE** `GET /api/events/stream` (`app/events.py`, `lib/sse.ts` — EventSource + backoff reconnect otomatis + replay via `Last-Event-ID`).
- Implementasinya **DB-tailing** terhadap `task_events` (id = cursor), bukan in-memory EventBus seperti rencana awal. Alasan: satu-satunya produser event sudah thread sinkron (orchestrator) yang menulis ke SQLite; men-deliver dari DB membuat replay pasca-reconnect gratis, tidak ada bridging thread→event-loop yang rapuh, dan proses restart tidak kehilangan event. Deviasi ini disengaja dan terdokumentasi di docstring `app/events.py`.
- Polling REST tetap ada sebagai **safety net 15 detik** (bukan 3 detik) bila stream putus total.
- `PRAGMA busy_timeout=5000` diaktifkan per koneksi karena writer (orchestrator) dan reader (SSE tail + API) kini konkuren.

## Migrasi database ringan, bukan Alembic
- `create_all()` untuk tabel baru (`conversations, messages, plans, approvals, qc_reviews, telegram_updates`); kolom baru tabel existing lewat `COLUMN_MIGRATIONS`/`INDEX_MIGRATIONS` aditif (SQLite menolak default non-konstanta pada ALTER → backfill eksplisit, mis. `required DEFAULT '1'`).
- Database tidak pernah dibuat ulang; data pengguna bertahan. Alembic tetap ditunda sampai skema bercabang.
- `PRAGMA foreign_keys=ON` per koneksi.

## Lifecycle 9-state + gerbang approval struktural
Transisi (`task_service.ALLOWED_TRANSITIONS`, superset dari fase lama):
`pending → clarifying → awaiting_approval ⇄ clarifying (revisi) → approved → queued → running → reviewing → completed/failed`, dengan `running → reviewing → running` (iterasi QC) dan `failed → queued` (retry manual); `cancelled` dari state non-terminal.
- **Struktural, bukan konvensi**: subtask HANYA dibuat saat baris `Plan` ber-status `approved` ada; `POST /tasks/{id}/execute` menolak task `run_mode='conversation'` (422). Tidak ada jalur kode yang menjalankan tool tanpa approval.
- Approval terikat versi plan; approve vN lama saat current vN+1 → 409; request approve duplikat idempoten (unique `(plan_id, decision)` di `approvals`). Revisi material → versi baru membatalkan approval versi lama.
- Parent `completed` hanya jika semua child `required` selesai + QC `pass`; verdict tak terbaca atau provider error saat QC → `failed` (soft-fail `review_skipped → completed` warisan Fase 3 **dihapus**).

## Provider: dua CLI lokal di balik satu Protocol (revisi "text-only dulu")
- Fase 3: hanya `opencode run --format json` text-only. Sekarang `app/ai/registry.py` meroute persona→provider; `qodercli -p --output-format json` mendukung text (`--tools ""`) **dan coding** (`-w <workspace> --permission-mode accept_edits --allowed-tools Read,Write,Edit,Glob,Grep,Bash`).
- Fakta CLI diverifikasi terhadap binary terpasang (argv snapshot tests mengunci bentuk command; tidak ada tebakan nama flag).
- **Kedua CLI bisa mode coding** (revisi dari "opencode sengaja text-only"): `opencode run --auto` (flag ada di `opencode run --help` v2.1.4) dengan proses di-start `cwd=<workspace>`, dan `qodercli -w <workspace> --permission-mode accept_edits --allowed-tools ...`. Keduanya **convention scoping, bukan jail OS** — bukti perubahan tetap `capture_diff()` sebelum/sesudah langkah, dan `coding_flags` masing-masing provider dikirim ke UI lewat `GET /api/ai/config`.
- Model per provider diambil langsung dari CLI (`--list-models` / `opencode models`) dengan cache TTL; regex validasi longgar per provider; pemilihan provider/model = preferensi pengguna di DB, kredensial tetap level mesin (`opencode auth login` / login qoder). Tidak pernah ada API key di source/DB/frontend.

## Fallback eksplisit, bukan diam-diam
Hanya bila `fallback_enabled` DAN error cocok pola recoverable (quota/429/5xx/not found). Langkah **text** aman di-rerun di provider lain; langkah **coding** tidak pernah di-rerun tanpa memeriksa workspace: probe diff (`git status`) → kalau ada perubahan, tugas `failed` dengan keputusan user. Provider+model tercatat per langkah (Task, TaskEvent, hasil).

## Tool sandbox: confinement aplikasi-level, bukan security boundary
- `app/tools/workspace.py`: `resolve()` + `is_relative_to(root)` setelah canonicalization; path dengan reparse point (symlink/junction Windows) yang menunjuk luar root ditolak. Ini mempersempit kecelakaan, **bukan** jail OS — proses CLI tetap user-mode; dokumentasi jujur tentang batasnya.
- `app/tools/sandbox_exec.py`: argv list (tanpa shell), allowlist dari settings, timeout, batas byte output. `app/tools/procs.py`: `kill_tree(pid) -> bool` dua lapis di Windows — `taskkill /T /F` (CREATE_NO_WINDOW) untuk tree, lalu sweep `TerminateProcess` in-process atas descendant bila taskkill gagal/tidak tersedia; kegagalan taskkill tidak lagi dibuang (rc + output dicatat via `logging`, pid yang sudah mati = sukses, dan tidak di-sweep agar pid yang daur ulang tak jadi korban). Semua `Popen` eksekusi (`sandbox_exec`, `opencode`, `qoder`) memakai `start_new_session=True` supaya cabang POSIX `killpg` mengenai grup anak, bukan grup backend sendiri — sebelumnya anak mewarisi grup pemanggil sehingga `killpg` bisa membunuh runner-nya sendiri; `kill_tree` juga menolak `killpg` saat grup anak sama dengan grup kita. Prompt lewat stdin, `shell=False`.
- Fakta pemicunya: `python.exe` di dalam venv Windows hanyalah **stub redirector** — interpreter asli berjalan sebagai anak yang mewarisi handle pipe. Membunuh pid yang kita pegang saja tidak menutup pipe, jadi `communicate()` tetap blokir meski "proses sudah dibunuh"; pembuktian tes menggunakan EOF pipe, bukan polling pid.
- `app/tools/repo.py`: `git init` + baseline commit di `data/workspace/project-<anchor>`; `capture_diff()` (`git add -A; git diff --cached`, bounded) jadi **bukti QC** dan artifact `task-<id>.diff.txt`.

## Orkestrator: tetap satu daemon thread (concurrency 1)
Satu writer menyederhanakan klaim (tidak ada dua worker rebutan), urutan percakapan, dan batasan subprocess. Tick: (0) anchor approved → queued; (1) maksimal satu *conversation turn*; (2) klaim satu task queued → execute/QC. Paralelisme antar-staf ditunda — butuh klaim atomik + scheduler, di luar kebutuhan sekarang.
- Conversation turn hanya fired saat pesan terbaru ber-role `user` dan **setiap** hasil (ask/propose/error) menyimpan Message assistant → error provider tidak pernah loop-retry otomatis; user yang mengulang.

## QC nyata (revisi Reviewer Fase 3)
Reviewer persona = tahap workflow dengan kontrak terstruktur `{verdict pass|fail, criteria[{criterion,met,detail}], findings, failed_steps[], evidence}`; prompt berisi permintaan asli + acceptance criteria + output + diff. Fail → temuan dikirim ke agen pemilik langkah (`extra_prompt`), iterasi dibatasi `ai_retry_max`, tercatat sebagai baris `qc_reviews` + event `qc_reviewed`; child yang sudah completed di-rerun **tanpa** transisi status ganda (guard status saat itu). Verdict tak terparse = fail-keras (parent failed).

## Kanal: Web & Telegram ke satu pipeline
`channels/base.py` (ChannelEvent + Protocol) dan `channels/normalizer.py` (`ingest_message`) dipakai kedua kanal — tidak ada workflow AI terpisah per kanal. Telegram masuk: long-poll thread (getUpdates + offset persist), allowlist chat, dedupe `update_id` + unique `(conversation_id, external_id)`, oversize ditolak. Keluar: **semua** balasan Coordinator (pertanyaan, proposal, error) plus milestone, lewat **outbox persisten** `telegram_outbox` (`channels/outbox.py`) dengan `dedupe_key` unique → crash/restart tidak menghasilkan pesan ganda; chunk ≤4000 char di pemisah paragraf, retry ≤5 attempt lalu `failed`, `message_id` dicatat. Perintah dua arah `/status /approve <versi> /revise <catatan> /cancel /help` memakai `conversation_service` yang sama dengan Web UI (approval tetap terikat versi plan), dan teks bebas di luar `clarifying` dijawab penunjuk arah — tidak pernah didiamkan. Token via `backend/.env` saja; `GET /api/channels/status` melaporkan `configured/reason/running/outbox_pending` tanpa pernah membocorkan token.

## Provider resolution live = dari settings (bug fix smoke)
`_provider()` orchestrator dahulu hardcode `OpencodeProvider()` — hanya ter-cover tes karena tes menyuntik FakeProvider, sehingga server live mengabaikan config `provider`. Diperbaiki jadi `registry.make_provider(ai_provider(db))` + regression test. Ikut ditemukan saat smoke live: `shutil.isabs` (tidak ada) → `os.path.isabs` di argv builder opencode, yang sempat membuat tick crash-loop.

## Recovery & idempotensi
Restart: task `running` → `failed` + event `interrupted` (bisa di-queue ulang); state `clarifying/awaiting_approval/approved` bertahan utuh; mutasi coding terinterupsi TIDAK auto-resume. Approval & pesan Telegram idempoten (unique constraints). Pembatalan dicek antar-step dan meneruskan `should_cancel` ke provider (kill_tree).

## Test
- Backend 132 pytest (131 lewat + 1 skip di Windows: tes process-group khusus POSIX): lifecycle/API 20 (termasuk atribusi `agent_id` per baris journal) + conversation gating 10 + argv snapshot qoder/opencode 11+13 + provider-config API 14 + parse result + sandbox path/exec 10 + tree-kill/procs 4 (descendant terbukti lewat EOF pipe, fallback saat taskkill pura-pura gagal, pid mati bukan kegagalan) + fallback 6 + orchestrator conversation→approve→eksekusi→QC 12+12 (FakeProvider, termasuk provensi `provider_used`/`model_used` per langkah) + Telegram 17 via `httpx.MockTransport` (nol jaringan: perintah, chunking, dedupe, retry→failed, guidance non-clarifying, replay idempoten) + SSE frame/replay 2 + migrasi 1. TestClient dipakai tanpa `with` (lifespan tidak jalan di tes). Tes SSE sengaja **fungsi sinkron** yang memanggil `asyncio.run()` sendiri, bukan `@pytest.mark.asyncio`, supaya tetap berjalan tanpa plugin tambahan — versi async sebelumnya tidak pernah benar-benar dieksekusi pytest (tanpa plugin, tes async dilaporkan error/skip, bukan lewat).
- Isolasi DB tes ditutup rapat: dulu `conftest.py` hanya men-override dependency `get_db`, sedangkan endpoint/modul yang memakai `SessionLocal` langsung (mis. jalur stream & orchestrator) tetap menulis ke `data/agentville.db` asli — terbukti dari dua task `Stream me` sisa tes. Sekarang conftest menyetel `AGENTVILLE_DATABASE_URL` ke file sementara **sebelum** import apa pun dari `app`, jadi `app.database` sendiri tidak pernah menunjuk DB user. Bukti: hitungan baris `data/agentville.db` identik sebelum & sesudah `pytest` penuh.
- Frontend 25 vitest: scene 3D di-mock; `lib/activity.ts` (label aktivitas per agen, newest-frame-per-agent, parse UTC naive, umur pulse) diverifikasi murni; chat/plan/approve-gating/ProviderBar/event journal (chip step/provider/model) + suite lama yang diadaptasi.
- WebGL tidak bisa diverifikasi headless; validasi via build + component tests.

## Status 3D & agen dari DB (turunan, bukan animasi acak)
`agent_status.py`: working > reviewing > waiting(queued/pending/approved/clarifying/awaiting_approval) > completed/failed > idle — state `clarifying/awaiting_approval` pada anchor kini dimiliki agen Coordinator (`create_conversation` menugaskan agen ber-role `AI Coordinator` ke anchor), jadi kantor 3D benar-benar menunjukkan siapa yang sedang menunggu keputusan user. Scene membaca API saja; bob/tilt hanya mikro-motion visual di atas warna/dot status yang benar. Cincin pulse dan label aktivitas digambar **hanya** dari baris `task_events` yang punya `agent_id` + `step_index` + `provider`/`model` (frame terbaru per agen) — tidak ada gerakan yang dikarang dari timestamp acak. Transisi penting selalu menghasilkan baris `task_events` (waktu, task/step, agent, provider/model, pesan ringkas tanpa secret) yang jadi satu-satunya sumber journal UI + SSE.

## Role staf: satu sumber kebenaran di `plan_schema.py`
Dua Belas role (AI Coordinator, Product Analyst, UI/UX Designer, Frontend/Backend Developer, QA Engineer, Developer, Researcher, Data Analyst, Administrator, Content Creator, Reviewer) didefinisikan sekali sebagai `ROLES` (nama → `coding_capable`), dipakai untuk: validator plan (`agent_role` tak dikenal → **ditolak keras** dengan daftar valid, bukan diam-diam jadi AI Coordinator), validasi `uses_tools` (role non-coding tidak boleh menulis file → error jelas), seed `DEFAULT_AGENTS` + posisi meja 3 baris, instruksi persona mode-aware (`personas.py` mengambil blurb role yang sama), dan prompt planner/coordinator yang mencantumkan daftar role terkini.
