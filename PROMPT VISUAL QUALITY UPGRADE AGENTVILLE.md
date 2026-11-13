# AGENTVILLE — VISUAL QUALITY UPGRADE

Bertindaklah sebagai Senior 3D Environment Artist, Game Level Designer, dan Three.js / React Three Fiber Engineer. Kerjakan repository AgentVille yang sudah ada. Jangan membuat mockup atau proyek baru.

## Aturan kerja

- Audit implementasi aktual sebelum mengubah kode. Gunakan bukti source dan render; jangan mengandalkan klaim dokumentasi lama.
- Pertahankan struktur aplikasi, sistem agen, data status, percakapan, event aktivitas, pemilihan agen, panel detail, dan integrasi backend.
- Jangan membaca atau mencetak `.env`, token, kredensial, atau rahasia.
- Jangan mengubah AI orchestration, Telegram, approval, scheduler proyek, atau data landing page kecuali perbaikan QC yang dijelaskan khusus di bagian **Perbaikan kegagalan QC sebelumnya**.
- Jangan menghapus atau menimpa data, artefak, workspace, maupun file pengguna. Perubahan harus kecil, aditif, dan dapat ditinjau.
- Jangan menyatakan render, build, tes, atau QC berhasil tanpa menjalankannya dan memeriksa hasil aktual.

## Tahap 0 — Perbaiki kegagalan QC dari request landing page

Sebelum menyatakan pekerjaan AgentVille sebelumnya selesai, audit ulang kegagalan berikut berdasarkan state repository/database saat ini. ID berikut adalah petunjuk untuk menemukan rekaman, bukan asumsi bahwa datanya belum berubah:

- Conversation 3 / anchor task 11 pernah gagal pada QC akhir meskipun task QA 16 berstatus completed.
- QC review mencatat verdict `inconclusive` / `no readable verdict`.
- Bukti QC menunjukkan Reviewer mencoba membaca `backend/landing/index.html`, `backend/landing/script.js`, dan `backend/LAPORAN-QC.md`; artefak sebenarnya berada di `data/workspace/project-11/landing/` dan `data/workspace/project-11/LAPORAN-QC.md`.
- QA task melaporkan 50 pemeriksaan lulus dan tiga cacat diperbaiki, tetapi laporan itu belum diterima sebagai verdict QC akhir oleh orchestrator.

Lakukan langkah berikut:

1. Verifikasi status task, workspace yang terpasang, path artefak, laporan QA, diff, dan hasil QC terkini. Jangan membuka `.env`.
2. Telusuri `backend/app/orchestrator.py` pada fase QC, resolusi workspace, prompt Reviewer, konfigurasi persona/provider QC, parsing verdict, serta pencatatan `QcReview`.
3. Pastikan Reviewer menerima konteks workspace yang benar dan dapat meninjau artefak yang benar-benar tersedia. Pilih salah satu mekanisme yang konsisten dengan arsitektur: berikan bukti/diff yang dibaca orchestrator ke Reviewer dalam mode text-only, atau jalankan Reviewer dengan akses tool yang memang diizinkan dan working directory/workspace yang benar. Jangan menyuruh persona text-only menggunakan tool atau mengarang hasil pembacaan file.
4. Tetapkan format verdict terstruktur yang tervalidasi (misalnya `pass`/`fail`, temuan, bukti, dan artefak yang diperiksa). Jika respons tidak valid atau tidak terbaca, simpan error diagnostik yang spesifik dan pertahankan status gagal; jangan mengubahnya menjadi pass secara default.
5. Tambahkan atau perbaiki pemeriksaan deterministik untuk memastikan prompt QC memakai path workspace yang benar, respons verdict yang invalid ditolak, dan verdict valid dipetakan ke state yang tepat. Gunakan mock provider; jangan mengirim pesan eksternal.
6. Jika kode sudah diperbaiki dan artefak lama masih dapat diverifikasi, jalankan ulang QC secara resmi pada workspace yang benar melalui jalur aplikasi. Jangan mengubah status historis secara langsung di database dan jangan mengedit landing page sebagai bagian dari tahap ini. Jika rerun resmi tidak tersedia, jelaskan endpoint/state transition yang kurang dan laporkan task lama tetap gagal.

Laporkan akar penyebab yang terkonfirmasi, file yang diubah, bukti validasi, dan status akhir sebenarnya. Jangan menyebut landing page selesai secara end-to-end bila QC resmi masih gagal.

## Tujuan visual

Tingkatkan kualitas visual AgentVille yang ada agar mendekati game simulasi manajemen kantor dengan gaya stylized isometric 3D yang kaya detail, hangat, dan profesional. Gunakan screenshot referensi yang tersedia sebagai acuan kualitas dan komposisi, bukan untuk menyalin persis. Jika screenshot tidak tersedia di konteks kerja agen, catat keterbatasan itu dan gunakan brief visual tertulis; jangan mengarang bahwa screenshot telah diperiksa.

## Tahap A — Audit scene dan laporkan temuan

Periksa implementasi scene, layout ruangan, kamera, pencahayaan, material, karakter, CSS canvas, dan aset yang sudah tersedia. Temukan file aktual terlebih dahulu; setidaknya periksa bila tersedia:

- `frontend/src/features/office/OfficeScene.tsx`
- `frontend/src/lib/officeLayout.ts`
- komponen `Structure`, `RoomFitout`, `Lighting`, `Furniture`, dan `AgentFigure`
- `frontend/src/App.tsx`, CSS scene, dan komponen pemilih/detail agen
- `backend/app/rooms.py` hanya untuk memahami pemetaan lokasi yang dipakai scene

Catat akar penyebab visual dengan path dan bukti: skala/framing, material, pencahayaan/shadow, overlap/occlusion, arah kursi dan workstation, pose karakter, serta jalur gerak. Bedakan masalah source dari masalah yang hanya terlihat saat render.

Sebelum implementasi, laporkan:

1. Temuan audit aktual dan bukti.
2. File yang akan disentuh.
3. Urutan perubahan dan cara verifikasinya.
4. Risiko teknis/performa.

Setelah rencana tersebut ditinjau/disetujui pengguna, lanjutkan pekerjaan. Jangan berhenti pada audit saja.

## Tahap B — Komposisi kamera dan tata ruang

- Optimalkan target, sudut, zoom, dan framing isometrik supaya seluruh kantor dapat dibaca dan detail utama tetap terlihat.
- Kurangi ruang kosong yang tidak membantu komposisi tanpa mengorbankan jalur gerak, jarak furnitur, atau area interaksi.
- Pastikan batas ruangan dan sepuluh departemen yang sudah ada terbaca dari kamera utama.
- Periksa pintu, koridor, workstation, furnitur, waypoint, dan ukuran karakter dalam skala yang sama.
- Pertahankan navigasi kamera yang berfungsi, termasuk mode Explore; jangan mengklaim first-person walking atau collision bila tidak benar-benar tersedia.
- Jangan memindahkan/menghapus ID ruang, workstation, atau titik yang digunakan backend. Sinkronkan data layout dan pemetaan role hanya bila ditemukan ketidakcocokan nyata.

## Tahap C — Geometri, aset, material, dan pencahayaan

- Tingkatkan furnitur dengan proporsi yang konsisten: meja, kursi ergonomis, monitor, keyboard, rak, sofa, tanaman, pintu, kaca, dan partisi.
- Beri tiap departemen identitas visual yang berbeda dalam satu bahasa desain. Gunakan warm white, light oak, natural green, charcoal, serta teal sebagai aksen.
- Variasikan material kayu, kaca, logam, kain, dan lantai. Hindari objek polos tanpa material, dominasi putih yang overexposed, dan abu-abu datar.
- Seimbangkan ambient dan directional light; gunakan bayangan lembut dengan biaya render wajar. Tambahkan ambient occlusion hanya jika pipeline yang sudah ada mendukungnya dengan efisien.
- Tambahkan dekorasi secara tertata dan kontekstual. Jangan menutup pintu, jalur berjalan, siluet karakter, atau klik/pemilihan agen.
- Gunakan ulang geometri/material identik. Pertimbangkan instancing untuk objek berulang bila benar-benar menurunkan biaya render.
- Hindari dependency besar baru tanpa alasan teknis yang dibuktikan.

## Tahap D — Karakter dan aktivitas

- Audit orientasi tubuh, kepala, tangan, kaki, arah pandang, pose duduk, dan hubungan karakter terhadap workstation.
- Pastikan setiap kursi menghadap meja/monitor. Samakan transformasi meja, monitor, keyboard, kursi, dan karakter untuk setiap orientasi ruang; jangan hanya mengoreksi satu zona.
- Saat agen berstatus bekerja di workstation, pose harus menempatkan lengan dan tangan di area keyboard/meja dan terbaca dari kamera isometrik. Tingkatkan animasi mengetik seperlunya, tetapi tetap dipicu oleh status kerja yang nyata.
- Pose membaca layar, berdiri, handoff, berjalan, dan rapat harus sesuai event/status aktual. Jangan menambahkan aktivitas palsu atau gerak acak untuk memberi kesan sibuk.
- Pertahankan pemilihan agen, label, status, event motion, dan panel detail.

## Tahap E — Performa, build, dan pemeriksaan render

- Gunakan reuse geometri/material; batasi draw calls, shadow map, dan sumber cahaya. Pastikan perangkat dengan kemampuan lebih rendah tetap memiliki fallback yang layak.
- Jalankan build frontend dan perbaiki error TypeScript/build yang muncul.
- Jalankan aplikasi dan periksa render nyata pada viewport desktop serta ukuran kecil. Periksa error console dan interaksi pemilihan agen/kamera.
- Ambil screenshot sebelum/sesudah bila aplikasi dan alat tersedia. Nilai skala, framing, material, bayangan, overlap, keterbacaan karakter, pose tangan, arah kursi, dan fungsi ruang.
- Jika browser/render tidak dapat dijalankan, laporkan batas verifikasi dan jangan menyatakan visual telah lulus.

## Kriteria penerimaan visual

- Kantor tampak sebagai lingkungan simulasi yang dirancang utuh, hangat, dan profesional; bukan kumpulan kotak atau placeholder besar.
- Sepuluh departemen mudah dibedakan dan komposisi isometrik terbaca.
- Ruangan, furnitur, dan karakter memiliki proporsi yang konsisten; kursi menghadap workstation dan tangan karakter bekerja di area meja.
- Pencahayaan dan bayangan memperjelas volume objek tanpa membuat ruangan gelap atau overexposed.
- Aktivitas karakter tetap sesuai status/event backend yang sebenarnya.
- Pemilihan agen, panel detail, status, event, navigasi kamera, dan fallback UI tetap berfungsi.
- Build, console, serta render yang benar-benar diperiksa dilaporkan dengan hasil aktual.

## Batas perubahan

- Jangan membuat ulang proyek atau mengganti stack tanpa alasan kuat.
- Jangan mengubah workflow AI, Telegram, approval, scheduler, atau eksekusi agen di luar perbaikan QC yang didefinisikan pada Tahap 0.
- Jangan mengubah file landing page atau artefak pengguna saat memperbaiki QC.
- Jangan membuat klaim lulus berdasarkan perubahan kode saja.

## Laporan akhir

Laporkan secara ringkas:

1. Akar penyebab kegagalan QC sebelumnya dan perbaikannya, atau alasan rerun QC belum dapat dilakukan.
2. Akar penyebab visual yang ditemukan.
3. File yang diubah dan alasan perubahan.
4. Provider/model yang benar-benar dipakai bila pekerjaan dijalankan melalui AgentVille.
5. Hasil build, tes, console, dan render yang benar-benar diperiksa.
6. Status QC/landing page setelah perbaikan; jangan menyamakan QA task dengan QC akhir.
7. Risiko dan bagian yang belum selesai.
