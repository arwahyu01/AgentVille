# AgentVille — Visual Redesign & Kehidupan Kantor Virtual

## Audit aktual sebelum implementasi

Repository sudah memiliki scene nyata pada `frontend/src/features/office/OfficeScene.tsx`, layout di `frontend/src/lib/officeLayout.ts`, pemetaan role/ruang di `backend/app/rooms.py`, CSS scene di `frontend/src/styles.css`, serta pemasangan scene di `frontend/src/App.tsx`. Audit kode ini sebagai titik awal; pertahankan status/event, pemilihan agen, dan gerak yang sudah berjalan.

Temuan awal dari pemeriksaan source saat ini (tetap verifikasi sebelum mengubah kode):

- `officeLayout.ts` sudah mendefinisikan sepuluh zona, termasuk lobby, CS, pantry, security, dan meeting. Pemetaan role/ruang backend ada di `backend/app/rooms.py`; jangan mengulang pekerjaan yang sudah selesai atau membuat ID ruang duplikat.
- Scene sudah dipecah ke komponen seperti `OfficeScene.tsx`, `Structure`, `RoomFitout`, `Lighting`, dan `AgentFigure`. Audit material, geometri, exposure, shadow, CSS, ukuran canvas, dan hasil render aktual; jangan memakai daftar warna/lighting dari prompt lama sebagai fakta tanpa memeriksa ulang.
- Kursi `OfficeChair` punya sandaran pada sisi lokal `-Z`; monitor workstation berada di sisi lokal meja yang sama, tetapi beberapa furnitur ruang dipasang terpisah dengan transformasi berbeda. Periksa rotasi aktual setiap zona, terutama kursi CS dan konfigurasi meja yang diputar, karena mismatch transformasi dapat membuat kursi membelakangi layar.
- `AgentFigure.tsx` sudah memuat gerak rute saat tujuan berubah oleh event backend dan animasi lengan yang hanya aktif untuk status bekerja. Audit apakah transformasi pose benar-benar menempatkan tangan pada keyboard dan apakah amplitudo animasinya terlihat dari kamera; keberadaan kode animasi belum membuktikan hasilnya terbaca.
- Kamera sudah menyediakan mode isometrik dan Explore dengan orbit. Verifikasi perbedaan sudut/framing pada render; jangan menyebut Explore sebagai first-person movement atau collision bila tidak diterapkan.
- Role agen proyek yang ditanam saat ini mencakup Coordinator, Developer, Researcher, Data Analyst, Administrator, Content Creator, Reviewer, Product Analyst, Designer, Frontend/Backend Developer, dan QA. Daftar tersebut belum mencakup Housekeeping. Verifikasi pula apakah Security hanya zona visual atau sudah memiliki staf operasional dan event patroli.
- Proposal Telegram dan transcript web harus diaudit secara nyata. Pastikan seluruh detail proposal dapat dibaca di Telegram dan pesan kerja spesialis yang benar-benar terjadi tersimpan serta tampil di web.

Jangan berhenti pada daftar temuan ini. Cocokkan dengan kode terbaru dan ukur render aktual sebelum menyimpulkan penyebab.

## Tujuan

Perbaiki implementasi aktual pada repository ini. Jangan membuat mockup, screenshot palsu, atau proyek baru. Hasil yang dituju adalah kantor virtual 3D modern premium, dominan putih/off-white, terang, bersih, berkarakter, dan tidak monoton. Scene harus terasa seperti interior kantor yang dirancang, bukan deretan kotak warna.

## Batas pekerjaan

- Fokus pada desain interior 3D, layout dan navigasi ruang, geometri, furnitur, material, pencahayaan, dekorasi, karakter, kamera, CSS container scene, serta integrasi status aktivitas yang diperlukan agar visual mencerminkan kejadian nyata.
- Jangan mengubah alur percakapan AI, approval, eksekusi proyek, Telegram, atau scheduler task proyek. Perubahan backend hanya diizinkan secara terbatas untuk menyimpan aktivitas operasional kantor terjadwal, transcript komunikasi tim yang memang terjadi, event aktivitas, dan pemetaan lokasi/role yang diperlukan oleh scene.
- Housekeeping dan Security adalah staf operasional kantor virtual. Jadwal mereka dibuat sistem secara otomatis; pengguna tidak perlu memerintahkannya. Aktivitas mereka hanya terjadi di dalam simulasi kantor AgentVille. Dilarang mengakses, membersihkan, menghapus, atau mengubah file, memori, proses, maupun sumber daya PC pengguna.
- Jangan menghapus ruang, workstation, status, atau data yang masih digunakan komponen lain.
- Pertahankan pemilihan karakter, panel detail, event activity, event-driven motion, SSE, dan fallback UI tanpa WebGL.
- Jangan menambahkan gerakan acak yang menyiratkan agen sedang bekerja, rapat, patroli, melayani pelanggan, atau membersihkan kantor.

## Kebutuhan desain dan denah

Bangun sepuluh ruang/zona yang berbeda dan mudah dikenali, terhubung oleh pintu serta jalur sirkulasi yang masuk akal:

1. **Lobby, ruang tamu, resepsionis** — meja front desk, signage, sofa, kursi tamu, meja kopi, tanaman dan lampu gantung.
2. **Customer Service (CS)** — beberapa meja layanan, kursi ergonomis, komputer/monitor, headset, sekat meja dan layar antrean.
3. **Programmer/Developer** — workstation multi-monitor, keyboard/mouse, kursi kerja dan papan arsitektur.
4. **Server/Database** — ruang terpisah dengan rack server, panel kontrol, ventilasi/pendingin, akses pintu dan indikator status.
5. **Analyst/Research** — meja/monitor dashboard, papan data, rak referensi.
6. **Design** — workstation kreatif, layar referensi, papan ide dan material/palet desain.
7. **Administration/Operations** — meja kerja, lemari arsip, rak dokumen dan printer.
8. **Security** — meja kontrol, beberapa layar CCTV dan panel akses.
9. **Pantry** — countertop, kabinet, kulkas, sink, mesin kopi, dispenser, meja kecil dan kursi.
10. **Meeting room** — meja konferensi, kursi cukup untuk peserta, layar presentasi besar dan papan tulis.

Ketentuan tata ruang:

- Atur ukuran ruang mengikuti kapasitas dan jenis furnitur. Sisakan ruang berjalan di antara meja/kursi, koridor, serta pintu; jangan membiarkan objek menutup jalur atau saling menembus.
- Pisahkan server room dari developer floor. Gunakan partisi kaca berbingkai tipis pada ruang yang perlu terlihat, dinding solid pada ruang yang memerlukan privasi/akses terbatas, serta bukaan yang tetap memperlihatkan interior dari kamera utama.
- Buat ruang terasa berbeda lewat susunan, signage, tekstur lantai, karpet area, panel akustik, dan satu aksen warna lembut per zona; pertahankan konsistensi keseluruhan kantor.
- Pastikan `frontend/src/lib/officeLayout.ts` dan `backend/app/rooms.py` tidak memiliki ID/role-room mapping yang bertentangan jika keduanya harus mengetahui lokasi agen. Jangan mengubah assignment task untuk sekadar memindahkan objek dekoratif.

## Bahasa visual dan kualitas interior

- Gunakan dinding putih/off-white, lantai terang namun tidak silau, kaca bening/buram, oak muda, metal brushed, dan aksen teal/cyan yang lembut. Hindari palet gelap/navy/ungu sebagai warna dominan dan hindari neon.
- Tambahkan pencahayaan berlapis yang terlihat dan berfungsi: daylight dari jendela besar, panel LED plafon, lampu gantung di lobby/pantry/meeting room, lampu meja kerja, serta aksen cahaya lembut pada signage/rak/tanaman. Gunakan exposure dan intensitas realistis, ambient fill cukup, serta bayangan lembut yang tidak menggelapkan ruangan.
- Gunakan detail arsitektur dan material yang berbeda: trim, lis plafon, rangka partisi, handle, kusen, panel dinding, batas lantai, karpet, dan kaca. Jangan hanya mengganti warna mesh lama.
- Tingkatkan furnitur dengan proporsi realistis: meja dan kursi ergonomis, monitor dengan bezel/stand, keyboard/mouse, CPU atau laptop bila relevan, arm monitor, aksesori meja, sofa, rak, lemari, printer, kulkas, sink, lampu, dan layar besar.
- Dekorasi harus lengkap tetapi tertata: tanaman berbagai ukuran, lampu lantai/gantung, jam, rak, poster/karya seni, signage, vas, buku, mug, dispenser dan tempat sampah. Variasikan posisi/bentuk antarruang agar tidak tampak copy-paste dan hindari clutter.
- Tingkatkan karakter humanoid prosedural yang ada atau gunakan aset ber-rig yang lisensinya jelas. Pertahankan kepala/wajah, torso, bahu, siku, tangan, paha, betis, kaki dan sepatu yang terbaca; tingkatkan proporsi, pose, artikulasi dan kontras terhadap interior putih. Jangan menambahkan aset eksternal tanpa memeriksa lisensinya.
- Perhatikan jumlah draw calls, geometri dan shadow maps. Gunakan komponen geometri yang dapat dipakai ulang, batasi bayangan ke objek penting, dan sediakan kualitas render yang tetap layak pada perangkat lemah.

## Kamera dan viewport

- Pertahankan orbit dan zoom pada mode isometrik, tetapi atur target, sudut, FOV, jarak awal dan batasnya agar seluruh kantor terlihat cukup besar sekaligus detail interior tetap terbaca. Jangan biarkan dinding perimeter/partisi menutupi karakter dan perabot.
- Tambahkan kontrol mode kamera **Isometric** dan **Walkthrough/Explore**. Walkthrough harus benar-benar memakai sudut lebih rendah dan framing lebih dekat. Jika hanya menyediakan orbit eksplorasi, sebut sebagai mode eksplorasi; jangan mengklaim first-person movement, collision, atau navigasi bebas yang belum diterapkan.
- Uji layout pada ukuran canvas nyata desktop dan viewport kecil. Pastikan canvas tidak tertekan oleh panel, tidak terlalu pendek, label tidak tertutup badge/hint, dan tombol kontrol kamera dapat dipakai.
- Untuk membantu inspeksi sepuluh ruang, sediakan framing seluruh kantor dan, jika dibutuhkan, pemilihan/fokus ruang tanpa menghilangkan kontrol kamera yang ada.

## Integrasi event dan karakter

- Pertahankan status agen dari backend dan event-driven motion yang telah ada.
- Pergerakan agen hanya boleh dimulai oleh event assignment/handoff/meeting yang nyata dan mengikuti waypoint yang tersedia. Pastikan jalur baru menghindari dinding, pintu tertutup, furnitur dan ruang server terbatas.
- Audit arah lokal setiap meja, monitor, keyboard, kursi, dan pose duduk. Kursi harus menghadap meja/monitor; jangan mengandalkan rotasi default yang kebetulan cocok di satu ruang. Samakan transformasi meja, monitor, keyboard, kursi, dan karakter pada tiap workstation, termasuk ruang dengan orientasi berbeda. Verifikasi hasil dari kamera isometrik dan walkthrough.
- Pose kerja harus menempatkan tubuh di kursi secara wajar, siku/lengan bawah mengarah ke permukaan meja, dan kedua tangan berada di area keyboard. Tambahkan artikulasi mengetik yang terlihat dari kamera utama (gerak kecil pergelangan/jari atau lengan bawah), tetapi hanya ketika agen benar-benar berstatus bekerja pada task yang mendukung penggunaan komputer. Jangan membuat gerak mengetik saat idle, menunggu dependency/approval, rapat, selesai, gagal, atau patroli.
- Pergerakan assignment/handoff/meeting harus terlihat cukup jelas untuk dibaca tanpa menjadi berlebihan: agen meninggalkan kursi, berjalan melalui koridor dan pintu yang benar, tiba di tujuan, lalu mengambil pose sesuai aktivitas. Tampilkan tujuan/aktivitas aktual di label atau panel detail.
- Animasi idle dekoratif harus dibedakan dari kerja aktual. Jangan membuat semua karakter mengetik atau berjalan terus-menerus tanpa state/event yang mendukungnya.
- Pastikan klik/pemilihan agen tetap bekerja setelah geometri bertambah; dekorasi tidak boleh menyerap klik agen secara tidak sengaja.

## Aktivitas kantor dan percakapan tim

### Alur rapat dan kolaborasi

- Pertahankan alur proyek yang sudah ada: Coordinator mengklarifikasi kebutuhan, menyusun rencana beserta anggota tim dan kriteria penerimaan, lalu menunggu persetujuan pengguna sebelum pekerjaan proyek dimulai.
- Rapat bukan kewajiban untuk setiap pekerjaan. Pekerjaan kecil yang jelas dapat langsung ditugaskan ke satu spesialis dan diteruskan ke QC. Untuk pekerjaan ambigu, lintas peran, atau dengan keputusan desain/arsitektur yang perlu disepakati, setelah approval adakan kickoff singkat dengan peserta relevan, agenda, dan keputusan yang tercatat.
- Rapat QC hanya dilakukan bila memang ada diskusi/keputusan bersama yang diperlukan. Jangan menganggap pemindahan semua agen ke ruang rapat sebagai bukti diskusi. Jika QC berjalan individual, tampilkan reviewer bekerja di workstation QC yang sesuai.
- Komunikasi antartim yang ditampilkan harus merupakan pesan/keputusan nyata dari orkestrasi, bukan dialog fiktif yang dibuat untuk mengisi scene. Jangan tampilkan chain-of-thought atau penalaran internal privat. Tampilkan ringkasan kerja yang relevan, pertanyaan, keputusan, status, serta handoff artefak.
- Sediakan panel/tab **Percakapan Tim** pada web yang menampilkan pembaruan Coordinator dan spesialis dengan nama/role, waktu, task/step terkait, serta urutan pesan. Data pesan harus disimpan persisten dan diperbarui melalui jalur event/realtime yang sudah ada. Pastikan daftar aktivitas tetap terbaca bila WebGL tidak tersedia.
- Saat proposal dikirim ke Telegram, tampilkan seluruh informasi rencana yang diperlukan pengguna untuk menilai scope, role yang ditugaskan, urutan/dependency, kriteria penerimaan, dan versi approval. Pecah pesan dengan aman sesuai batas Telegram dan urutan yang stabil. Balasan Telegram tetap tercatat dalam conversation yang sama. Jangan mengirim pesan Telegram saat pengujian.
- Jangan membuat klaim bahwa tim berdiskusi, menyetujui keputusan, atau menyerahkan artefak kecuali komunikasi/handoff tersebut benar-benar direkam.

### Housekeeping terjadwal

- Tambahkan role/staf operasional **Housekeeping** dengan identitas visual, workstation/ruang tugas, dan status yang berbeda dari Customer Service. Jangan menjadikan CS petugas kebersihan.
- Jadwal housekeeping berjalan otomatis di kantor virtual, tanpa perintah pengguna. Jadwal harus deterministik dan dapat dikonfigurasi: interval/jam kerja, urutan area, durasi, serta status berhenti/selesai. Hindari timer per-frame atau penjadwalan baru setiap render.
- Representasikan tugas yang masuk akal di scene, misalnya membersihkan area lantai dan merapikan pantry. Gunakan state/event eksplisit seperti `cleaning_started`, `area_cleaned`, `restocking_started` bila relevan, dan `cleaning_completed`, lengkap dengan actor, area, waktu, dan status.
- Agen berjalan ke area melalui jalur valid, memainkan animasi tugas yang terbaca (misalnya gerak mengepel/merapikan), lalu bergerak ke area berikutnya atau kembali ke titik tugas. Jangan menampilkan housekeeping aktif saat statusnya idle/off duty.
- Operasi ini hanya mengubah state simulasi kantor. Jangan gunakan tool file, shell, OS, atau API PC untuk membersihkan komputer pengguna.

### Security dan patroli terjadwal

- Tambahkan role/staf operasional **Security** dengan pos kontrol yang sesuai dan status piket/patroli.
- Patroli kantor virtual berjalan otomatis sesuai jadwal/shift deterministik yang dapat dikonfigurasi, tanpa perintah pengguna. Definisikan rute waypoint serta pos pemeriksaan yang relevan; hindari rute acak.
- Simpan event seperti `patrol_started`, `patrol_checkpoint_reached`, `patrol_completed`, dan `guard_posted`, lengkap dengan actor, rute/pos, waktu, dan status. Patrol harus dapat dihentikan/dilanjutkan dengan aman saat aplikasi restart dan tidak membuat duplikasi sesi.
- Tampilkan satpam meninggalkan pos, berjalan sepanjang rute, berhenti sejenak pada checkpoint, lalu kembali/bertugas di pos sesuai jadwal. Jangan mengganggu jalur agent proyek atau memasuki ruang server tanpa izin akses yang dimodelkan.
- Aktivitas patroli adalah simulasi kantor virtual; jangan membuat klaim tentang keamanan fisik atau mengakses CCTV/perangkat nyata.

### Model aktivitas yang dapat dipulihkan

- Periksa model database/event yang ada sebelum menambah skema. Gunakan event persisten dan state aktivitas yang idempoten, bertimestamp, dan punya identitas unik agar reconnect/restart tidak menggandakan animasi atau jadwal.
- Hubungkan event ke SSE/UI dan pemetaan actor → state/lokasi/tujuan. Scene merender aktivitas dari event/state tersebut, bukan membuat sumber kebenaran terpisah di browser.
- Buat pemetaan role, ruangan, workstation, dan titik aktivitas konsisten di backend serta `officeLayout.ts`. Tambahkan Housekeeping dan Security ke data agen/role secara aman untuk instalasi baru maupun database lama; jangan menggandakan agen saat startup dan jangan menimpa state pengguna.
- Semua aktivitas operasional tetap memiliki status dan tampilan yang jujur: terjadwal, menuju area, bekerja, checkpoint, selesai, tertunda, atau gagal. Tangani kegagalan jalur, pause, restart, dan jam di luar shift tanpa membuat status palsu.

## Urutan kerja

1. Audit file dan catat akar penyebab visual dengan path komponen/material/CSS/kamera yang spesifik. Audit pula orientasi workstation, state animasi, model event, transcript, dan role operasional. Ambil screenshot sebelum perubahan bila aplikasi bisa dijalankan.
2. Susun layout berskala dan koordinat untuk sepuluh ruang, pintu, workstation, koridor dan waypoint; periksa tidak ada overlap.
3. Implementasikan interior per ruang melalui komponen reusable, material terang, pencahayaan, dekorasi dan karakter; hindari satu file dengan abstraksi yang berlebihan.
4. Tambahkan mode kamera dan framing seluruh kantor/walkthrough dengan label yang jujur.
5. Tambahkan Housekeeping dan Security sebagai staf operasional virtual terjadwal dengan event persisten, mekanisme restart/idempotensi, rute/area aktivitas, dan pemetaan room/role yang konsisten. Jangan mengubah scheduler task proyek.
6. Hubungkan aktivitas/event tersebut ke scene dan UI; implementasikan pose mengetik, berjalan, rapat, patroli, serta housekeeping yang dipicu oleh state nyata. Tambahkan panel Percakapan Tim untuk pesan kerja yang benar-benar tercatat dan pastikan proposal Telegram tidak menghilangkan detail plan.
7. Jalankan build frontend dan pemeriksaan/test relevan untuk backend, event, restart, idempotensi, route, dan transcript. Gunakan transport Telegram mock; jangan mengirim pesan nyata.
8. Jalankan app pada browser desktop dan periksa console serta render nyata. Ambil screenshot sesudah perubahan dan nilai: sepuluh ruang tampak, putih tidak overexposed, kursi menghadap monitor, tangan berada di area keyboard, staf bergerak sesuai state, housekeeping dan patroli terlihat sesuai jadwal, aktivitas tim terbaca, sirkulasi masuk akal, kamera berfungsi.
9. Periksa viewport kecil dan performa. Bila salah satu aktivitas tidak bisa diverifikasi di render nyata atau event/backend, laporkan sebagai belum selesai.

## Hasil yang harus dilaporkan

- Akar penyebab visual yang ditemukan.
- File yang diubah dan alasan tiap perubahan.
- Build dan console yang benar-benar diperiksa.
- Bukti orientasi kursi/pose mengetik dan aktivitas berjalan yang benar-benar terlihat.
- Bukti jadwal Housekeeping/Security, event, pemulihan restart/idempotensi, dan konfirmasi bahwa keduanya hanya beroperasi di simulasi kantor.
- Bukti percakapan tim di web, rencana lengkap yang dikirim Telegram melalui mock, dan kebijakan rapat kondisional.
- Perbandingan visual sebelum/sesudah atau screenshot hasil yang benar-benar diambil.
- Kebutuhan yang belum selesai, batas performa, dan klaim yang belum dapat diverifikasi.

Jangan mengklaim scene berhasil diperbaiki hanya berdasarkan source code. Hasil render harus diperiksa.
