# Sistem Formulir, Kuis, dan Penilaian SDN 268 Panyileukan

Monorepo TypeScript untuk portal sekolah. Implementasi saat ini adalah MVP full-stack yang berjalan dengan Next.js, Express, PostgreSQL/Prisma, login Google untuk staf, login murid, pembuatan formulir sederhana, submit idempoten, penilaian awal, serta draft offline berbasis IndexedDB.

## Struktur folder

```text
apps/
  api/                  Express REST API, Prisma schema, seed, Dockerfile
  web/                  Next.js App Router, UI Indonesia, Dexie, PWA
packages/
  shared/               Zod schema, tipe, helper normalisasi dan penilaian
docs/                   Arsitektur, ERD, API, keamanan, offline, deployment
docker-compose.yml
package.json            npm workspaces
```

## Status fitur

Berfungsi pada MVP: autentikasi murid dengan hash Argon2id dan ganti sandi awal, Google OAuth staf jika dikonfigurasi, autentikasi JWT/cookie refresh, role check untuk endpoint inti, administrasi murid via API dan UI admin (pencarian/filter/pagination, tambah/edit, soft delete/restore individual dan massal, template/impor/ekspor XLSX), NISN masked serta HMAC untuk duplikasi, builder form dasar, versi form, publish, draft offline, antrean submission idempoten, auto-grading dasar, penilaian manual dengan riwayat, PWA shell dan health check.

Belum diimplementasikan: parser DOCX/XLSX untuk soal formulir, assignment filtering pada daftar form murid, matriks dinamis, upload/object storage, konflik multi-perangkat, audit UI, tampilan daftar submission/nilai guru, ekspor hasil, test browser Playwright, dan penyelesaian/lockout akun produksi. Format impor data murid dijelaskan di [docs/IMPORT_FORMAT.md](./docs/IMPORT_FORMAT.md). Lihat [docs/API.md](./docs/API.md) dan [docs/SECURITY.md](./docs/SECURITY.md). Jangan gunakan data produksi sebelum kontrol tersebut dibuat dan diuji.

## Prasyarat

- Node.js 20.11 atau lebih baru
- npm 10+
- Docker Desktop (atau PostgreSQL 16 lokal)
- Kredensial OAuth Google hanya jika login staf digunakan

## Menjalankan secara lokal

```powershell
Copy-Item .env.example .env
```

Ganti semua secret placeholder di `.env` dengan nilai acak yang berbeda (minimal 32 karakter). Jalankan PostgreSQL:

```powershell
docker compose up -d db
npm install
npm run db:dev --workspace @sdn268/api -- --name init
npm run db:seed
npm run dev
```

Aplikasi tersedia pada satu alamat tetap, `http://localhost:3000`. Frontend menerima koneksi browser pada port 3000 dan meneruskan request `/api/*` ke API lokal di port 4001. Frontend juga bind ke `0.0.0.0`, sehingga perangkat lain pada jaringan yang sama dapat mengaksesnya melalui alamat IP komputer ini, misalnya `http://192.168.x.x:3000`. Port 3000 harus tersedia; aplikasi tidak berpindah otomatis ke port lain. Health check: `http://localhost:3000/api/v1/health`.

Jika Docker tidak tersedia dan menggunakan PostgreSQL 18 lokal di Windows, cluster development terpisah dapat dijalankan pada port `5432`. Pada workstation ini datanya berada di `%LOCALAPPDATA%\SDN268\form-app-postgres`; kredensialnya hanya tersimpan di `apps/api/.env`. Setelah Windows dimulai ulang, jalankan cluster dengan:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" -D "$env:LOCALAPPDATA\SDN268\form-app-postgres" -l "$env:LOCALAPPDATA\SDN268\form-app-postgres.log" start
```

Cluster ini hanya menerima koneksi dari komputer lokal dan menggunakan autentikasi SCRAM. Setelah database aktif, `npm run dev` menjalankan API dan frontend.

Seed memakai nama sintetis dan NISN dummy; tidak ada data murid nyata. Login Google development memakai akun yang terdaftar pada `AllowedGoogleAccount` dan OAuth harus sudah dikonfigurasi. Untuk murid, username berbentuk `nama murid kelas` (contoh `aditya pratama 4a`); kata sandi awal adalah NISN sintetis yang dibuat seed dan wajib diganti. NISN dummy dapat diketahui dari kode seed; jangan gunakan seed ini sebagai kredensial nyata.

## Google OAuth

1. Buat OAuth client pada Google Cloud Console.
2. Daftarkan callback `http://localhost:3000/api/v1/auth/google/callback`.
3. Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`, dan `ALLOWED_GOOGLE_DOMAINS`.
4. Akun admin tertentu dapat diizinkan melalui `ALLOWED_GOOGLE_ADMIN_EMAILS`, dipisahkan koma. Untuk lokal, atur pada `apps/api/.env` (file ini diabaikan Git); untuk produksi, atur melalui secret/configuration store deployment.
5. Untuk produksi, gunakan HTTPS pada callback dan web, batasi domain pada domain sekolah resmi, dan gunakan allowlist `AllowedGoogleAccount` untuk role admin.

Login Google ditolak bila email tidak cocok dengan domain yang dikonfigurasi, allowlist database, atau `ALLOWED_GOOGLE_ADMIN_EMAILS`. Email di `ALLOWED_GOOGLE_ADMIN_EMAILS` mendapat role ADMIN saat login Google. Role dari allowlist database menjadi sumber utama jika email sudah tercatat di sana. Akun baru dari domain yang diizinkan mendapat role TEACHER. Password Google tidak dipakai oleh aplikasi; autentikasi tetap dilakukan di Google.

### Login kata sandi admin untuk development lokal

Mode development menyediakan login lokal khusus untuk admin yang emailnya sudah ada di `ALLOWED_GOOGLE_ADMIN_EMAILS`. Login ini tidak tersedia di production. Atur hash Argon2id tanpa menyimpan kata sandi sebagai teks biasa:

```powershell
npm run setup:local-admin --workspace @sdn268/api
```

Masukkan kata sandi saat diminta di terminal (karakter tidak ditampilkan), lalu mulai ulang API. Hash tersimpan hanya di `apps/api/.env`; jangan commit atau membagikan file tersebut. Pada halaman login lokal, gunakan email allowlist dan kata sandi yang baru dimasukkan. Ini hanya fallback untuk development; gunakan Google OAuth untuk deployment.

## Object storage lokal

MinIO opsional tersedia melalui Docker Compose:

```powershell
docker compose --profile storage up -d minio
```

Endpoint console lokal: `http://localhost:9001`. Aplikasi MVP belum mengirim file ke MinIO; konfigurasi ini belum berarti unggah file sudah aktif.

## Pemeriksaan

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

Playwright perlu konfigurasi browser/test sebelum suite E2E dapat dijalankan. Unit test shared dan integration smoke test API tersedia. Prisma client dibuat saat `npm install`; migrasi awal harus dibuat dengan `prisma migrate dev` sebelum `migrate deploy` digunakan di lingkungan deployment.

## Menguji mode offline

1. Login saat online, buka halaman formulir murid agar data formulir masuk ke IndexedDB.
2. Di DevTools, pilih Network → Offline.
3. Buka formulir cache dan ubah jawaban. Status UI menyebut jawaban tersimpan di perangkat.
4. Tekan kirim saat offline; UI akan menyatakan menunggu koneksi, bukan terkirim.
5. Kembalikan koneksi dan gunakan **Sinkronkan sekarang**. Status terkirim hanya sesudah API mengonfirmasi.

Service worker hanya cache shell lokal; request API dan token tidak disimpan di Cache Storage. Browser harus mengizinkan IndexedDB dan PWA memerlukan HTTPS (localhost diizinkan untuk pengembangan).

## Production build

Pastikan migration sudah dibuat dan secret environment dikelola oleh secret store. Build dan jalankan:

```powershell
npm run build
docker compose up --build
```

Compose ini untuk pengembangan dan pengujian lokal, bukan konfigurasi produksi langsung: secret fallback-nya sengaja mudah diganti dan frontend/API harus ditempatkan di belakang HTTPS reverse proxy. Untuk deploy terpisah, frontend dapat dibangun untuk Vercel; API container dan PostgreSQL dapat ditempatkan pada Railway, Render, Fly.io, atau VPS. Lihat [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## Perintah proyek

`npm run dev`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run db:dev --workspace @sdn268/api -- --name init`, `npm run db:migrate`, dan `npm run db:seed`.
