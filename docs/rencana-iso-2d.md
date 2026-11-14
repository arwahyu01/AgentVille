# AgentVille — Rencana Kantor Isometrik 2D

Dokumen kerja yang bisa dilanjutkan. Centang tahap hanya setelah verifikasinya benar-benar lulus
(tes, build, atau render di browser). Diperbarui: 2026-11-14. Branch: `feat/iso-2d-renderer`
(belum di-commit saat dokumen ini ditulis).

## 1. Tujuan

Membuat kantor virtual AgentVille terlihat **nyata** dan **sesuai yang diperintahkan**, seperti
referensi video `kantor ai.mp4` (kantor isometrik 2D bergaya game manajemen):

1. **Tampilan:** ilustrasi hangat dan detail (kayu, kaca, kota di balik jendela, lampu), avatar
   chibi dengan label nama dan kode tugas.
2. **Perilaku:** apa yang dilakukan karakter di layar mencerminkan apa yang benar-benar dikerjakan
   agen. Contoh dari video: saat menunggu persetujuan, tim berkumpul di ruang rapat dengan tanda
   "!" dan layar dinding bertuliskan judul pekerjaan; yang sudah selesai bersantai.

## 2. Prinsip yang tidak boleh dilanggar

- **Tidak ada gerak karangan.** Karakter hanya melakukan sesuatu bila ada baris backend
  (`task_events`, status agen, sesi Claude) yang melaporkannya. Gerak ambien (napas, jalan-jalan
  sosial) tetap diberi label "simulasi lokal".
- **Satu sumber tata letak.** Meja, kursi, pintu, dan rute berasal dari
  `frontend/src/lib/officeLayout.ts`, dipakai bersama oleh 3D dan 2D, dan dicocokkan dengan
  `backend/app/rooms.py`.
- **Privasi.** Hanya ringkasan satu baris yang sudah disamarkan (`redact()` di
  `backend/app/claude_sessions.py`) yang boleh disimpan atau ditampilkan. Tidak pernah isi file,
  perintah utuh, prompt utuh, atau kredensial.
- **Perubahan backend perlu persetujuan eksplisit** (lihat keputusan K1). Prompt lama repo ini
  melarang menyentuh `orchestrator.py`, provider, dan Telegram.
- **3D tetap berfungsi.** Tombol 2D/3D dan pilihan agen tidak boleh rusak.
- Klaim "selesai" hanya setelah dijalankan dan diperiksa. Keterbatasan ditulis apa adanya.

## 3. Status sekarang

### 3.1 Selesai dan terverifikasi

**Fase 0–1 — Baseline dan renderer 2D**
- [x] Repo di-clone ke `~/Herd/AgentVille`, dijalankan di macOS (backend Python 3.12 via `uv`,
      frontend Vite). Entri `agentville-backend` dan `agentville-frontend` ada di
      `~/Herd/.claude/launch.json`.
- [x] Renderer PixiJS 8.23, dimuat malas (chunk `IsoOffice` ±328 kB, gzip ±105 kB):
      `frontend/src/features/iso/` (`IsoOffice.tsx`, `officeArt.ts`, `avatar.ts`, `motion.ts`,
      `draw.ts`, `claudeSeats.ts`) dan proyeksi di `frontend/src/lib/iso.ts`.
- [x] Tombol **2D / 3D** (pilihan disimpan di `localStorage`), bilah ruangan dengan jumlah orang,
      penggeser ukuran agen, zoom, geser, fokus kamera per ruangan.
- [x] Agen memakai meja dan jalur yang sama dengan 3D (`poseFor`, `routeTo`, `stationSlots`,
      `socialDirector`); klik agen membuka dialog yang sama dengan 3D.
- [x] Monitor meja menyala hanya untuk agen yang diparkir backend di meja itu; balon event hanya
      dari `task_events`; "!" untuk status `waiting`.
- [x] Tes: `iso.test.ts` dan `motion.test.ts`. Dicek di browser desktop dan ponsel (375 px).

**Tambahan — Claude**
- [x] Provider `claude` (`backend/app/ai/claude.py`): mode text (`--tools ""`, tanpa MCP) dan mode
      coding (`--permission-mode acceptEdits`, `cwd=<workspace>`). Menemukan `claude` di PATH, di
      instalasi native, atau binary bawaan Claude Desktop; bisa dioverride dengan
      `AGENTVILLE_CLAUDE_BIN`. Teruji nyata: text 4,9 dtk, coding 6,5 dtk.
- [x] Sesi Claude Code tampil sebagai karakter berbaju oranye lewat hook HTTP
      (`POST /api/claude/hooks`, `GET /api/claude/sessions`, `backend/app/claude_sessions.py`,
      `scripts/claude_hooks.py`). Terpasang global di `~/.claude/settings.json`. Sesi AgentVille
      sendiri tidak digambar dua kali (header `X-AgentVille-Run`). Teruji dengan sesi asli.
- [x] Uji alur penuh: request → rencana v1 (3 langkah) → setujui → 3 langkah dijalankan Claude →
      QC `pass` → `index.html` valid. AI Engine sudah dimatikan lagi.

**Hasil uji terakhir:** backend 194 lolos / 1 gagal / 1 dilewati; frontend 125 lolos; lint 0
error (17 peringatan, semuanya sudah ada sebelumnya); build sukses.
Kegagalan backend (`test_sandbox.py::test_kill_tree_terminates_grandchild`) juga terjadi pada kode
asli di macOS, jadi bukan dari pekerjaan ini.

### 3.2 Celah yang sudah diketahui

- Gambar 2D masih **dilukis dari kode** (poligon dan blok warna), belum ilustrasi sungguhan.
- Avatar masih sederhana: satu pose duduk/berdiri/jalan, belum ada pose bicara, presentasi, atau
  membawa dokumen.
- Gerak karakter masih terbatas pada: duduk di meja, jalan antar ruangan, istirahat (sesi Claude),
  dan obrolan sosial lokal. Belum ada "berkumpul rapat saat menunggu approval", belum ada layar
  dinding berisi pekerjaan nyata, belum ada Reviewer mendatangi pemilik langkah.
- ~~Backend hanya mengirim event kasar tanpa info file atau alat~~ → **teratasi untuk provider
  Claude** (Fase 4.2). opencode dan qodercli tidak terpasang di mesin ini sehingga tidak bisa diuji;
  keduanya tetap hanya mengirim event kasar.
- Langkah rencana yang saling bergantung berjalan berurutan, jadi pada rencana linear biasanya
  hanya satu agen yang bekerja pada satu waktu. (Orchestrator **sudah** menjalankan langkah yang
  independen secara paralel dalam gelombang DAG, maksimal `max_concurrency` = 3; kantor menjadi
  lebih ramai bila rencananya memang punya langkah independen.)
- Badge provider "ready" hanya berarti binary ditemukan, bukan bahwa sudah login.
- Dua sesi Claude di folder yang sama dibedakan dengan akhiran id (`kmipn2027 ·ff5b`); nama itu
  belum bisa diubah pengguna.
- README bagian instalasi masih berbasis PowerShell/Windows.

## 4. Urutan pengerjaan yang disarankan

**Fase 4 → Fase 2 → Fase 3 → Fase 5 → Fase 6.** Fase 4 paling menjawab tujuan "sesuai
perintah" dan tidak bergantung pada kualitas gambar. Fase 2–3 mengejar tampilan dan lebih
berisiko. Nomor fase dipertahankan dari rencana sebelumnya supaya mudah dilacak.

---

## Fase 4 — Perilaku sesuai perintah

**Hasil akhir:** karakter bertindak berdasarkan event nyata dengan detail yang cukup untuk dibaca
orang: apa yang sedang dibaca/ditulis/dijalankan, dan ke mana ia pergi.

### 4.1 Spike (selesai, 2026-11-14)
- [x] `claude -p --output-format stream-json --verbose` diuji nyata. Satu event per baris:
      `system`/`init`, `assistant` (blok `tool_use` berisi `name` + `input`, atau `thinking`/`text`),
      `user` (blok `tool_result`), event `system` pendukung, dan satu `result` akhir yang
      bentuknya sama dengan keluaran `--output-format json`. Jadi `parse_result` lama tetap dipakai.
- [x] Hook HTTP yang gagal terkirim (backend mati) **tidak** memblokir Claude: hanya satu baris
      peringatan di stderr, proses tetap selesai dengan kode 0.
- [x] Catatan perilaku: Claude kadang menulis berkas lewat `Bash` (`... > out.txt`) alih-alih
      `Write`, jadi aksi itu terbaca sebagai `run`, dengan deskripsi dari Claude sendiri.
- [ ] opencode dan qodercli **tidak terpasang** di mesin ini → event per alatnya belum diperiksa.
      Keduanya tetap memakai event kasar sampai ada yang menguji.

### 4.2 Event aksi di backend (K1 disetujui; selesai)
- [x] `backend/app/agent_actions.py`: penyamaran + ringkasan alat (dipindah dari
      `claude_sessions.py`), pembaca baris stream-json, dan `ActionGate` (maks. 1 event per 1,5 dtk
      dan 60 per langkah).
- [x] `Persona.on_action` (opsional, tidak ikut perbandingan). Provider Claude memakai
      `stream-json` hanya bila callback ada; callback yang error tidak pernah menggagalkan langkah.
- [x] Orchestrator (`_action_sink`) menulis `action_read|write|run|search|think` ke `task_events`
      dengan `agent_id`, `step_index`, `provider`, `model`. **Tanpa migrasi skema.**
- [x] `GET /api/events/team` menyembunyikan `action_*` secara bawaan (`include_actions=true` untuk
      melihatnya) supaya panel Team Conversation tidak kebanjiran.
- [x] Tes: `test_agent_actions.py`, tambahan di `test_claude_provider.py` dan
      `test_orchestrator_conversation.py`.
- [x] Run nyata (provider Claude, request kecil): `action_write` oleh Blaze, `action_read` dan
      `action_run` oleh Gauge, semuanya dengan nama agen dan langkah yang benar.

### 4.3 Pemetaan event → tampilan
- [x] `frontend/src/features/iso/actions.ts` (`actionFor`, `latestActionByAgent`) dengan tes.
      Event aksi disimpan per agen di `App.tsx` (bukan di jurnal 14 baris) dan tidak memicu
      pemuatan ulang.
- [x] Bubble berisi ikon per jenis aksi; menulis/menjalankan = mengetik, membaca/mencari = tidak;
      layar meja berwarna menurut jenis aksi; label 3D memakai teks aksi.
- [x] **Rapat rencana** (backend `conversation_service.py`): saat rencana menunggu persetujuan,
      Coordinator dan agen yang dipakai rencana (yang tidak sedang bekerja) berkumpul di ruang
      rapat; layar dinding menampilkan "Rencana vN: …"; selesai saat disetujui, direvisi,
      diganti, atau dibatalkan. Tes: `test_plan_meeting.py`. Diverifikasi di browser.
- [x] Rapat QC (sudah ada sebelumnya) tetap jalan; dalam run nyata keduanya berurutan tanpa agen
      yang tertinggal di ruang rapat.

| Sumber nyata | Yang terlihat | Status |
|---|---|---|
| Rencana `awaiting_approval` | Tim berkumpul di ruang rapat, layar berisi judul rencana, "!" pada Coordinator | **Selesai** |
| `action_write` / `action_run` | Mengetik, bubble + ikon, layar meja berwarna | **Selesai** |
| `action_read` / `action_search` | Tidak mengetik, bubble + ikon, layar biru/kuning | **Selesai** |
| `meeting_started` (QC) | Duduk di ruang rapat, topik di layar | Sudah ada |
| `handoff_*` | Berjalan ke meja rekan **membawa dokumen** | Berjalan antar ruangan sudah ada; "membawa dokumen" belum |
| QC gagal | Reviewer **mendatangi pemilik langkah** | Belum |
| Langkah selesai | **Bersantai di pantry** setelah jeda (agen AgentVille) | Belum (baru untuk sesi Claude) |
| Sesi Claude `waiting` | Berdiri di meja dengan "!" | Sudah ada |

- [ ] Sisa tabel: membawa dokumen saat serah terima, Reviewer mendatangi pemilik langkah, agen
      selesai bersantai di pantry.
- [ ] Layar monitor menampilkan nama berkas (butuh aset layar dari Fase 2).
- **Gerbang:** tes lolos dan diverifikasi di browser (sudah untuk yang bertanda Selesai).

### 4.4 Paralelisme
Sudah ada di orchestrator (gelombang DAG, `max_concurrency` bawaan 3, langkah tanpa dependensi).
Tidak ada pekerjaan tambahan; keputusan K2 tidak diperlukan lagi.

---

## Fase 2 — Ilustrasi ruangan

**Hasil akhir:** tampilan sekelas video: lantai kayu/marmer, dinding kaca dengan kota, furnitur
dengan bayangan dan cahaya hangat.

**Pendekatan yang disarankan (K3): atlas properti, bukan lukisan satu ruangan.**
Karakter harus bisa lewat di belakang dan di depan furnitur. Itu mudah bila setiap furnitur
adalah sprite terpisah yang diurutkan kedalaman (`zIndexOf`, sudah dipakai), dan sulit bila satu
ruangan berupa satu gambar utuh.

- [ ] Panduan gaya satu halaman: palet, arah cahaya, tebal garis, sudut proyeksi 2:1 (sama dengan
      `iso.ts`).
- [ ] Atlas properti: meja, kursi, monitor, sofa, tanaman, rak, rak server, meja rapat, layar
      dinding, perabot pantry. Tiap properti diberi titik tumpu (`anchor`) di lantai.
- [ ] Lantai dan dinding tetap **dibangun dari kode** (marmer, kayu, kaca) agar selalu pas dengan
      denah; hanya properti yang diganti sprite.
- [ ] `officeArt.ts` menempatkan sprite pada koordinat `officeLayout.ts`; builder lama tetap jadi
      cadangan bila aset gagal dimuat.
- [ ] Sumber aset: dibuat dengan generator gambar lalu dirapikan, atau ilustrator manusia (K3).
      **Lisensi dan asal tiap aset dicatat** di `docs/assets.md`.
- **Gerbang:** render 10 ruangan dibandingkan dengan frame video; kedalaman benar (karakter tidak
  menembus furnitur); ukuran aset total dan waktu muat tercatat.
- **Risiko:** sudut atau gaya antar-aset tidak konsisten. Mitigasi: kunci panduan gaya dan
  generasi dalam satu sesi per kelompok; uji beberapa properti dulu sebelum seluruh atlas.

---

## Fase 3 — Avatar sprite

**Hasil akhir:** karakter chibi yang lebih kaya, tetap deterministik per agen.

- [ ] Rig boneka berlapis (kepala, torso, lengan, kaki) dengan lapisan yang bisa diwarnai
      (kulit, rambut, baju) supaya 14 agen + staf + sesi Claude memakai aset yang sama.
- [ ] Pose baru: duduk-mengetik (ada), berdiri, jalan (ada), bicara, presentasi di layar dinding,
      membawa dokumen, santai/minum kopi, menunjuk.
- [ ] Arah: depan dan belakang dengan cermin kiri-kanan (sudah dipakai `facingView`).
- [ ] Label nama + kode tugas dan balon tetap terbaca di semua ukuran penggeser.
- [ ] Sesi Claude: baju oranye `#d97757` tetap menjadi pembeda.
- **Gerbang:** tes pemilihan pose per status; tangkapan layar tiap pose; hit area klik tetap pas.

---

## Fase 5 — Verifikasi

- [ ] Skenario tetap: "buatkan landing page restoran". Tangkapan layar per event kunci (rencana
      diajukan, menunggu approval, langkah berjalan, serah terima, QC, selesai) di
      `docs/screenshots/`.
- [ ] Bandingkan berdampingan dengan frame video; catat selisih yang disengaja.
- [ ] Jalankan skenario dengan provider Claude **dan** tanpa event aksi (provider lain) untuk
      memastikan degradasi tetap rapi.
- [ ] Cek: konsol bersih, tidak ada gerak tanpa event, 3D tidak rusak, ponsel 375 px,
      `prefers-reduced-motion`.
- **Gerbang:** `npm run test`, `npm run lint`, `npm run build`, `pytest` (satu kegagalan
  macOS yang sudah dikenal dicatat), serta tangkapan layar terlampir.

## Fase 6 — Performa dan perapian

- [ ] FPS dan jumlah draw call di 2D saat 14 agen + 4 sesi Claude; target mulus di laptop
      biasa. Ukur, jangan menebak.
- [ ] Ukuran bundel: chunk utama masih ±1,48 MB (warisan 3D); pastikan 2D memuat malas dan aset
      Fase 2 dimuat bertahap.
- [ ] Fallback bila WebGL tidak ada: daftar agen yang sudah ada tetap tampil.
- [ ] Rapikan celah di 3.2 yang relevan: badge login provider, nama sesi Claude, README macOS.
- [ ] Dokumentasi: perbarui `README.md` dan `docs/technical-decisions.md`.

---

## 5. Keputusan yang diperlukan dari pemilik

| # | Keputusan | Pilihan | Saran |
|---|---|---|---|
| K1 | Boleh mengubah backend (`orchestrator.py`, provider) untuk event aksi? | Ya / Hanya sisi frontend | **Diputuskan: Ya** (2026-11-14); dikerjakan lewat event baru di `task_events` tanpa migrasi skema |
| K2 | Menjalankan beberapa agen sekaligus? | — | **Tidak perlu**: sudah ada (lihat 4.4) |
| K3 | Sumber aset ilustrasi | Generator gambar + rapikan / Ilustrator manusia | Generator untuk uji gaya, ilustrator bila hasil tidak konsisten |
| K4 | Ruangan tambahan seperti di video (kolam, gaming, studio, masjid) | Tambah / Tetap 10 ruangan | **Tetap 10 dulu**; ruangan baru mengubah denah dan `rooms.py` |
| K5 | Hook Claude tetap global? | Global / Per proyek | Global (sekarang); cabut dengan `scripts/claude_hooks.py --remove --apply` |

## 6. Housekeeping

- [ ] Commit pekerjaan ke `feat/iso-2d-renderer` (sekarang 41 berkas berubah/baru). Belum ada
      commit; Fase 4 dikerjakan tanpa titik kembali.
- [ ] Task uji 1 ("Halo AgentVille") dan `data/workspace/project-1/` masih ada di database
      lokal; hapus bila tidak diperlukan.
- [ ] Hook global di `~/.claude/settings.json` aktif; backup ada di
      `~/.claude/settings.json.agentville-bak-*`.
- [ ] Server dev memakai port 5175 (5173 dipakai proses lain); `CORS` backend hanya mengizinkan
      5173, tetapi Vite mem-proxy `/api`, jadi tidak bermasalah.

## 7. Cara memverifikasi

```bash
cd frontend && npm run test && npm run lint && npm run build
cd backend && .venv/bin/python -m pytest -q
```

Render: jalankan backend (`agentville-backend`) dan frontend (`agentville-frontend`) dari
`launch.json`, buka `http://localhost:5175/?qa` (parameter `qa` membuka `window.__agentvilleIso`
untuk membaca posisi dan kamera), lalu periksa konsol dan ambil tangkapan layar.
