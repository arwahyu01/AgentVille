# AgentVille

Local-first 3D Virtual Agentic Office yang berjalan sebagai **satu kantor, satu halaman**. Kamu memberi instruksi lewat **Web UI** atau **Telegram bot**; seorang **AI Coordinator** (satu-satunya pimpinan) mengklarifikasi permintaan, menyusun **rencana kerja berversi** (tujuan, batas kerja, asumsi, risiko, tool, acceptance criteria) dengan langkah yang dipetakan ke **12 role staf**, lalu **langsung mengutus bawahan** untuk pekerjaan lokal — hanya tindakan eksternal/berisiko tinggi yang berhenti untuk persetujuanmu. Rencana lokal disetujui otomatis oleh pimpinan (baris audit tetap dicatat), dan staf spesialis (persona) menjalankan langkah lewat CLI AI lokal — termasuk **menulis file di dalam workspace proyek** (`data/workspace/project-<id>/`, confinement tingkat aplikasi) — sambil **saling melapor**: instruksi pimpinan, laporan kemajuan, dan eskalasi kesulitan semuanya tercatat sebagai percakapan tim. Tahap **QC nyata** memverifikasi hasil dengan kriteria, temuan, dan bukti diff. Semua status, event, dan hasil tersimpan di SQLite dan dikirim ke UI secara **realtime via SSE**; kantor hanya menampilkan state backend yang sebenarnya (label & reaksi agen bersumber dari `task_events`, tanpa animasi pura-pura).

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

> **PATH penting**: backend mendeteksi CLI lewat `shutil.which`. Bila `GET /api/ai/config` melaporkan
> `opencode.available = false` padahal CLI terpasang, proses uvicorn tidak mewarisi PATH yang memuat
> `%USERPROFILE%\.opencode\bin` (umumnya karena dijalankan dari shell/terminal yang PATH-nya berbeda, atau
> dari venv Python sistem). Verifikasi: `curl http://127.0.0.1:8000/api/ai/config`. Di Git Bash:
> `export PATH="$HOME/.opencode/bin:$HOME/.qoder/bin/qodercli:$PATH"` sebelum `python -m uvicorn ...`.
> Pakai juga **Python venv proyek** (`backend\.venv\Scripts\python.exe`), bukan Python sistem, agar dependensi versinya sama.

## Start frontend (PowerShell, terminal terpisah)
```powershell
cd frontend
npm install
npm run dev
```
Buka URL dari Vite (umumnya http://localhost:5173).

Vite mendengarkan di semua antarmuka dan mem-proxy `/api` ke backend loopback, jadi perangkat lain di jaringan yang sama bisa membuka `http://<IP-LAN-komputer>:5173` tanpa mengubah CORS atau mengekspos port 8000. Jika Windows Firewall memblokir, izinkan Node.js untuk jaringan aktif. Untuk kembali ke localhost saja: `npm run dev -- --host 127.0.0.1`.

## Alur produk (satu halaman)
1. Tulis perintah di bilah atas (mis. "Buatkan landing page untuk kedai kopi") → **Kerjakan**. Ini membuat conversation + task anchor berstatus `clarifying`. Tidak ada menu/tab: antrean, hasil, dan percakapan tim ada di layar yang sama.
2. Coordinator bertanya lewat chat bila memang perlu. Jawab di panel kanan; pertanyaan yang menunggu jawaban selalu ditampilkan.
3. Saat cukup, ia menyusun **rencana (plan vN)** dengan tujuan, batas kerja, asumsi, risiko, langkah, spesialis, dependency, tool yang dideklarasikan, dan acceptance criteria, lalu **menyetujuinya sendiri sebagai pimpinan** (`approved → queued → running`). Approval manual bukan gate untuk pekerjaan lokal; baris auditnya tetap tersimpan. **Pengecualian:** rencana yang menyentuh tindakan eksternal/berisiko tinggi (deploy/publish, kirim pesan ke orang/channel nyata, ubah izin/produksi, belanja) **berhenti di `awaiting_approval`** dengan alasan konkret dan hanya berjalan setelah kamu menyetujui versi itu.
4. Langkah siap dieksekusi **paralel** sesuai dependency, dibatasi setting `max_parallel_jobs` (default 4). Langkah *uses tools* berjalan sebagai **coding step** dan menulis file di `data/workspace/project-<anchorId>/`.
5. Spesialis **melapor dan mengeskalasi**: instruksi pimpinan dan laporan langkah tercatat sebagai percakapan tim (`GET /api/events/team`). Bila spesialis mengirim `needs_help`, pimpinan mencari solusi lalu **mengalihkan** langkah ke pelaksana lain dan mencoba ulang (maksimal 1 rescue per langkah) — **kecuali** percobaan coding itu sudah mengubah workspace. Dalam kasus itu otomatis dihentikan di checkpoint (event `partial_work_detected` + `needs_help`); kamu memilih **Alihkan** untuk melanjutkan dari kondisi sekarang atau **Revisi** untuk membatalkan arah itu. Retry provider biasa juga dibatasi (`ai_retry_max`) dan menolak mengulang langkah coding yang sudah menyentuh file.
6. Setelah semua langkah → `reviewing`: Reviewer QC memeriksa kriteria + output + diff (`git diff` workspace) → verdict `pass`/`fail` terstruktur. `fail` mengirim temuan kembali ke langkah bertanggung jawab (retry terbatas, tercatat). Parent hanya `completed` jika semua subtask wajib lulus dan artefak ada; verdict tak terbaca / provider error → `failed`.
7. **Hasil langsung tampil** di layar utama: website yang dibangun dijalankan di iframe, gambar ditampilkan, video diputar + tautan, dokumen bisa dibaca. Panel hasil mengambil file nyata dari workspace lewat `GET /tasks/{id}/preview`.
8. **Revisi** (plan baru vN+1) atau **Cancel** kapan saja. **Stop** menghentikan hanya task yang sedang berjalan; **Bersihkan antrean** membatalkan semua task aktif tetapi menyimpan riwayat.

## Staf & role (satu sumber kebenaran)
- `backend/app/plan_schema.py::ROLES` adalah satu-satunya daftar role: prompt perencana, validasi skema, persona, dan seed tabel `agents` (yang dibaca UI lewat `/api/agents`) semuanya sumbernya dari list yang sama — tidak ada daftar role kedua yang bisa menyimpang. 12 role: AI Coordinator, Product Analyst, UI/UX Designer, Frontend Developer, Backend Developer, QA Engineer, Developer, Researcher, Data Analyst, Administrator, Content Creator, Reviewer.
- **Role di luar daftar ditolak keras** (`ValidationError` → rencana ditolak, event tercatat) — bukan dinormalisasi diam-diam ke persona default.
- Hanya role `coding_capable` (Frontend Developer, Backend Developer, QA Engineer, Developer) yang boleh menerima langkah `uses_tools`; kombinasi lain ditolak sebelum eksekusi. Persona mode `coding` mendapat instruksi berbeda dari mode `text`.
- **Kontrak rencana** (`plan_schema.py::TaskPlan`) menyimpan `goal`, `scope`, `assumptions`, `risks`, `external_actions`, dan per langkah `tools` + `risk`. Nama tool divalidasi terhadap **registry** (`app/tools/registry.py`); tool yang menulis/menjalankan perintah hanya legal untuk role coding-capable dan wajib `uses_tools=true`; tool eksternal/berisiko tinggi memicu gate persetujuan manusia. Rencana dengan role/dependency/tool yang tidak sah ditolak dengan pesan yang bisa diperbaiki, bukan dieksekusi separuh.
- Seed `agents` aditif: DB lama mendapat agen role baru saat startup berikutnya, agen & task lama tidak disentuh.

## Provider & fallback (panel "AI Engine")
- **AI provider**: `opencode` atau `qoder` — ketersediaan CLI dideteksi (`which`) dan ditampilkan sebagai badge; pesan kegagalan actionable.
- **Model**: dropdown per provider, diambil langsung dari CLI (`opencode models` / `qodercli --list-models`, cache 120 s).
- **Langkah `uses_tools` (coding)** bisa dijalankan **opencode maupun qoder**: provider yang kamu pilih dipakai kalau ia mendukung coding, baru jatuh ke provider lain yang mampu. qoder menerima **allowlist tool sesuai deklarasi langkah** (`--allowed-tools Read/Write/Edit/Glob/Grep/Bash` yang benar-benar dipakai) dengan `-w` + `--permission-mode accept_edits`; opencode memakai `run --auto` dengan `cwd=<workspace>` dan daftar tool deklaratif di prompt. Ini **pembatasan oleh konvensi CLI**, bukan jail OS.
- **Model per provider** (`ai_model` untuk opencode, `ai_model_qoder` untuk qoder) dan kapabilitas masing-masing provider (`text`/`coding`) dikembalikan `GET /api/ai/config` dari binary yang terpasang, bukan daftar hardcoded. Provider + model yang benar-benar menjalankan tiap langkah disimpan di baris task (`provider_used`, `model_used`), di event, dan di `GET /tasks/{id}/result`.
- **Gate eksternal** (`external_approval_enabled`, default aktif): rencana yang mendeklarasikan `external_actions` (deploy/publish, kirim pesan nyata, belanja, ubah izin/produksi) atau memakai tool eksternal/`risk=high` tetap di `awaiting_approval` sampai manusia menyetujui versi itu. Panel rencana menampilkan alasan konkretnya; pekerjaan lokal murni tetap auto-approve. Bisa dimatikan lewat toggle **Gate eksternal** di bilah AI.
- **Provider fallback**: jika error provider pertama *recoverable* (kuota habis/429/5xx/timeout) dan langkah adalah text **atau probe baseline workspace membuktikan langkah ini belum mengubah apa pun**, provider kedua dicoba — dengan **model milik provider itu sendiri** (`registry.resolve_model`), bukan model provider pertama (qodercli menolak id `vendor/model`, yang dulu membuat setiap fallback gagal seketika). Langkah coding yang mungkin sudah menulis file TIDAK pernah di-rerun diam-diam (dicek via fingerprint diff per langkah → `failed` + keputusan user).
- **Engine yang diam dihentikan lebih awal**: output CLI dibaca baris per baris (`procs.OutputPump`); bila tidak ada output sama sekali selama 120 s, proses beserta anak-anaknya dimatikan dan langkah gagal dengan pesan `idle`, bukan menunggu timeout penuh (~21 menit). Status proses dibaca setelah di-*reap*, jadi `returncode=None` tidak lagi dianggap gagal (penyebab "exited with code None" pada jawaban yang sebenarnya sukses).
- **Self-repair memilih penyebab yang benar**: kegagalan berbau mesin (model invalid/tidak tersedia, CLI hilang, kuota, timeout, 401/403/429/5xx) diperbaiki sebagai kegagalan mesin — `_next_usable_engine` memilih engine lain yang terpasang **dan** model yang diterimanya, dicatat `engine_switched`, lalu langkah diulang di engine itu. Kegagalan pekerjaan tetap diselesaikan dengan mengganti agent. Maksimal satu rescue per langkah; tanpa engine yang bisa dipakai, berhenti dengan diagnosis, bukan mengulang percobaan yang pasti gagal.
- **Cancel benar-benar menghentikan**: `POST /tasks/{id}/cancel` membatalkan anchor **beserta seluruh turunannya** (`cancel_tree`), langkah yang menerima `Cancelled` mencatat `step_cancelled` tanpa eskalasi, dan status `cancelled` tidak pernah ditimpa menjadi `failed`/`aborted` oleh penutupan job.
- **Auto-rotate AI** (`rotate_models_enabled`, default aktif; `rotate_models_max` default 4, batas atas 100): saat satu mesin kehabisan kuota/kena rate limit/overload/gateway error, prompt yang sama diserahkan ke mesin cadangan berikutnya — **model free didahulukan**, model per model mesin itu juga jalan sampai ada yang mau menerima pekerjaan. Tiap perpindahan dicatat sebagai event `provider_switched` ("... kehabisan kuota → dilanjutkan qoder/Efficient") dan langkah menyimpan provider/model yang benar-benar menyelesaikannya. Nahkan batasnya tinggi kalau kamu mau "terus sampai mentok".
- **Percakapan agen** (`agent_chat_mode`): `static` (default, 0 token — template jujur dari state nyata), `milestone` (model menulis ulang lisan hanya untuk handoff/eskalasi/rescue/QC), `full` (semua baris bicara). Pesan template tetap disimpan lebih dulu dan diganti di tempat, jadi model yang gagal/overload tidak pernah menghilangkan informasi; pekerjaan narasi jalan di pool kecil di latar belakang.
- **QC retries** (`ai_retry_max`) dan **timeout** per panggilan bisa diatur. Provider/model yang dipakai tercatat per langkah di task, event, dan hasil.
- Semua preferensi ini disimpan di DB (`settings`), diubah lewat UI atau `PATCH /api/ai/config`.

## Kantor & layar penuh
Kantor adalah pusat halaman: antrean pekerjaan di kiri, lantai kantor besar di tengah (mengikuti tinggi layar), rail manusia di kanan. Tombol **Explore** ada langsung di kontrol (2D/3D/Explore/⛶) — mode 2D punya pintu eksplisit ke jalan-jalan first-person. Tekan **F** (di mana pun kecuali saat mengetik) untuk memenuhi layar; **Esc** atau F lagi untuk keluar. Hasil pekerjaan (website/gambar/video/dokumen) **tidak memakai tempat di halaman**: ia muncul sebagai modal besar begitu ada deliverable, atau saat memilih pekerjaan selesai dari antrean.

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
- Perintah yang dikenali: **`/status`** (siklus hidup, versi plan, daftar langkah), **`/approve <versi>`** (legacy/idempoten — rencana sekarang disetujui otomatis oleh pimpinan), **`/revise <catatan>`**, **`/cancel`**, **`/help`**. Conversation yang sedang berjalan dikenali dari chat_id, jadi revisi/cancel dari Telegram memakai pipeline dan validasi yang sama dengan Web UI.
- Reply non-perintah saat rencana baru disusun dijawab bahwa pekerjaan **mulai otomatis** dan tidak perlu approval.
- Balasan keluar lewat **outbox persisten** (`telegram_outbox`): dedupe per `(key + potongan chunk)`, pemotongan aman di batas paragraf/garis/kata ≤ 4000 char (dengan hard cap 4096 saat `sendMessage`), retry hingga 5x lalu ditandai `failed`, `message_id` dicatat. Di-flush thread background tiap 2 s. Isinya milestone (proposal siap, completed/failed/cancelled) + jawaban Coordinator untuk chat asalnya — bukan spam per event.
- Token tidak pernah dikirim ke frontend atau disimpan di DB.

## Integrasi akun (Instagram / YouTube / Meta Ads)
Panel **Integrasi** di rail kanan menyimpan koneksi akun. Ini **hanya koneksi + penyimpanan akses**, bukan fitur posting/upload.

- Platform yang didukung: `instagram` (Instagram business via Facebook Page), `youtube` (channel Google), `meta_ads` (akun iklan Meta).
- Dua jalur: **OAuth** (klik "Hubungkan lewat OAuth", halaman persetujuan dibuka di tab baru, salin kode yang muncul lalu tempel di panel + tekan "Selesaikan") atau **simpan token manual** (token dipaste, lalu diverifikasi lewat endpoint baca-saja penyedia). Manual tetap memakai `state` sekali pakai bila lewat OAuth; token mentah tidak pernah dikembalikan API.
- Konfigurasi OAuth app lewat environment backend (tidak lewat UI, tidak disimpan di DB):
  ```powershell
  # Meta (dipakai instagram + meta_ads)
  $env:AGENTVILLE_META_CLIENT_ID = '...'
  $env:AGENTVILLE_META_CLIENT_SECRET = '...'
  # Google (dipakai youtube)
  $env:AGENTVILLE_GOOGLE_CLIENT_ID = '...'
  $env:AGENTVILLE_GOOGLE_CLIENT_SECRET = '...'
  # Wajib sama persis dengan Redirect URI yang didaftarkan di app console:
  $env:AGENTVILLE_OAUTH_REDIRECT = 'http://127.0.0.1:8000/api/integrations/oauth/return'
  # Opsional: set 0 untuk mempertahankan token Meta short-lived
  $env:AGENTVILLE_META_LONG_LIVED = '1'
  ```
- Token di-*seal* dengan **Windows DPAPI per user** (`backend/app/integrations/secure_store.py`) sebelum masuk SQLite. Tidak ada fallback plaintext: di luar Windows, penyimpanan ditolak dan UI menampilkan peringatan. Salinan file DB atau user Windows lain tidak bisa membaca token.
- Scope hanya untuk akses baca + kapasitas publish/upload; **tidak ada endpoint yang mem-posting, mengupload, atau mengubah iklan**. Rencana yang menyebut publish/iklan tetap berhenti di `awaiting_approval` (lihat `external_approval_enabled`).
- Status jujur: `GET /api/integrations` mengembalikan `configured` per platform, `storage`, dan daftar akun (tanpa token). Token expired/gagal diverifikasi ditandai `needs_attention` dengan `last_error` yang sudah di-redaksi. Tombol verifikasi memanggil API profil read-only; tombol putus menghapus baris + token.

## Publikasi & berita harian (panel "Publikasi")
Lanjutan dari koneksi akun: sekarang ada **jalur publish yang dibuka satu per satu**, bukan auto-post.

- **Alur wajib**: buat **preview** → periksa payload yang sudah di-redaksi → **Setujui** → **Kirim sekarang**. Job tidak bisa dikirim sebelum disetujui, dan tidak bisa dikirim dua kali (`publish_jobs.status` dipakai sebagai kunci sekali-kirim). Gate ini tetap berlaku walau `external_approval_enabled = 0`, karena publish adalah aksi eksternal nyata.
- **dry24 (CLI lokal)**: karena AgentVille dan dry24 ada di **server yang sama**, tidak dipakai API HTTP/token/port. AgentVille menjalankan `php artisan berita:publish --payload=-` lewat subprocess dengan JSON di STDIN; perintah itu memakai `App\Services\BeritaPublisher` milik Laravel yang sama dengan jalur lain. Kredensial DB tetap di `.env` dry24 dan tidak pernah dibaca AgentVille. Di panel **Publikasi** klik **Pasang preset dry24.id**, lalu isi **lokasi project dry24** dan **binary PHP**. Field map `title→judul`, `content→isi`, `tanggal→tanggal`, `media_url→gambar_url`. Detail ada di `PUBLISH_CLI.md` project `dry24-develop`. dry24 tidak punya field `status/draft/slug/ringkasan`: slug dibuat otomatis dan artikel langsung tayang setelah dikirim.
- **Instagram**: memakai akun yang sudah tersambung di panel Integrasi. Butuh `media_url` berupa **URL gambar publik** (file workspace tidak bisa dijangkau Meta) dan caption. Graph API dipanggil dua tahap: `/media` lalu `/media_publish`. Preview tidak memanggil Meta sama sekali.
- **Jadwal berita harian**: aktifkan di panel, pilih jam lokal, topik (dipisah koma), dan maksimal item (1–10).Tiap hari pada jam itu scheduler membuat **satu conversation** lewat pipeline biasa (Coordinator → rencana → staf → QC) untuk mengumpulkan berita dengan alat web milik CLI bila tersedia dan menulis **draf** di workspace. Tidak ada fetch mandiri, tidak ada publish. `news_runs.run_date` unik jadi dua tick di hari yang sama tidak menduplikasi pekerjaan. Tombol "Lihat prompt (dry-run)" menunjukkan prompt tanpa membuat conversation.
- Jika CLI tidak punya `web_fetch`/`web_search`, agen diperintahkan mengatakan terus terang, bukan mengarang berita.

Langkah cepat publish ke dry24:
1. Deploy perubahan CLI di project `dry24-develop` (`php artisan list` harus menampilkan `berita:publish`).
2. Di AgentVille → **Publikasi → Jembatan CLI dry24**: klik **Pasang preset dry24.id**, isi lokasi project yang berisi `artisan` (bisa juga di-set lewat env `AGENTVILLE_DRY24_PROJECT`), lalu **Simpan jembatan**.
3. Isi judul + isi artikel (opsional `tanggal`, `URL gambar sampul`), **Buat preview**, periksa payload `judul/isi/tanggal/gambar_url`, lalu **Setujui** → **Kirim sekarang**.
4. Cek balasan di antrean job; tautan berita ada di `response.result.data.url`. Tidak ada retry otomatis — job gagal butuh preview baru.

Catatan: env opsional `AGENTVILLE_DRY24_PROJECT` dan `AGENTVILLE_DRY24_PHP` hanya mengisi nilai awal preset; pengguna tetap bisa mengubahnya di panel. Proses AgentVille butuh hak akses baca/jalankan PHP dan tulis ke `storage/app` dry24.

## Kantor 3D & realtime (apa yang asli, apa yang hiasan)
- Status tiap agen berasal dari backend: `agent_status.py` menghitungnya dari task milik agen itu, dan **Coordinator (Atlas) menjadi `waiting` saat request-nya `clarifying`** — jadi "menunggu kamu" terlihat, bukan diam-diam `idle`. Anchor conversation dimiliki agen Coordinator, sehingga event lifecycle percakapan punya identitas agen.
- Setiap `task_event` membawa `agent_id`, `step_index`, `provider`, `model`; event tanpa agen di-atribusikan ke agen pemilik task, dan task tanpa agen memang menampilkan tanpa identitas (tidak ada karangan).
- Yang reaktif di scene: **label/diari aktivitas per agen + ring pulse hanya muncul dari event `task_events` yang benar-benar ada** (age pulse dihitung dari timestamp event via `lib/activity.ts`). Yang dekoratif: gerakan idle ambien staf (jalan/napas) — itu hiasan, ditandai badge `MOTION IS AMBIENT` di UI, bukan klaim progres. WebGL tidak bisa diverifikasi headless, jadi logikanya diuji sebagai fungsi murni (`lib/activity.test.ts`).

## Keamanan & batas workspace
- Path workspace di-canonicalisasi lalu wajib `is_relative_to` root; symlink/junction/reparse point di luar root ditolak; perintah tool memakai **allowlist + timeout + batas output + process-tree kill** (`taskkill /T /F`, dengan fallback `TerminateProcess` in-process bila taskkill gagal, dan anak dijalankan di process group sendiri supaya pembatalan di POSIX tidak mengenai backend).
- Ini **confinement aplikasi-level (defense-in-depth)** — bukan jail OS. CLI coding berjalan dengan kebijakan permission mode-nya sendiri, di-arahkan ke workspace lewat `-w` + `cwd` (qoder) atau `--auto` + `cwd` (opencode); tidak ada mekanisme OS yang mencegah proses anak menulis di luar folder itu. Klaim "sandbox" sengaja tidak dipakai.
- Aksi destruktif/publish/kirim pesan eksternal tidak diotomatiskan; rencana yang mendeklarasikannya berhenti di `awaiting_approval` (lihat `external_approval_enabled`) dan hanya berjalan setelah persetujuan manusia. Menyambung akun di panel Integrasi **tidak** mengubah gate ini — koneksi tersimpan, tetapi publish/upload/iklan tetap butuh persetujuan.

## Login & deploy VPS
- Semua `/api/*` (termasuk SSE dan `/health`) ditutup oleh middleware sesi. Tanpa cookie yang valid, responsnya 401. Halaman login adalah satu-satunya layar yang bisa dibuka tanpa sesi.
- Password disimpan sebagai hash PBKDF2-HMAC-SHA256 (240.000 iterasi, salt acak) di tabel `users`; tidak pernah dikembalikan API atau ditulis sebagai plaintext ke file. Browser hanya menyimpan cookie `HttpOnly` + `SameSite=Lax` bertanda tangan HMAC (berlaku 12 jam). `Secure` otomatis aktif bila backend diakses lewat HTTPS.
- Untuk VPS, set env sebelum start pertama (sekali saja; user tidak dibuat ulang jika sudah ada):

```powershell
$env:AGENTVILLE_ADMIN_USER = 'operator@domain.com'
$env:AGENTVILLE_ADMIN_PASSWORD = 'ganti-dengan-kata-sandi-kuat'
$env:AGENTVILLE_SESSION_SECRET = 'string-acak-panjang-yang-stabil'   # opsional; jika kosong dibuat otomatis di data/session_secret
$env:AGENTVILLE_CORS_ORIGINS = 'https://domain-anda.com'            # hanya bila frontend & backend beda origin
```
- Pakai HTTPS (reverse proxy). Untuk monitor uptime, panggil endpoint dengan cookie atau tambahkan probe yang melakukan login.
- `AGENTVILLE_AUTH_ENABLED=0` **hanya** untuk test suite lokal; jangan dipakai di VPS.

## API (semua di bawah `/api`)
- Auth: `POST /auth/login {username, password}` (cookie HttpOnly; 429 setelah 5 gagal/menit per IP+username), `POST /auth/logout`, `GET /auth/me`. Semua endpoint lain butuh sesi.
- Tasks: `GET/POST /tasks`, `GET/PATCH /tasks/{id}`, `POST /tasks/{id}/cancel`, `POST /tasks/{id}/stop` (hentikan yang berjalan saja), `POST /tasks/clear` (batalkan semua task aktif, riwayat tetap), `POST /tasks/{id}/reassign {agent_id, notes}` (pindahkan langkah macet **atau lanjutkan langkah yang berhenti dengan perubahan parsial**; parent yang gagal di-queue ulang dan langkah yang sudah `completed` dilewati), `GET /tasks/{id}/events`, `POST /tasks/{id}/execute` (hanya mode legacy `ai`/`ai_plan`; task conversation ditolak 422), `GET /tasks/{id}/result` (+ `plan_steps`, `plan_meta` goal/scope/risiko, `failure_reason`, `qc_reviews`, `diff_path`, `preview`)
- Preview hasil: `GET /tasks/{id}/preview` (metadata `kind`/`entry`/`url`/`files`) dan `GET /tasks/{id}/preview/{path}` (menyajikan file asli dari workspace, `Cache-Control: no-store`; `.git`/`node_modules`/hidden tidak pernah diekspos)
- Conversations: `POST/GET /conversations` (opsional `client_message_id` untuk idempotensi double-submit), `GET/POST /conversations/{id}/messages` (opsional `client_message_id`), `GET /conversations/{id}/plan` (goal/scope/asumsi/risiko/`external_actions`/`requires_approval`+`approval_reasons`), `POST .../approve {plan_version}` (legacy & gate eksternal; 409 bila versi bukan current, idempoten), `POST .../revise {notes}`, `POST .../cancel`
- Streams & status: `GET /events/stream?since=<id>` (SSE `task_event`, replay via `Last-Event-ID`/`since`), `GET /events/team` (percakapan tim: pelaku, penerima, provider/model), `GET /channels/status`, `GET /agents`, `GET /health`
- Integrasi: `GET /integrations` (status + daftar akun, tanpa token), `POST /integrations/start {provider}`, `POST /integrations/complete {provider, code, state}`, `POST /integrations/save {provider, access_token, refresh_token?, label?, external_id?}`, `POST /integrations/{id}/verify`, `POST /integrations/{id}/disconnect`, `GET /integrations/oauth/return` (halaman landing callback; hanya menampilkan kode untuk disalin, tidak menyimpan apa pun). `provider` = `instagram|youtube|meta_ads`.
- Publikasi: `GET /publish/status` (termasuk `preset` dry24), `GET /publish/jobs?limit=`, `POST /publish/credentials/preset` (pasang jembatan CLI dry24 tanpa token), `POST /publish/credentials` (`cli_project`, `cli_php`, field map opsional), `DELETE /publish/credentials/{id}`, `POST /publish/preview {provider, article, credential_id?, account_id?, title?}` (hanya menghitung preview, tidak mengirim), `POST /publish/{id}/approve`, `POST /publish/{id}/execute` (kirim sekali), `GET/PATCH /publish/schedule`, `POST /publish/schedule/dry-run`. `provider` = `dry24|instagram`.
- AI: `GET/PATCH /ai/config` (config + ketersediaan provider), `GET /ai/models?provider=`
- Transisi status tervalidasi (`ALLOWED_TRANSITIONS`, 409). Lifecycle: `pending/clarifying/awaiting_approval/approved/queued/running/reviewing/completed/failed/cancelled`.
- SQLite `data/agentville.db`: `agents, tasks, task_events, settings, conversations, messages, plans, approvals, qc_reviews, telegram_updates, telegram_outbox, integration_accounts, oauth_states, publish_credentials, publish_jobs, news_runs, users` (tabel baru dibuat otomatis; migrasi kolom/index aditif saat startup; data lama bertahan).

## Test & build
```powershell
cd backend  && .\.venv\Scripts\Activate.ps1 && pytest        # 238 passed + 1 skipped (skip = tes process-group POSIX, tidak berlaku di Windows)
cd frontend && npm run test && npm run lint && npm run build # 159 tes vitest, 0 error lint (17 warning react-refresh lama), tsc & build bersih — hasil run terakhir
```
Yang di-skip hanya tes process-group POSIX (tidak berlaku di Windows). Tes tidak butuh plugin async tambahan (SSE dijalankan via `asyncio.run`), tidak pernah mengirim pesan Telegram sungguhan (transport di-mock), dan **tidak pernah menyentuh `data/agentville.db`** — `tests/conftest.py` mengarahkan `AGENTVILLE_DATABASE_URL` ke DB sementara sebelum modul app di-import.

## Struktur
- `frontend/src/App.tsx` — shell satu halaman: bilah perintah, antrean pekerjaan di kiri, kantor besar di tengah, rail (persetujuan/chat/percakapan tim/pengaturan AI) di kanan, dan hasil pekerjaan sebagai modal besar.
- `frontend/src/features/` — `result/ResultStage.tsx` (iframe web / gambar / video / dokumen), `plan/ApprovalsPanel.tsx`, `chat/ChatPanel.tsx`, `events/TeamConversation.tsx`, `provider/ProviderBar.tsx`, `integrations/IntegrationsPanel.tsx` (koneksi akun), `publish/PublishPanel.tsx` (preview + approve + kirim + jadwal berita), `office/` (scene 3D R3F).
- `frontend/src/lib/` — `api.ts`, `sse.ts` (EventSource + reconnect + safety poll 15 s), `status.ts` (label & status aktif), `activity.ts` (fungsi murni: age pulse, diari aktivitas per agen dari `task_events`; dipakai scene & UI agar bisa diuji tanpa WebGL).
- `backend/app/` — `orchestrator.py` (worker: turn percakapan → eksekusi paralel → eskalasi/rescue → QC → resume yang melewati langkah selesai), `conversation_service.py` (auto-approve lokal + gate eksternal + materialisasi langkah), `chatter.py` (percakapan agen real, opsional, mode static/milestone/full), `plan_schema.py` (satu-satunya daftar role + kontrak rencana + validasi tool), `agent_status.py`, `agent_actions.py` (redaksi + `sanitize_event` untuk semua pesan jurnal), `events.py` (SSE journal tailing), `ai/` (`registry` kapabilitas/mode, `opencode`, `qoder`, `claude`, `fallback` dengan probe baseline, `rotation` (kuota-habis → mesin cadangan, aman untuk coding), `personas` mode-aware), `tools/` (`registry` tool+kategori izin, `workspace`, `sandbox_exec`, `procs` tree-kill+pipe-EOF, `repo` diff+fingerprint), `channels/` (`base`, `normalizer`, `telegram` perintah+milestone, `outbox` persisten+dedupe+chunk+retry), `integrations/` (`secure_store` DPAPI, `oauth` Meta/Google, `service` — koneksi), `publishing/` (`dry24` CLI lokal + preset, `instagram` Graph API, `service` gate preview→approve→execute, `scheduler` draf berita harian), `api/` (+ `conversations`, `events`, `channels`, `integrations`, `publishing`, `preview`).
- `data/workspace/project-<anchorId>/` workspace coding + git baseline; `data/artifacts/` hasil `.md` dan `task-<id>.diff.txt`.

## Catatan
- Restart backend saat turn/step berjalan → tugas `running` ditandai `failed` + event `interrupted` (state percakapan/approval bertahan); diff langkah coding yang terinterupsi dilaporkan, tidak auto-resume mutasi. Melanjutkan request memakai **Alihkan/QC rerun** dan melewati langkah yang sudah `completed` (event `resume_skipped_steps`).
- Worker pool mengambil task siap secara paralel (lease atomik, `max_parallel_jobs` default 4); dependency dan langkah yang butuh keputusan user tetap dihormati.
- **Bukti lengkap, bukan hanya diff workspace**: CLI coding hanya terikat workspace *by convention* (bukan jail OS), jadi satu langkah bisa menulis di luar workspace sementara fingerprint workspace tetap bersih. Baseline file level root aplikasi (`repo.root_escape_snapshot`) diambil sebelum & sesudah setiap langkah coding; file **baru** di root → event `workspace_escape_detected` dan step **tidak** dianggap sukses, file **yang diubah** → event `root_file_touched` (peringatan, mis. Anda mengedit README saat run). Ini menggantikan laporan "no-changes" yang dulu menutupi tulisan yang bocor.
- **State basi tidak menggagalkan request**: setelah wave paralel, status anak direfresh eksplisit; kalau masih terbaca `pending`/`queued` (snapshot SQLite lama), state dipulihkan secara terjurnal alih-alih `TransitionError: queued -> completed` yang dulu mem-fail satu request yang sebenarnya pekerjaannya sukses.
- Kegagalan coding step setelah mengubah workspace → checkpoint eksplisit (event `partial_work_detected`), tanpa retry/rescue otomatis sampai file diperiksa. `_fail_plan` memakai `force_transition` supaya step `pending`/`queued` yang gagal tetap tercatat, dan worker yang crash memakai `_abort_anchor` (membatalkan anak-anak yang masih berjalan).
- Aset 3D prosedural (placeholder); GLB/animasi skeletal masih tertunda.
- Backend di-bind ke localhost; jangan expose ke jaringan publik tanpa autentikasi dan pengetatan CORS.
