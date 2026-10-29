# Deployment

## Docker Compose lokal

Compose menjalankan PostgreSQL, API, dan web. MinIO tersedia dengan profile `storage`. Compose dimaksudkan untuk pengembangan/staging; secret default bukan untuk produksi. Gunakan `.env` lokal yang tidak dicommit, buat migration, lalu `docker compose up --build`.

## Frontend Vercel

Deploy `apps/web` sebagai Next.js app dengan root directory workspace atau konfigurasi monorepo yang setara. Set `NEXT_PUBLIC_API_URL` ke API HTTPS publik. Pastikan API mengizinkan origin website Vercel. Cookie refresh memakai `Secure` dan `SameSite=None` di production agar dapat dipakai lintas origin; endpoint refresh memverifikasi header Origin secara tepat. Uji kebijakan cookie pihak ketiga dan CSRF khusus pada domain deployment sebelum produksi.

## API dan PostgreSQL

Bangun image `apps/api/Dockerfile` dari root monorepo. Set `DATABASE_URL`, secret JWT berbeda, `NISN_HASH_SECRET`, domain/allowlist Google dan URL callback HTTPS. Jalankan `prisma migrate deploy` sebagai langkah release satu kali, bukan bersamaan dari banyak replika. Sediakan PostgreSQL managed dengan backup dan restore berkala. Endpoint `/api/v1/health` memeriksa konektivitas database dan mengembalikan HTTP 503 jika database tidak siap, sehingga dapat dipakai sebagai readiness probe.

## PWA

PWA instalasi memerlukan HTTPS, kecuali localhost. Pastikan service worker, manifest, dan ikon dapat diakses tanpa autentikasi. Jangan mengaktifkan caching proxy pada jalur API sensitif. Set CSP/headers dan domain cookie sesuai deployment.

## Penyimpanan berkas

MinIO hanya disediakan untuk development; belum ada adapter object storage atau signed URL pada API. Untuk produksi pilih S3-compatible storage privat, bucket tanpa akses publik, lifecycle retention, enkripsi, dan download yang melalui otorisasi aplikasi.
