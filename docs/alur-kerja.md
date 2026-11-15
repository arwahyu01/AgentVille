# Alur kerja per jenis pekerjaan (rancangan)

Status: **Marketing dan Aplikasi sudah dikerjakan** (backend `app/workflows.py`, gerbang di `conversation_service.py`, pemeriksaan antar-peran di `orchestrator.py`, panel Butuh Persetujuan di frontend). Riset dan Laporan belum. Dasar: planner sekarang bebas menyusun langkah dari 12 peran
(`backend/app/plan_schema.py`), tanpa pola baku. Rancangan ini menambah *template alur* per jenis
kerja. Planner (Atlas) memilih template, lalu mengisi detail tiap tahap; urutan dan gerbang tidak
lagi dikarang.

## Prinsip

1. **Satu tahap = satu penanggung jawab.** Setiap tahap punya: pengerjanya, pemeriksanya, dan
   keluaran (artefak) yang diserahkan ke tahap berikutnya.
2. **Tidak ada tahap yang memeriksa dirinya sendiri.** Pemeriksa selalu peran lain.
3. **Gerbang persetujuan** ada dua tingkat:
   - *Gerbang Atlas (AI)*: otomatis setelah pemeriksaan lulus; tetap tercatat sebagai approval.
   - *Gerbang Anda (kunci)*: pekerjaan berhenti sampai Anda menyetujui. Hanya di dua titik:
     **rencana awal** dan **hasil akhir**.
4. **Gagal verifikasi = kembali ke pengerjanya** dengan catatan (maks. 2 putaran), bukan lanjut.
5. Tidak ada gerakan karakter karangan: perpindahan, rapat, dan kunjungan tetap berasal dari
   event backend yang nyata.

## Peran baru (usulan)

| Peran | Tugas | Ruang |
|---|---|---|
| Marketing Strategist | strategi, target audiens, pesan inti, KPI | analyst |
| Copywriter | naskah iklan, caption, email, landing | design |
| Fact-Checker | memverifikasi klaim, sumber, angka riset | analyst |
| Tech Lead | arsitektur, memecah tugas, review kode | dev |

Peran lama tetap dipakai. Content Creator tetap membuat ide/skrip visual; Copywriter fokus teks
jualan.

## Template 1 — Marketing

| # | Tahap | Pengerja | Pemeriksa | Keluaran | Gerbang |
|---|---|---|---|---|---|
| 1 | Brief & tujuan | Atlas | — | brief + KPI | **Anda** (rencana) |
| 2 | Riset pasar & pesaing | Researcher | Fact-Checker | ringkasan riset bersumber | Atlas |
| 3 | Strategi & pesan inti | Marketing Strategist | Atlas | strategi, audiens, kanal | Atlas |
| 4 | Pembuatan konten | Copywriter + Content Creator | Marketing Strategist | naskah/skrip/caption | Atlas |
| 5 | Visual (bila perlu) | UI/UX Designer | Marketing Strategist | arahan visual | Atlas |
| 6 | Verifikasi akhir | Reviewer | — | verdict QC per kriteria | Atlas |
| 7 | Persetujuan akhir | — | — | paket siap pakai | **Anda** |

Tahap 2 dan 3 berurutan; tahap 4 dan 5 boleh paralel.

## Template 2 — Membuat aplikasi

| # | Tahap | Pengerja | Pemeriksa | Keluaran | Gerbang |
|---|---|---|---|---|---|
| 1 | Klarifikasi & requirement | Product Analyst | Atlas | user story + kriteria | **Anda** (rencana) |
| 2 | Desain alur & UI | UI/UX Designer | Product Analyst | wireframe, token desain | Atlas |
| 3 | Arsitektur & pembagian tugas | Tech Lead | Atlas | struktur, kontrak API | Atlas |
| 4a | Frontend | Frontend Developer | Tech Lead | kode di workspace | Atlas |
| 4b | Backend | Backend Developer | Tech Lead | kode di workspace | Atlas |
| 5 | Pengujian | QA Engineer | Tech Lead | hasil tes | Atlas |
| 6 | Verifikasi akhir | Reviewer | — | verdict QC per kriteria | Atlas |
| 7 | Persetujuan akhir | — | — | diff + ringkasan | **Anda** |

4a dan 4b paralel (sudah didukung wave + workspace terpisah). QC gagal mengembalikan tahap yang
disebut `failed_steps`.

## Template berikutnya (setelah dua di atas stabil)

- **Riset:** pertanyaan → pengumpulan (Researcher) → analisis (Data Analyst) → verifikasi sumber
  (Fact-Checker) → ringkasan (Administrator) → review → **Anda**.
- **Laporan/dokumen:** outline → draf → data → pemeriksaan → pengesahan.

## Perubahan teknis yang terlibat

1. `plan_schema.py`: peran baru; `PlanStep` dapat `reviewer_role`, `gate` (`none|atlas|user`),
   `deliverable`; `TaskPlan` dapat `workflow`.
2. Modul baru `workflows.py`: definisi template di atas (data, bukan kode bercabang).
3. Prompt Atlas: memilih `workflow`, mengisi instruksi; validasi menolak plan yang melanggar
   urutan/gerbang/pemeriksa.
4. `orchestrator.py`: eksekusi tahap pemeriksa, putaran perbaikan (maks. 2), jeda di gerbang
   *user* sampai ada approval; `propose_plan` tidak lagi auto-approve untuk gerbang kunci.
5. `database.py` + `rooms.py`: seed 4 karakter baru dan kamarnya.
6. Frontend: kartu pekerjaan menampilkan jalur tahap (siapa → siapa → gerbang), tombol setujui
   di gerbang kunci; kantor 2D/3D memakai kursi baru.
7. Tes: validasi template, putaran perbaikan, jeda gerbang, regresi alur lama.

## Keputusan

- Hanya dua gerbang kunci untuk Anda: rencana awal dan hasil akhir (status baru `awaiting_acceptance`, endpoint `POST /api/conversations/{id}/accept`).
- Permintaan yang tidak cocok template mana pun memakai alur bebas lama (disetujui otomatis).
- Batas kedalaman rantai (default 4) tidak berlaku untuk template; panjangnya mengikuti template.
- Pemeriksaan antar-peran: maks. 2 putaran per tahap; balasan pemeriksa yang tak terbaca dicatat dan diteruskan ke QC akhir, tidak dianggap lulus.

## Pelajaran dari riset #13 (gagal 27 kali, lalu lulus)

Penyebabnya berlapis; setiap lapis baru terlihat setelah lapis sebelumnya diperbaiki.

| # | Penyebab | Gejala di QC | Perbaikan |
|---|---|---|---|
| 1 | Hasil langkah diteruskan maks. 4.000 karakter (bersama instruksi dan semua dependensi) | "brief hanya sampai keyword ke-5", "gap analysis tidak saya terima" | `fit_handoff`: hasil diteruskan utuh untuk Claude (stdin); bila terpaksa dipotong, jatah adil per dependensi dan potongan ditandai |
| 2 | Ujung prompt dipotong `[:6000]`, sehingga kriteria dan catatan perbaikan ikut hilang | perbaikan tidak menyentuh temuan | bagian tetap (instruksi, kriteria, catatan) tidak pernah dipotong |
| 3 | Revisi ditolak untuk permintaan berstatus gagal | tombol Revisi tidak berfungsi | `failed -> clarifying` diizinkan; langkah lama jadi riwayat (tanpa indeks langkah) |
| 4 | QC membaca artefak rencana lama | QC mengutip task-16/17 setelah revisi | semua kueri langkah memfilter `plan_step_index` |
| 5 | Nama provider rotasi = "auto", sehingga QC memakai batas kecil 12k | "excerpt terpotong" | ruang prompt QC memakai provider yang dikonfigurasi |
| 6 | Kutipan dokumen: 140 karakter pertama + bagian "Ringkasan" saja | C4/C5 "tidak dapat diverifikasi" di setiap putaran | dokumen yang muat ditampilkan utuh; yang tidak muat: awal + akhir dengan penanda |
| 7 | Kriteria angka pasti (maks. 1.500/6.000 karakter) yang tak bisa diukur penulis | gagal karena 1.641 B vs 1.500 | Atlas diminta menulis kriteria yang bisa dicek dari isi; QC diberi toleransi 20% untuk "sekitar N" |
| 8 | Langkah "review" terpisah menulis ulang dokumen, padahal QC selalu berjalan | dokumen 11-14 ribu karakter, terpotong | Atlas tidak menambah langkah review; tahap Verifikasi di template jadi opsional |
| 9 | QC mengarang ref `missing:...`, lalu seluruh vonisnya dibuang | "QC payload rejected", tidak ada putaran perbaikan | untuk vonis gagal, ref karangan dibuang tetapi temuan tetap dipakai; vonis lulus tetap ketat |
