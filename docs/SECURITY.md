# Keamanan dan privasi

## Kontrol yang ada

- Password murid di-hash dengan Argon2id, NISN awal tidak disimpan di kolom profil; seed menyimpan HMAC hash dan nilai masked.
- Username dinormalisasi trim, huruf kecil lokal Indonesia, dan spasi berulang.
- Murid diminta mengganti credential awal sebelum akses form/submission.
- JWT access berlaku 15 menit. Refresh token JWT disimpan sebagai SHA-256 hash di database dan dikirim sebagai cookie HttpOnly, SameSite Strict; logout mencabut token.
- Login murid dibatasi percobaan per IP; Google OAuth dibatasi oleh domain/allowlist yang dikonfigurasi. Email eksplisit pada `ALLOWED_GOOGLE_ADMIN_EMAILS` mendapat role ADMIN.
- CORS membatasi origin, Helmet aktif, body JSON dibatasi 1 MB, route menggunakan Zod, dan handler memeriksa role serta kepemilikan form guru.
- Kunci jawaban dihapus dari schema yang dikirim kepada murid.
- Audit log untuk login, pembuatan/publikasi versi form, submit, perubahan dan rilis nilai.
- Service worker tidak menyimpan API, token, ataupun jawaban pada Cache Storage.

## Wajib sebelum produksi

- Ganti seluruh secret `.env.example`; jangan gunakan fallback Compose.
- Terapkan HTTPS, CSRF strategy tambahan yang diuji untuk deployment lintas origin, allowlist akun admin eksplisit yang ditinjau rutin, kebijakan refresh token dan lockout akun murid.
- Implementasikan validasi dan otorisasi assignment, CRUD/soft-delete dan ekspor murid, MFA/pemulihan akun, retensi data, backup restore test, serta audit UI.
- Terapkan unggah berkas privat dengan signature validation, batas ukuran, malware scanning, signed download URL, dan kebijakan retensi sebelum mengaktifkan file.
- Tambahkan rate-limit terdistribusi, sanitasi log, monitoring tanpa payload sensitif, pengujian penetrasi, serta review perlindungan data anak.

MVP ini belum boleh dipakai untuk menyimpan data murid nyata. Jangan mencatat NISN, password, token, isi jawaban pribadi, maupun isi berkas dalam log. Gunakan data sintetis selama development.

Password Google tidak diminta maupun disimpan aplikasi. Bila password akun Google dibagikan di luar halaman autentikasi Google, segera ubah password tersebut dan tinjau sesi aktif akun.

## Retensi

Sekolah perlu menentukan masa simpan jawaban dan berkas, prosedur ekspor sebelum penghapusan, serta proses pemulihan data. `deletedAt` telah disediakan pada akun/form/murid, tetapi kebijakan purge dan halaman permintaan data belum diimplementasikan.
