# AgentVille

Local-first 3D Virtual Agentic Office. Kamu memberi instruksi lewat **Web UI** atau **Telegram bot** (Telegram bisa dipakai penuh, termasuk `/approve`); seorang **AI Coordinator** mengklarifikasi permintaan, mengusulkan **rencana kerja berversi** dengan langkah yang dipetakan ke **12 role staf** yang tetap, dan hanya mengeksekusi setelah kamu **menyetujui rencana itu**. Setelah approved, staf spesialis (persona) menjalankan langkah lewat CLI AI lokal — termasuk **menulis file di dalam workspace proyek** (`data/workspace/project-<id>/`, confinement tingkat aplikasi) — lalu tahap **QC nyata** memverifikasi hasil dengan kriteria, temuan, dan bukti diff. Semua status, event, dan hasil tersimpan di SQLite dan dikirim ke UI secara **realtime via SSE**; kantor 3D hanya menampilkan state backend yang sebenarnya (label & reaksi agen bersumber dari `task_events`, tanpa animasi pura-pura).

## Requirements
- Node.js 20+
- Python 3.11+
- Minimal satu CLI AI lokal di PATH (keduanya bisa **text** dan **coding**; mode coding dipilih otomatis dari provider yang terpasang):
  - [opencode CLI](https://opencode.ai) — coding pakai `opencode run --auto` dengan proses dijalankan di `cwd=<workspace>` (flag diverifikasi terhadap `opencode run --help` v2.1.4). Kredensial milik mesin via `opencode auth login`; AgentVille tidak menyimpan API key.
  - [Qoder CLI](https://qoder.com) (`qodercli`) — coding pakai `-w <workspace>` + `--permission-mode accept_edits` + `--allowed-tools`. Login tetap level mesin.
- (Opsional) Bot Telegram — lihat bagian Telegram di bawah. Token hanya dibaca backend dari `backend/.env`.

## Start backend (PowerShell)
```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Start frontend (PowerShell, terminal terpisah)
```powershell
cd frontend
npm install
npm run dev
```
Buka URL dari Vite (umumnya http://localhost:5173).

Vite mendengarkan di semua antarmuka dan mem-proxy `/api` ke backend loopback, jadi perangkat lain di jaringan yang sama bisa membuka `http://<IP-LAN-komputer>:5173` tanpa mengubah CORS atau mengekspos port 8000. Jika Windows Firewall memblokir, izinkan Node.js untuk jaringan aktif. Untuk kembali ke localhost saja: `npm run dev -- --host 127.0.0.1`.

## Alur produk (Web)
1. Buka tab **Requests** → tulis permintaan (mis. "Buatkan web untuk restoran ABC") → **New request**. Ini membuat conversation + task anchor berstatus `clarifying`.
2. Coordinator bertanya/merangkum lewat chat. Jawab pertanyaan di panel chat.
3. Saat ia merasa cukup, ia mengajukan **rencana (plan vN)** dengan langkah, spesialis, dependency, dan acceptance criteria → status `awaiting_approval`. **Tidak ada tool yang berjalan sebelum kamu approve.**
4. **Approve vN** → `approved → queued → running`: subtask dibuat dari rencana dan dieksekusi berurutan sesuai dependency (concurrency 1). Langkah bertanda *uses tools* berjalan sebagai **coding step** dan menulis file di `data/workspace/project-<taskId>/`.
5. Setelah semua langkah → `reviewing`: Reviewer QC memeriksa kriteria + output + diff (`git diff` workspace) → verdict `pass`/`fail` terstruktur. `fail` mengirim temuan kembali ke langkah bertanggung jawab (retry terbatas, tercatat). Parent hanya `completed` jika semua subtask wajib lulus dan artefak ada; verdict tak terbaca / provider error → `failed`.
6. **Revisi** (plan baru vN+1 membatalkan approval versi lama) atau **Cancel** kapan saja sebelum selesai. Progres live: panel chat, rencana, event journal, hasil (PlanPanel/EventLog), dan status 3D.

Hasil akhir: `Open result` menampilkan output, plan steps, QC reviews, path diff artifact.

## Staf & role (satu sumber kebenaran)
- `backend/app/plan_schema.py::ROLES` adalah satu-satunya daftar role: prompt perencana, validasi skema, persona, dan seed tabel `agents` (yang dibaca UI lewat `/api/agents`) semuanya sumbernya dari list yang sama — tidak ada daftar role kedua yang bisa menyimpang. 12 role: AI Coordinator, Product Analyst, UI/UX Designer, Frontend Developer, Backend Developer, QA Engineer, Developer, Researcher, Data Analyst, Administrator, Content Creator, Reviewer.
- **Role di luar daftar ditolak keras** (`ValidationError` → rencana ditolak, event tercatat) — bukan dinormalisasi diam-diam ke persona default.
- Hanya role `coding_capable` (Frontend Developer, Backend Developer, QA Engineer, Developer) yang boleh menerima langkah `uses_tools`; kombinasi lain ditolak sebelum eksekusi. Persona mode `coding` mendapat instruksi berbeda dari mode `text`.
- Seed `agents` aditif: DB lama mendapat agen role baru saat startup berikutnya, agen & task lama tidak disentuh.

## Provider & fallback (panel "AI Engine")
- **AI provider**: `opencode` atau `qoder` — ketersediaan CLI dideteksi (`which`) dan ditampilkan sebagai badge; pesan kegagalan actionable.
- **Model**: dropdown per provider, diambil langsung dari CLI (`opencode models` / `qodercli --list-models`, cache 120 s).
- **Langkah `uses_tools` (coding)** bisa dijalankan **opencode maupun qoder**: provider yang kamu pilih dipakai kalau ia mendukung coding, baru jatuh ke provider lain yang mampu. Keduanya dibatasi tool yang boleh menulis: qoder dengan `-w` + `--permission-mode accept_edits` + `--allowed-tools Read,Write,Edit,Glob,Grep,Bash`, opencode dengan `run --auto` yang prosesnya dijalankan dengan `cwd=<workspace>`. Ini **pembatasan oleh konvensi CLI**, bukan jail OS.
- **Model per provider** (`ai_model` untuk opencode, `ai_model_qoder` untuk qoder) dan kapabilitas masing-masing provider (`text`/`coding`) dikembalikan `GET /api/ai/config` dari binary yang terpasang, bukan daftar hardcoded. Provider + model yang benar-benar menjalankan tiap langkah disimpan di baris task (`provider_used`, `model_used`), di event, dan di `GET /tasks/{id}/result`.
- **Provider fallback**: jika error provider pertama *recoverable* (kuota habis/429/5xx) dan langkah adalah text **atau probe `git status` membuktikan workspace masih bersih**, provider kedua dicoba. Langkah coding yang mungkin sudah menulis file TIDAK pernah di-rerun diam-diam (dicek via probe diff → `failed` + keputusan user).
- **QC retries** (`ai_retry_max`) dan **timeout** per panggilan bisa diatur. Provider/model yang dipakai tercatat per langkah di task, event, dan hasil.
- Semua preferensi ini disimpan di DB (`settings`), diubah lewat UI atau `PATCH /api/ai/config`.

## Layar penuh
Tombol ⛶ di pojok kiri atas panel Office Floor (atau tekan **F**) membuat kantor 2D maupun 3D memenuhi layar; **Esc** atau tombol yang sama keluar. Memakai Fullscreen API browser, dan bila tidak tersedia (mis. iPhone) atau ditolak, jatuh ke overlay yang memenuhi viewport. Dialog agen, bilah ruangan, dan penggeser ukuran ikut ada di dalamnya. Pintasan F diabaikan saat mengetik atau dengan Ctrl/⌘/Alt.

## Claude Code
**Sebagai provider.** Pilih `claude code` di panel AI Engine. Butuh Claude Code CLI: `claude` di PATH (`curl -fsSL https://claude.ai/install.sh | bash`), atau salinan yang ikut aplikasi Claude Desktop di macOS (dicari otomatis di `~/Library/Application Support/Claude/claude-code/`, versi terbaru dulu), atau path sendiri lewat env `AGENTVILLE_CLAUDE_BIN`. Login sekali dengan `claude auth login` (login CLI terpisah dari login aplikasi Desktop); AgentVille tidak menyimpan API key. Mode text menjalankan `claude -p --output-format json --tools ""` tanpa MCP; mode coding memakai `--permission-mode acceptEdits` + daftar tool eksplisit dengan `cwd=<workspace>` (pembatasan oleh konvensi CLI, bukan jail OS). Model: `sonnet`, `opus`, `haiku`, `fable`, atau ID lengkap.

**Sesi Claude di kantor 2D.** Sesi Claude Code (terminal, IDE, atau aplikasi desktop) bisa muncul sebagai karakter berbaju oranye di meja yang kosong: duduk saat bekerja, berdiri dengan "!" saat menunggu izin, ke pantry setelah selesai dan diam beberapa menit. Klik karakternya untuk melihat riwayat aktivitas.
```bash
python3 scripts/claude_hooks.py            # pratinjau perubahan ~/.claude/settings.json
python3 scripts/claude_hooks.py --apply    # pasang (hook lama dipertahankan, backup dibuat)
python3 scripts/claude_hooks.py --remove --apply
```
Hook bertipe `http` mengirim event ke `POST /api/claude/hooks`; bila backend mati, Claude Code menganggapnya error non-blocking dan tetap jalan. Yang disimpan hanya ringkasan satu baris yang sudah disamarkan (nama file, deskripsi perintah, potongan prompt) — tidak pernah isi file, perintah utuh, atau prompt utuh. Langkah yang dijalankan provider Claude milik AgentVille ditandai `AGENTVILLE_RUN` dan tidak digambar dua kali.

## Telegram (kanal dua arah penuh)
```powershell
cd backend
copy .env.example .env
# isi TELEGRAM_BOT_TOKEN (dari @BotFather) dan TELEGRAM_ALLOWED_CHAT_IDS (dari @userinfobot), comma-separated
```
- Bot memakai **long polling** dari thread backend, hanya aktif bila kedua env ada; status jujur lewat `GET /api/channels/status` (`{"configured": false, "reason": ...}` + banner UI bila belum diisi).
- Chat di luar allowlist dibalas "not authorized" dan **tidak** dibuat conversation. Update duplikat ditolak (idempoten via `update_id`, offset dilanjutkan dari DB saat restart), pesan > 4000 char ditolak.
- Perintah yang dikenali: **`/status`** (siklus hidup, versi plan, daftar langkah), **`/approve <versi>`** (approval wajib menyebut versi — versi lain ditolak), **`/revise <catatan>`**, **`/cancel`**, **`/help`**. Conversation yang sedang berjalan dikenali dari chat_id, jadi approve/revisi/cancel dari Telegram memakai pipeline dan validasi yang sama dengan Web UI.
- Reply non-perintah saat rencana menunggu approval diarahkan secara jelas (silakan `/approve`/`/revise`) dan **tidak** menyasar percakapan lain milikmu.
- Balasan keluar lewat **outbox persisten** (`telegram_outbox`): dedupe per `(key + potongan chunk)`, pemotongan aman di batas paragraf/garis/kata ≤ 4000 char (dengan hard cap 4096 saat `sendMessage`), retry hingga 5x lalu ditandai `failed`, `message_id` dicatat. Di-flush thread background tiap 2 s. Isinya milestone (proposal siap, completed/failed/cancelled) + jawaban Coordinator untuk chat asalnya — bukan spam per event.
- Token tidak pernah dikirim ke frontend atau disimpan di DB.

## Kantor 3D & realtime (apa yang asli, apa yang hiasan)
- Status tiap agen berasal dari backend: `agent_status.py` menghitungnya dari task milik agen itu, dan **Coordinator (Atlas) menjadi `waiting` saat request-nya `clarifying`/`awaiting_approval`** — jadi "menunggu kamu" terlihat, bukan diam-diam `idle`. Anchor conversation dimiliki agen Coordinator, sehingga event lifecycle percakapan punya identitas agen.
- Setiap `task_event` membawa `agent_id`, `step_index`, `provider`, `model`; event tanpa agen di-atribusikan ke agen pemilik task, dan task tanpa agen memang menampilkan tanpa identitas (tidak ada karangan).
- Yang reaktif di scene: **label/diari aktivitas per agen + ring pulse hanya muncul dari event `task_events` yang benar-benar ada** (age pulse dihitung dari timestamp event via `lib/activity.ts`). Yang dekoratif: gerakan idle ambien staf (jalan/napas) — itu hiasan, ditandai badge `MOTION IS AMBIENT` di UI, bukan klaim progres. WebGL tidak bisa diverifikasi headless, jadi logikanya diuji sebagai fungsi murni (`lib/activity.test.ts`).

## Keamanan & batas workspace
- Path workspace di-canonicalisasi lalu wajib `is_relative_to` root; symlink/junction/reparse point di luar root ditolak; perintah tool memakai **allowlist + timeout + batas output + process-tree kill** (`taskkill /T /F`, dengan fallback `TerminateProcess` in-process bila taskkill gagal, dan anak dijalankan di process group sendiri supaya pembatalan di POSIX tidak mengenai backend).
- Ini **confinement aplikasi-level (defense-in-depth)** — bukan jail OS. CLI coding berjalan dengan kebijakan permission mode-nya sendiri, di-arahkan ke workspace lewat `-w` + `cwd` (qoder) atau `--auto` + `cwd` (opencode); tidak ada mekanisme OS yang mencegah proses anak menulis di luar folder itu. Klaim "sandbox" sengaja tidak dipakai.
- Aksi destruktif/publish/kirim pesan eksternal tidak diotomatiskan; butuh keputusan user.

## API (semua di bawah `/api`)
- Tasks: `GET/POST /tasks`, `GET/PATCH /tasks/{id}`, `POST /tasks/{id}/cancel`, `GET /tasks/{id}/events`, `POST /tasks/{id}/execute` (hanya mode legacy `ai`/`ai_plan`; task conversation ditolak 422), `GET /tasks/{id}/result` (+ `plan_steps`, `qc_reviews`, `diff_path`)
- Conversations: `POST/GET /conversations`, `GET/POST /conversations/{id}/messages`, `GET /conversations/{id}/plan`, `POST .../approve {plan_version}` (409 bila versi bukan yang current; idempoten), `POST .../revise {notes}`, `POST .../cancel`
- Streams & status: `GET /events/stream?since=<id>` (SSE `task_event`, replay via `Last-Event-ID`/`since`), `GET /channels/status`, `GET /agents`, `GET /health`
- AI: `GET/PATCH /ai/config` (config + ketersediaan provider), `GET /ai/models?provider=`
- Transisi status tervalidasi (`ALLOWED_TRANSITIONS`, 409). Lifecycle: `pending/clarifying/awaiting_approval/approved/queued/running/reviewing/completed/failed/cancelled`.
- SQLite `data/agentville.db`: `agents, tasks, task_events, settings, conversations, messages, plans, approvals, qc_reviews, telegram_updates, telegram_outbox` (migrasi kolom/index aditif saat startup; data lama bertahan).

## Test & build
```powershell
cd backend  && .\.venv\Scripts\Activate.ps1 && pytest        # 131 passed + 1 skipped (sandbox+tree-kill/pipe-EOF, provider+flag catalog, fallback, conversation, orchestrator+QC, telegram mock+outbox+command, SSE replay)
cd frontend && npm run test && npm run lint && npm run build # 25 tes vitest, 0 error lint (3 warning lama)
```
Yang di-skip hanya tes process-group POSIX (tidak berlaku di Windows). Tes tidak butuh plugin async tambahan (SSE dijalankan via `asyncio.run`), tidak pernah mengirim pesan Telegram sungguhan (transport di-mock), dan **tidak pernah menyentuh `data/agentville.db`** — `tests/conftest.py` mengarahkan `AGENTVILLE_DATABASE_URL` ke DB sementara sebelum modul app di-import.

## Struktur
- `frontend/src/features/` — `office/` (scene 3D R3F), `chat/ChatPanel.tsx`, `plan/PlanPanel.tsx`, `events/EventLog.tsx`, `provider/ProviderBar.tsx`, `tasks/`.
- `frontend/src/lib/` — `api.ts`, `sse.ts` (EventSource + reconnect + safety poll 15 s), `activity.ts` (fungsi murni: age pulse, diari aktivitas per agen dari `task_events`; dipakai scene & UI agar bisa diuji tanpa WebGL).
- `backend/app/` — `orchestrator.py` (worker: turn percakapan → eksekusi rencana → QC), `conversation_service.py`, `plan_schema.py` (satu-satunya daftar role + validasi), `agent_status.py`, `events.py` (SSE journal tailing), `ai/` (`registry` kapabilitas/mode, `opencode`, `qoder`, `fallback`, `personas` mode-aware), `tools/` (`workspace`, `sandbox_exec`, `procs` tree-kill+pipe-EOF, `repo` diff), `channels/` (`base`, `normalizer`, `telegram` perintah+milestone, `outbox` persisten+dedupe+chunk+retry), `api/` (+ `conversations`, `events`, `channels`).
- `data/workspace/project-<id>/` workspace coding + git baseline; `data/artifacts/` hasil `.md` dan `task-<id>.diff.txt`.

## Catatan
- Restart backend saat turn/step berjalan → tugas `running` ditandai `failed` + event `interrupted` (state percakapan/approval bertahan); diff langkah coding yang terinterupsi dilaporkan, tidak auto-resume mutasi.
- Satu worker thread = satu item kerja per waktu (klaim tunggal terjamin; tidak ada dua worker rebutan).
- Aset 3D prosedural (placeholder); GLB/animasi skeletal masih tertunda. Paralelisme antar-staf sengaja belum (concurrency 1).
- Backend di-bind ke localhost; jangan expose ke jaringan publik tanpa autentikasi dan pengetatan CORS.
