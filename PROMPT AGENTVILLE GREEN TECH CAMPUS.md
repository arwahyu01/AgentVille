# AGENTVILLE — GREEN TECH CAMPUS & VISUAL DESIGN

## Peran

Bertindak sebagai Senior 3D Environment Artist, Game Level Designer, dan Three.js / React Three Fiber Engineer. Tingkatkan repository AgentVille yang sudah ada menjadi simulasi kantor bergaya stylized isometric 3D yang kaya detail, hangat, profesional, dan terhubung dengan kawasan Green Tech Campus yang dapat dijelajahi.

Ini adalah pengembangan proyek yang sudah ada. Jangan membuat mockup, proyek baru, atau mengganti stack tanpa alasan teknis yang kuat.

## Tujuan desain

Bangun pengalaman visual terpadu yang menjadikan kantor AgentVille sebagai pusat aktivitas di dalam kampus teknologi hijau. Kantor, plaza, jalan, taman, sungai, jembatan, kafe, bangunan pendukung, dan lanskap jauh harus memiliki skala dan gaya yang konsisten.

Gunakan screenshot referensi yang tersedia sebagai acuan komposisi dan kualitas, bukan untuk menyalin desain persis. Jika screenshot tidak tersedia di konteks kerja, catat keterbatasan itu dan gunakan brief tertulis; jangan mengklaim telah memeriksa gambar.

## Batas scope

- Fokus pada desain 3D interior dan eksterior, denah, geometri, furnitur, material, pencahayaan, dekorasi, karakter, kamera, navigasi, collision, transisi pintu, CSS scene, performa, dan integrasi visual yang diperlukan.
- Pertahankan struktur aplikasi, scene kantor yang sudah berfungsi, seluruh departemen, status agen, event-driven motion, pemilihan agen, panel detail, UI, dan fallback tanpa WebGL.
- Jangan mengubah AI orchestration, percakapan, Telegram, approval, scheduler task proyek, proses coding agent, atau sistem operasional Housekeeping/Security. Pertahankan aktivitas operasional yang sudah ada dan tampilkan hanya berdasarkan status/event sumbernya.
- Perubahan backend dilarang, kecuali penyesuaian pemetaan room/lokasi yang terbukti wajib untuk konsistensi navigasi dan visual. Jelaskan kebutuhan dan buktinya sebelum mengubahnya.
- Jangan membaca atau mencetak `.env`, token, kredensial, atau rahasia. Jangan menghapus, memindah, atau menimpa file/artifact pengguna.
- Jangan menambah animasi acak yang menyiratkan agen sedang bekerja.

## Tahap 0 — Audit aktual dan rencana

Sebelum mengubah kode, audit struktur repository dan jalankan aplikasi bila memungkinkan. Temukan implementasi aktual untuk:

- Scene, layout, kamera, pencahayaan, material, karakter, navigasi, dan CSS canvas.
- Sepuluh departemen, posisi workstation, bukaan pintu, koridor, dan pemetaan lokasi yang digunakan scene.
- Status/event agen, pemilihan agen, panel detail, serta kontrol kamera yang harus dipertahankan.
- Versi Three.js, React Three Fiber, Drei, dan dependency visual yang terpasang.

Periksa sekurangnya file yang tersedia seperti `frontend/src/features/office/OfficeScene.tsx`, `frontend/src/lib/officeLayout.ts`, `frontend/src/App.tsx`, `frontend/src/types.ts`, CSS scene, dan `backend/app/rooms.py`. Jangan mengasumsikan nama file, teknologi, atau perilaku sebelum menelusuri implementasinya.

Laporkan akar masalah visual dengan path dan bukti aktual, daftar file yang direncanakan, tahapan, cara verifikasi, dependency baru bila ada, serta risiko kompatibilitas. Tunggu persetujuan atas rencana sebelum mengubah kode.

## Tahap 1 — Audit dan revisi denah kantor: prasyarat kritis

Sebelum membuat plaza atau pintu eksterior, tentukan arah depan gedung dari koordinat dan rotasi aktual. Audit:

- Posisi dan orientasi bangunan serta pintu masuk/keluar.
- Hubungan pintu utama dengan lobby dan resepsionis.
- Jalur tamu dari pintu ke resepsionis dan dari lobby ke koridor utama.
- Posisi dinding, bukaan, partisi, furnitur, koridor, dan titik spawn Explore.

Pastikan pintu utama membuka langsung ke lobby; resepsionis terlihat dari pintu; area tunggu tidak menghalangi; koridor mudah dipahami dan dapat dilewati. Jika ada masalah, revisi geometri/denah yang terbukti salah secara terencana. Jangan menyamarkan masalah dengan memutar kamera saja. Pertahankan ruang/workstation yang masih benar dan ubah hanya bagian yang diperlukan.

Kantor mempertahankan sepuluh zona yang sudah ada:

1. Lobby, ruang tamu, dan resepsionis.
2. Customer Service.
3. Programmer/Developer.
4. Server/Database.
5. Analyst/Research.
6. Design Studio.
7. Administration/Operations.
8. Security Control.
9. Pantry.
10. Meeting Room.

Pastikan pintu setiap ruang bisa dicapai, koridor tidak terputus, sekat kaca/dinding konsisten, dan furnitur tidak bertumpuk atau menutup jalur. Dokumentasikan orientasi depan, denah sebelum/sesudah, posisi pintu dan lobby, serta jalur masuk. Jangan lanjutkan plaza sebelum hubungan pintu–lobby terverifikasi.

## Tahap 2 — Tingkatkan desain interior kantor

Bangun interior stylized 3D yang kaya detail, hangat, dan profesional, bukan deretan kotak warna.

- Gunakan palet warm white/off-white, light oak, natural green, charcoal, abu-abu batu, kaca, metal, dan aksen teal.
- Tingkatkan proporsi dan detail meja, kursi ergonomis, monitor/stand, keyboard, mouse, rak, sofa, tanaman, pintu, partisi, serta layar besar.
- Bedakan departemen melalui susunan, signage, aksen lembut, tekstur lantai, karpet, dan panel akustik sambil mempertahankan satu bahasa desain.
- Perbaiki material dan pencahayaan: cahaya ambient/directional seimbang, daylight, lampu ruang, dan bayangan lembut. Gunakan ambient occlusion atau material PBR hanya jika pipeline yang ada mendukungnya secara efisien.
- Hindari permukaan datar tanpa material, warna putih yang overexposed, ruangan suram, dekorasi berlebihan, dan objek yang menghalangi karakter atau jalur.
- Periksa orientasi meja, monitor, keyboard, kursi, dan karakter dalam transformasi lokal tiap zona. Setiap kursi workstation harus menghadap layar.
- Pose kerja harus meletakkan lengan dan tangan di area keyboard/meja dengan jelas dari kamera utama. Animasi mengetik hanya ketika status backend menyatakan agen benar-benar bekerja. Pose rapat, handoff, berjalan, Housekeeping, dan Security tetap mengikuti event/status aktual.
- Pertahankan identitas dan jumlah agen yang ada; jangan mengganti data backend dengan dummy atau membuat agen duplikat.

## Tahap 3 — Blockout Green Tech Campus

Bangun satu kawasan kompak dengan batas jelas dan geometri 3D nyata, bukan backdrop datar atau dunia tak terbatas. Kantor pusat tetap menjadi landmark dan fokus utama.

### A. Headquarters plaza dan entrance

- Plaza di sisi fasad depan yang benar-benar terhubung dengan pintu utama.
- Pintu mudah ditemukan, kanopi, signage AgentVille, drop-off sederhana, planter, bangku, lampu jalan, dan jalur pedestrian yang berakhir tepat di pintu.
- Sinkronkan orientasi eksterior dengan denah interior dan arah masuk lobby.

### B. Jalan dan pedestrian network

- Jalan kendaraan dan trotoar terpisah jelas, persimpangan masuk akal, marka jalan/penyeberangan, batas kawasan, serta jalur ke kantor, taman, kafe, dan riverwalk.
- Jangan membuat jalur menembus bangunan, pohon, sungai, atau objek solid; hindari jalan yang berakhir tiba-tiba.

### C. Green Park

- Pepohonan bervariasi, rumput, semak, bunga, bebatuan, planter, bangku, lampu pedestrian, jalur melengkung ringan, dan ruang terbuka.
- Atur vegetasi secara berkelompok dan alami; jangan menutup jalan, pintu, atau pandangan ke landmark.

### D. Riverwalk, sungai, jembatan, dan air terjun

- Sungai dengan bentuk/lebar konsisten, tepian bertransisi ke rumput dan batu, jalur tepi sungai, jembatan pedestrian, serta air terjun bila anggaran performa memungkinkan.
- Air harus memiliki gerak/material stylized yang meyakinkan, bukan balok biru statis. Hindari simulasi cairan berat.
- Navigasi mencegah pemain berjalan di atas air, jatuh melewati tepian, atau terjebak pada jembatan.

### E. Innovation District

- Tambahkan beberapa bangunan pendukung, misalnya Innovation Lab, AI Research Building, Creative Studio, dan Collaboration Hub, dengan variasi fasad/material.
- Bangunan yang interiornya belum dibangun harus tertutup/dekoratif dan tidak menampilkan interaksi masuk.

### F. Kafe dan area sosial

- Kafe outdoor dengan meja/kursi, pergola atau kanopi, planter, area duduk, dan jalur akses yang jelas. Jangan menambahkan perilaku agen yang tidak didukung status/event.

### G. Parkir dan mobilitas hijau

- Area parkir proporsional, kanopi panel surya, stasiun pengisian EV, rak sepeda, marka, pembatas, dan jalur pedestrian ke kantor.
- Kendaraan statis sebagai aset dekoratif kecuali sistem kendaraan bergerak benar-benar tersedia.

### H. Lanskap jauh

- Bukit dan pegunungan berlapis dengan variasi elevasi, vegetasi yang sesuai, warna atmosferik, dan kabut ringan bila mendukung kedalaman visual.
- Jangan menyebut pegunungan sebagai area yang dapat dijelajahi tanpa geometri dan navigasi yang mendukungnya.

Mulai dengan blockout sederhana untuk memeriksa skala, sirkulasi, dan komposisi. Lanjutkan detail art setelah blockout lolos pemeriksaan render.

## Tahap 4 — Kamera, Explore, navigasi, dan transisi

Audit kontrol yang sudah tersedia. Pertahankan orbit/zoom yang berfungsi. Sediakan tiga mode yang memiliki tujuan jelas tanpa merender dua dunia duplikat atau mengatur ulang state agen:

- **Campus View / World View:** orbit, pan, dan zoom untuk melihat kawasan dan hubungan antar-zona.
- **Office View:** kamera interior yang mempertahankan kontrol kantor, pemilihan agen, dan panel detail.
- **Explore:** first-person untuk berjalan di kawasan dan masuk/keluar kantor melalui pintu yang benar.

Perpindahan mode harus menjaga state agen dan tidak menggandakan renderer, karakter, atau listener event.

Jika Explore saat ini hanya orbit kamera, jangan menyebutnya first-person. Untuk memenuhi Explore orang pertama, implementasikan kontrol nyata:

- WASD untuk gerak, mouse look melalui Pointer Lock yang diminta setelah interaksi pengguna, Shift untuk berlari, Escape untuk melepas pointer lock, dan kontrol keluar yang terlihat.
- Gerak horizontal relatif pada arah kamera, delta time, normalisasi diagonal, batas sudut vertikal, penanganan kehilangan fokus, serta fallback perangkat tanpa keyboard/mouse.
- Grounding dan collision sederhana yang stabil pada dinding, bangunan, pohon besar, pembatas sungai, dan objek solid penting. Pintu/koridor yang dirancang untuk dilewati harus terbuka dan cukup lebar.
- Jangan menambahkan engine physics besar sebelum membuktikan collider sederhana tidak mencukupi.

Transisi kantor harus konsisten:

1. Pengguna mendekati pintu utama dari plaza.
2. Petunjuk interaksi muncul jika sistem mendukungnya.
3. Pengguna masuk melalui pintu aktual, bukan pintu dekoratif lain.
4. Titik spawn berada di lobby, tidak di dalam dinding atau di belakang resepsionis.
5. Kamera/kontrol menyesuaikan ke interior tanpa mereset status, event, pemilihan agen, atau menggandakan renderer/karakter.
6. Pengguna dapat kembali ke luar melalui pintu yang benar.

Jika arsitektur sekarang tidak memungkinkan transisi seamless, pilih transisi mode/scene yang paling aman, pertahankan state aplikasi, dan dokumentasikan batasannya. Jangan mengklaim navigasi bebas, collision, atau transisi berfungsi sebelum benar-benar diuji.

## Tahap 5 — Implementasi modular dan performa

Pisahkan geometri lingkungan, interior, pencahayaan, kamera, navigasi, collision, dan interaksi sesuai pola repository. Nama komponen dapat mengikuti konvensi yang ada; jangan membuat satu komponen raksasa atau abstraksi yang tidak diperlukan.

- Gunakan kembali geometry/material; pertimbangkan InstancedMesh untuk objek berulang.
- Batasi draw calls, shadow maps, sumber cahaya berbayang, dan kalkulasi `useFrame` per objek.
- Gunakan frustum culling/LOD bila jumlah objek membuatnya perlu.
- Hindari membuat material baru pada setiap render dan bersihkan listener/resource saat scene dilepas.
- Jangan menambah dependency sebelum mengevaluasi kemampuan teknologi yang sudah terpasang.
- Sediakan pesan bila WebGL tidak tersedia; aktivitas, status, dan panel UI tetap dapat digunakan tanpa scene.

## Urutan pelaksanaan dan verifikasi

Kerjakan satu tahap pada satu waktu dan periksa hasil aktual sebelum lanjut:

1. Audit source dan dokumentasikan kondisi awal serta rencana.
2. Verifikasi/revisi denah kantor, orientasi entrance, lobby, koridor, dan spawn.
3. Tingkatkan interior, workstation, pencahayaan, material, karakter, dan komposisi kamera.
4. Buat blockout kampus luar dan verifikasi plaza terhubung dengan pintu utama.
5. Selesaikan detail lingkungan: jalan, taman, sungai/jembatan, bangunan pendukung, kafe, parkir, dan pegunungan.
6. Implementasikan/perbaiki Explore, collision, dan transisi hanya setelah layout geometri stabil.
7. Jalankan build frontend, periksa TypeScript dan console, lalu periksa render desktop dan viewport kecil.
8. Uji kamera isometrik, setiap jalur utama, pintu, collision, transisi plaza–lobby, pemilihan agen, panel detail, dan status aktivitas. Ambil screenshot aktual sebelum/sesudah bila alat tersedia.
9. Ukur dampak performa secara praktis. Perbaiki overlap, objek terhalang, frame drop, dan kesalahan navigasi sebelum menyatakan selesai.

Jangan menguji transisi dengan simulasi yang hanya memindahkan kamera tanpa hubungan geometri pintu yang benar. Jangan menyatakan QC lulus hanya berdasarkan perubahan source.

## Kriteria penerimaan

- Denah kantor dan arah pintu masuk benar; lobby dan resepsionis langsung terbaca dari entrance.
- Interior modern dan detailnya meningkat, komposisi isometrik terbaca, skala furnitur/karakter konsisten, kursi menghadap monitor, dan pose tangan sesuai workstation.
- Kampus luar merupakan lingkungan 3D yang koheren, dengan kantor sebagai pusat, jalur pedestrian tersambung, area hijau, riverwalk/jembatan, serta landmark yang proporsional.
- Tidak ada placeholder besar yang tak disengaja, objek melayang/bertumpuk fatal, atau dekorasi yang menghalangi sirkulasi.
- Explore benar-benar berjalan dan bertabrakan dengan objek penting bila fitur itu dinyatakan selesai.
- Interior, pemilihan agen, status backend, event-driven animation, UI, dan fallback tanpa WebGL tetap berfungsi.
- Build, console, render, pengujian navigasi, serta batas yang belum selesai dilaporkan berdasarkan hasil aktual.

## Laporan akhir

Laporkan:

1. Temuan audit awal dan akar penyebab visual.
2. File yang diubah beserta alasan.
3. Perubahan denah entrance/lobby dan hubungan dengan plaza.
4. Zona kampus dan fitur yang benar-benar dibangun.
5. Mode kamera, collision, navigasi, dan transisi yang benar-benar diuji.
6. Hasil build, console, pemeriksaan render, dan dampak performa.
7. Fitur/bagian yang masih placeholder atau belum dapat diverifikasi.

Jangan menyebut kawasan “open world” jika area yang dapat dijelajahi masih terbatas. Jangan menyatakan fitur selesai tanpa bukti pengujian aktual.
