# Prompt Perbaikan Gap AgentVille

Kerjakan repository AgentVille yang sudah ada. Sebelum mengubah kode, audit implementasi aktual dan pertahankan alur yang sudah benar. Jangan percaya klaim README tanpa menelusuri implementasi. Jangan membuka atau mencetak isi file `.env`, kredensial, atau token.

## Target produk

Pengguna dapat memberi instruksi dan melanjutkan percakapan lewat Web maupun Telegram pada pipeline percakapan yang sama. Coordinator bertanya sampai kebutuhan cukup jelas, membuat proposal ruang lingkup/rencana dengan kriteria penerimaan, dan menunggu persetujuan eksplisit sebelum tool berjalan. Balasan Coordinator harus kembali ke kanal asal. Setelah disetujui, spesialis mengerjakan subtask sebagai tim yang dapat berkoordinasi dan bekerja paralel saat dependency mengizinkan, lalu QC memeriksa hasil.

Kantor 3D harus terasa seperti kantor modern sungguhan dengan desain dominan putih, terang, bersih, profesional, aksen kayu muda/kaca, dan warna teal/cyan yang lembut. Sediakan ruang/zona terpisah untuk lobby/ruang tamu-resepsionis, Customer Service (CS), programmer/developer, server dan database, analis/riset, desain, administrasi/operasional, security, pantry, serta ruang rapat. Setiap zona harus memiliki furnitur dan peralatan yang sesuai, jalur sirkulasi yang masuk akal, dan hubungan visual yang mudah dipahami. Karakter adalah manusia 3D dengan kepala, badan, dua lengan/tangan, dua kaki/telapak kaki yang terlihat proporsional; bukan kapsul dengan bola sebagai kepala. Agent berinteraksi, berpindah ruang, bekerja di workstation, dan rapat hanya berdasarkan assignment, handoff, serta event workflow yang nyata. Web menampilkan percakapan, rencana, task graph, aktivitas, hasil, QC, dan status tim. Scene 3D mencerminkan event backend secara realtime.

## Gap yang harus diperiksa dan ditutup

### 1. Spesialis pengembangan

- Periksa `backend/app/plan_schema.py`, `backend/app/ai/personas.py`, seed agen, dan UI agen.
- Tambahkan peran yang benar-benar diperlukan untuk pembuatan aplikasi, minimal Product/Requirements, Designer, Frontend Developer, Backend Developer, dan QA/Reviewer. Gunakan satu sumber kebenaran untuk daftar role agar planner, validasi schema, persona, seed database, dan UI tidak berbeda.
- Jangan memetakan role tak dikenal diam-diam ke AI Coordinator. Tolak rencana yang memiliki role tak dikenal dengan error yang bisa diperbaiki.
- Pastikan instruksi persona Developer sesuai dengan mode eksekusi. Persona coding tidak boleh mengatakan bahwa ia tidak dapat mengubah file ketika `uses_tools=true`; persona text-only harus tetap dilarang mengklaim perubahan file.
- Bedakan tanggung jawab per role dan jelaskan artefak yang harus diserahkan antarlangkah.

### 2. Telegram sebagai kanal kerja lengkap

- Periksa `backend/app/channels/telegram.py`, `normalizer.py`, `conversation_service.py`, dan API conversation.
- Pastikan pesan Telegram selama status `clarifying` masuk ke percakapan aktif yang benar dan memicu Coordinator.
- Setiap balasan Coordinator, pertanyaan klarifikasi, proposal rencana, hasil, kegagalan, dan status penting harus dikirim kembali ke chat Telegram asal serta disimpan pada transcript conversation yang sama. Jangan hanya mengirim notifikasi milestone; percakapan harus dua arah dan berlanjut di Telegram.
- Tangani pesan saat `awaiting_approval` secara eksplisit. Jangan menyimpan pesan lalu diam-diam mengabaikannya. Sediakan approval, revisi, pembatalan, dan cek status melalui kontrol/command Telegram yang idempoten; approval harus menyebut versi rencana yang disetujui. Contoh command: `/approve <plan_version>`, `/revise <catatan>`, `/cancel`, `/status`. Balasan teks biasa saat menunggu approval harus dijelaskan atau diarahkan, tidak dianggap sebagai approval.
- Simpan status pengiriman Telegram dan deduplikasi outbound berdasarkan message/event ID agar retry/restart tidak menggandakan balasan. Tangani batas panjang pesan Telegram dengan pemotongan yang aman atau pemecahan pesan.
- Pertahankan allowlist chat, deduplikasi update, batas panjang pesan, token hanya di backend, dan notifikasi milestone tanpa spam. Jangan mengirim pesan eksternal yang tidak diminta.
- Uji alur dari pesan Telegram awal sampai proposal, revisi/approval, status kerja, dan hasil akhir menggunakan transport mock; jangan mengirim pesan sungguhan saat pengujian.

### 3. Eksekusi CLI dan batas workspace

- Dukung OpenCode CLI dan Qoder CLI untuk mode text maupun coding. Jangan membatasi kemampuan coding hanya ke Qoder. Periksa binary/versi/help CLI yang benar-benar terpasang dan dokumentasi resmi sebelum memilih argumen, model, mode izin, workspace, dan format output; jangan menebak flag. Implementasikan capability per provider secara eksplisit dan laporkan bila versi CLI tertentu belum mendukung mode yang diminta.
- Model harus dipilih dari katalog provider CLI yang aktif. Sediakan pilihan provider utama dan modelnya; tampilkan ketersediaan serta kemampuan text/coding masing-masing provider. Catat provider/model aktual pada setiap langkah dan artefak.
- Saat OpenCode mencapai kuota/error recoverable, fallback ke Qoder harus memakai model Qoder yang dikonfigurasi dan tersedia. Fallback coding hanya boleh berjalan otomatis bila pemeriksaan diff membuktikan provider pertama belum mengubah workspace. Jika sudah ada perubahan atau statusnya tidak pasti, hentikan dan minta keputusan pengguna; jangan mengulang diam-diam.
- Audit permission dan batas workspace untuk **kedua** CLI. `-w`, working directory, atau permission mode CLI saja tidak boleh diklaim sebagai batas keamanan OS. Batasi akses file dan command secara nyata pada workspace yang diizinkan. Jangan memberi akses `Bash` luas tanpa enforcement allowlist/path/cwd/timeout/output, atau gunakan mekanisme sandbox OS yang tersedia dan terdokumentasi.
- Pastikan langkah `uses_tools` memilih provider coding yang dikonfigurasi/dipilih dan memiliki izin yang sesuai, sedangkan langkah tanpa tools tidak pernah mengklaim telah membuat atau mengubah file.
- Catat diff dan status workspace sebelum/sesudah coding step agar QC serta fallback dapat membedakan perubahan aktual.

### 4. Status tim dan animasi 3D

- Telusuri aliran event dari perubahan DB, `task_events`, SSE, sampai UI dan `OfficeScene`.
- Audit layout yang sudah ada di `frontend/src/features/office/OfficeScene.tsx`, `frontend/src/lib/officeLayout.ts`, serta konfigurasi role/room di backend. Pertahankan ruang yang sudah benar; jangan membuat salinan ruang atau menghapus workstation yang dipakai agen.
- Lengkapi denah kantor 3D sebagai ruang yang terbaca dan memiliki skala konsisten. Ruang minimum: **lobby/ruang tamu/resepsionis**, **Customer Service (CS)**, **programmer/developer**, **server dan database**, **analis/riset**, **desain**, **administrasi/operasional**, **security**, **pantry**, dan **ruang rapat**. Bila denah memungkinkan, pisahkan ruang server dari workstation developer dan beri akses pintu/partisi yang sesuai. Sediakan koridor yang menghubungkan ruang tanpa menembus dinding atau furnitur.
- Gunakan gaya **modern, terang, dominan putih**: dinding putih/off-white, lantai terang yang tidak silau, pencahayaan natural dari jendela, kaca buram/bening untuk partisi, furnitur putih dengan aksen kayu muda dan metal, serta aksen teal/cyan yang terbatas untuk status. Gunakan palet dan material yang konsisten, tetapi beri tiap departemen identitas melalui satu warna aksen lembut, signage, tekstur, dan susunan furnitur yang berbeda. Hindari membuat semua ruang berupa kotak putih identik; hindari pula dominasi navy/ungu gelap, neon berlebihan, dan pencahayaan suram. Pastikan indikator status tetap kontras dan mudah dibaca pada latar terang.
- Buat pencahayaan kantor berlapis dan terlihat: cahaya siang dari jendela, lampu plafon/panel modern, lampu gantung dekoratif di lobby/pantry/ruang rapat, lampu meja kerja, serta pencahayaan aksen lembut pada rak, signage, dan tanaman. Gunakan intensitas/warna cahaya yang hangat-netral dan bayangan yang lembut; hindari satu sumber lampu keras atau glow berlebihan. Lampu dekoratif boleh menjadi ambience, tetapi tidak boleh menyamar sebagai indikator status agen.
- Isi ruang dengan properti yang membuat fungsinya langsung dikenali: resepsionis memiliki meja front desk, sofa, kursi tamu, meja kopi, tanaman dan signage; CS memiliki baris meja kerja, kursi ergonomis, komputer/monitor, headset, sekat meja, dan papan antrean/layar layanan; programmer memiliki workstation multi-monitor dan papan arsitektur; ruang server/database memiliki rack, panel kontrol, pendingin/ventilasi, akses terbatas dan indikator aktivitas; analis/riset memiliki monitor dashboard dan papan data; desain memiliki meja kreatif, layar warna/referensi dan papan ide; security memiliki meja kontrol, beberapa monitor CCTV dan panel akses; pantry memiliki counter, kabinet, kulkas, sink, mesin kopi, meja kecil dan kursi; ruang rapat memiliki meja besar, kursi untuk peserta, layar presentasi besar dan papan tulis.
- Tambahkan dekorasi kantor modern secara lengkap namun tertata: tanaman indoor berbagai ukuran, lampu gantung dan lampu lantai, jam dinding, rak buku/arsip, poster atau karya seni, signage nama ruang, karpet area, panel akustik, tempat sampah, dispenser, vas, buku, mug, dan detail meja kerja. Variasikan bentuk/posisi dekorasi antar ruang agar tidak tampak copy-paste, tetapi jaga hierarki visual, ruang berjalan, dan siluet karakter tetap jelas. Setiap objek dekoratif harus punya konteks dan skala yang masuk akal; hindari ruangan kosong/monoton maupun ruangan penuh clutter.
- Gunakan karakter humanoid lengkap dengan kepala/wajah sederhana, torso, bahu, lengan, siku, tangan, paha, betis, dan kaki. Script saat ini sudah memiliki bentuk anggota tubuh prosedural; audit proporsi, pose, artikulasi, dan keterbacaannya lalu tingkatkan kualitas tanpa menganggap checklist bentuk sebagai karakter realistis. Gunakan model ber-rig/animasi yang lisensinya jelas bila tersedia; jika tetap prosedural, buat proporsi dan artikulasi yang meyakinkan. Pastikan karakter terbaca dari kamera isometrik dan tetap ringan untuk banyak agen.
- Simpan konfigurasi lokasi agen, ruang, workstation, dan titik rapat sebagai data yang konsisten dengan role. Agen harus dapat memiliki task, lokasi saat ini, tujuan perjalanan, serta task/step aktif dari backend; jangan menebak lokasinya hanya dari status umum.
- Tambahkan event domain yang eksplisit untuk assignment, handoff, permintaan bantuan, penerimaan/penyelesaian handoff, perjalanan, mulai/selesai rapat, dan perubahan task. Event mencantumkan actor, penerima/peserta, task/step, asal/tujuan bila relevan, waktu, serta status.
- Buat visualisasi hubungan antartim: saat spesialis menyerahkan artefak ke spesialis berikutnya, tampilkan perpindahan karakter dari workstation asal menuju workstation penerima; saat task perlu diskusi, buat aktivitas rapat dengan peserta dan topik yang tercatat. Karakter tidak boleh berjalan, rapat, atau tampak berdiskusi tanpa event workflow yang memicunya.
- Tampilkan state aktual per agen: klarifikasi/perencanaan, menunggu approval/dependency, bekerja di workstation, melakukan handoff, rapat, QC, selesai, gagal, atau dibatalkan. Tampilkan nama task/step, penerima handoff atau tujuan, serta aktivitas terakhir yang relevan melalui label/indikator yang mudah dibaca.
- Scene 3D harus bereaksi segera pada event SSE dan pulih melalui replay/reconnect. Simpan event secara persisten supaya animasi perjalanan dan handoff bisa diputar ulang setelah reconnect/restart. Jangan memakai gerak acak sebagai bukti pekerjaan; animasi idle dekoratif harus dibedakan jelas dari aktivitas kerja aktual.
- Implementasikan navigasi jalur antarruang, batas kamera, collision/occlusion yang wajar, pemilihan karakter, panel detail, serta fallback performa untuk perangkat lemah. Bila WebGL tidak tersedia, activity log dan task graph harus tetap berfungsi.
- Pertahankan daftar log/percakapan yang dapat dibaca tanpa scene 3D dan safety refresh saat SSE putus.

### 5. Workflow, approval, dan QC

- Validasi plan, role, dependency, kriteria penerimaan, serta versi approval di backend.
- Ganti batas keras maksimum enam langkah dengan task graph dinamis. Tetap gunakan batas keselamatan yang dapat dikonfigurasi (jumlah langkah, kedalaman delegasi, durasi, biaya/token, ukuran artefak, retry, dan jumlah worker), berikan error yang jelas saat batas tercapai, dan jangan memangkas rencana diam-diam.
- Modelkan workflow sebagai DAG persisten dengan subtask yang dapat mendelegasikan pekerjaan lanjutan bila diizinkan. Scheduler harus menjalankan langkah yang dependency-nya selesai dan independen secara paralel sampai batas concurrency yang dikonfigurasi; task yang bergantung harus menunggu hasil upstream.
- Hindari dua coding agent menulis file yang sama secara bersamaan. Gunakan workspace/branch/worktree terisolasi per coding task atau resource/file lock yang terverifikasi, lalu buat tahap integrasi/merge eksplisit. Catat konflik dan minta resolusi bila integrasi otomatis tidak aman.
- Gunakan klaim task atomik/lease agar beberapa worker atau backend restart tidak menjalankan task yang sama dua kali. Simpan state antrean, heartbeat, retry, output, dan event agar worker dapat pulih dengan aman.
- Handoff antaragen harus menjadi data workflow, bukan hanya teks hasil. Penerima melihat artefak/input yang diserahkan dan mengakui atau menolak handoff; status dan visual kantor mengikuti transisi tersebut.
- Tool tidak boleh berjalan sebelum versi rencana yang tepat disetujui. Revisi material membatalkan persetujuan versi lama.
- Jangan menyatakan parent selesai bila step wajib, artefak, atau QC gagal/tidak terbaca. Batasi retry dan simpan temuan, bukti, serta hasil tiap iterasi.
- Pastikan pembatalan menghentikan provider dan proses turunan, bukan hanya mengubah status DB.

### 6. Validasi kolaborasi dan visual

- Tambahkan tes workflow yang membuktikan dua task independen dapat berjalan bersamaan, task dependen baru mulai setelah input tersedia, konflik workspace tidak merusak perubahan, dan hasil integrasi melewati QC.
- Tambahkan tes pemetaan event ke state/lokasi/tujuan karakter. Pastikan replay SSE mempertahankan urutan perjalanan, handoff, dan rapat; jangan menguji WebGL dengan mengandalkan animasi acak.
- Lakukan pemeriksaan visual scene pada viewport desktop dan kecil: semua departemen, karakter humanoid, furnitur, layar besar, jalur gerak, label, serta panel detail harus terlihat dan tidak saling menutupi secara fatal.
- Tinjau visual seluruh kantor sebagai satu komposisi: variasi ruang terasa jelas tetapi tetap satu brand; dominasi putih terlihat bersih (bukan overexposed); lampu/dekorasi memberi kedalaman; tidak ada area besar yang kosong atau repetitif; semua ruang tetap dikenali dari kamera utama.

### 7. Penghentian proses Windows

- Audit `backend/app/tools/procs.py` dan `sandbox_exec.py` terhadap timeout, pembatalan, anak proses, dan handle pipe yang diwariskan pada Windows.
- Periksa apakah fungsi benar-benar menunggu process tree dan pembaca pipe berhenti. Jangan mengembalikan hasil timeout sementara proses turunan masih dapat menulis ke workspace.
- Pertahankan perilaku POSIX dan hindari membunuh process group backend.
- Tambahkan/benahi tes deterministik untuk proses anak, timeout, dan cleanup; tes harus membuktikan EOF/terminasi tree, bukan hanya memeriksa status proses induk.

## Cara kerja

1. Laporkan gap dengan path file dan bukti alur kode sebelum implementasi.
2. Revisi proposal kerja agar langkah yang benar-benar perlu menjalankan command atau mengubah file memakai `uses_tools=true` dan provider coding yang diminta pengguna. Jangan menandai langkah perintah/test sebagai text-only bila ia perlu menjalankan command. Sertakan implementasi coding untuk OpenCode dan Qoder serta fallback OpenCode ke Qoder.
3. Pecah implementasi menjadi tahap yang dapat ditinjau: model data task graph/handoff dan scheduler; layout kantor/departemen dan karakter humanoid; event realtime serta animasi state-driven; lalu integrasi dan QC.
4. Pastikan workspace dan working directory konsisten: bila workspace `backend`, path tes gunakan relatif terhadap `backend`; jangan mencampur root repository dengan subdirektori.
5. Kerjakan dalam perubahan kecil dan aditif. Jangan menyentuh `.env`, menghapus database/artifact pengguna, atau menjalankan aksi eksternal.
6. Tunggu persetujuan versi rencana sebelum perubahan yang direncanakan. Setelah disetujui, implementasikan, jalankan pemeriksaan yang relevan, perbaiki kegagalan, lalu laporkan hasil aktual.

## Laporan akhir

Sertakan gap yang ditutup, file yang berubah, provider/model yang benar-benar dipakai, alur Web dan Telegram yang diverifikasi, hasil QC/tes aktual, risiko yang tersisa, dan langkah menjalankan aplikasi. Jangan mengklaim realtime, sandbox, atau tes lulus tanpa bukti.
