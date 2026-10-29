# API v1

Semua endpoint diawali `/api/v1`. Respons sukses berbentuk `{ "success": true, "data": ..., "error": null, "meta": {} }`. Error memakai `{ "success": false, "data": null, "error": { "code": "...", "message": "..." }, "meta": {} }`.

## OpenAPI ringkas

```yaml
openapi: 3.1.0
info:
  title: Sistem Formulir SDN 268 API
  version: 1.0.0
servers:
  - url: http://localhost:4000/api/v1
paths:
  /health:
    get:
      summary: Pemeriksaan kesiapan API dan koneksi database
      responses:
        "200": { description: API dan database siap }
        "503": { description: Database tidak dapat diakses }
  /auth/student/login:
    post:
      summary: Login murid dengan studentLoginId dan password
      responses:
        "200": { description: Token akses dan identitas murid }
        "401": { description: Credential salah }
  /auth/google:
    get:
      summary: Mulai Google OAuth untuk staf
      responses:
        "302": { description: Redirect ke Google }
  /forms:
    get:
      security: [{ bearerAuth: [] }]
      summary: Daftar formulir
      responses:
        "200": { description: Formulir dalam ruang lingkup role }
    post:
      security: [{ bearerAuth: [] }]
      summary: Buat formulir dan versi pertama
      responses:
        "201": { description: Formulir draf baru }
  /forms/{id}/assignments:
    post:
      security: [{ bearerAuth: [] }]
      summary: Tugaskan formulir kepada kelas atau murid
      responses:
        "200": { description: Jumlah penugasan baru }
        "400": { description: Target kelas atau murid tidak valid }
  /students:
    get:
      security: [{ bearerAuth: [] }]
      summary: Daftar murid dengan pencarian, filter, sort, dan pagination
      responses:
        "200": { description: Daftar murid dengan metadata pagination }
    post:
      security: [{ bearerAuth: [] }]
      summary: Tambah murid; NISN menjadi sandi awal dan tidak dikembalikan
      responses:
        "201": { description: Data murid baru dengan NISN termasking }
        "409": { description: NISN sudah terdaftar }
  /classes:
    get:
      security: [{ bearerAuth: [] }]
      summary: Daftar kelas dan tahun ajaran untuk administrasi murid
      responses:
        "200": { description: Kelas sekolah }
  /students/{id}:
    get:
      security: [{ bearerAuth: [] }]
      summary: Detail murid tanpa NISN lengkap
      responses:
        "200": { description: Data murid }
    patch:
      security: [{ bearerAuth: [] }]
      summary: Ubah nama, kelas, atau status dengan recordVersion opsional
      responses:
        "200": { description: Data murid terbaru }
        "409": { description: Konflik perubahan bersamaan }
    delete:
      security: [{ bearerAuth: [] }]
      summary: Soft delete murid
      responses:
        "200": { description: Murid dihapus secara lunak }
  /students/{id}/restore:
    post:
      security: [{ bearerAuth: [] }]
      summary: Pulihkan murid yang soft deleted
      responses:
        "200": { description: Murid dipulihkan }
  /students/bulk-delete:
    post:
      security: [{ bearerAuth: [] }]
      summary: Soft delete hingga 100 murid
      responses:
        "200": { description: Jumlah murid yang dihapus }
  /students/bulk-restore:
    post:
      security: [{ bearerAuth: [] }]
      summary: Pulihkan hingga 100 murid
      responses:
        "200": { description: Jumlah murid yang dipulihkan }
  /students/bulk-delete-all:
    post:
      security: [{ bearerAuth: [] }]
      summary: Soft-delete seluruh murid aktif setelah konfirmasi HAPUS SEMUA
      responses:
        "200": { description: Jumlah murid yang dipindahkan ke daftar terhapus }
        "400": { description: Konfirmasi eksplisit wajib diberikan }
  /students/import:
    post:
      security: [{ bearerAuth: [] }]
      summary: Impor atau perbarui maksimal 500 murid dari workbook XLSX
      requestBody:
        required: true
        content:
          application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
            schema: { type: string, format: binary }
      responses:
        "200": { description: Jumlah murid baru dan diperbarui }
        "400": { description: File atau baris spreadsheet tidak valid }
  /submissions/sync:
    post:
      security: [{ bearerAuth: [] }]
      summary: Submit idempoten dari murid
      responses:
        "201": { description: Submission tersimpan }
        "400": { description: Payload tidak valid }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

## Endpoint yang tersedia pada MVP

- `GET /health`
- `GET /auth/google`, `GET /auth/google/callback`
- `POST /auth/student/login`, `POST /auth/change-initial-password`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- `GET /students?page=1&pageSize=20&q=&classId=&status=&showDeleted=false&sortBy=name&sortOrder=asc`
- `GET /classes`
- `POST /students`, `GET /students/:id`, `PATCH /students/:id`, `DELETE /students/:id`
- `POST /students/:id/restore`, `POST /students/bulk-delete`, `POST /students/bulk-restore`
- `GET /forms`, `POST /forms`, `GET /forms/:id`, `PATCH /forms/:id`, `POST /forms/:id/publish`
- `POST /submissions/sync`
- `POST /submissions/:id/grade`, `POST /submissions/:id/release-grade`
- `GET /student/grades` (hanya nilai yang telah dirilis)

Daftar siswa dapat diakses SUPER_ADMIN dan ADMIN; parameter `showDeleted=true` menampilkan data terhapus saja. Respons hanya menyertakan `nisnMasked`, bukan NISN lengkap/hash/password. Pembuatan siswa memerlukan `NISN_HASH_SECRET` untuk HMAC indeks duplikat dan menyimpan NISN awal sebagai hash Argon2id. `recordVersion` pada PATCH opsional; bila dikirim dan sudah kedaluwarsa, API mengembalikan `409 VERSION_CONFLICT`.

Pembuatan form menerima `assignments` opsional berisi `classIds` dan/atau `studentIds`. Penugasan tambahan dapat dibuat dengan `POST /forms/:id/assignments`; endpoint memeriksa kepemilikan form oleh guru dan validitas seluruh target. Form yang belum ditugaskan tidak dapat dipublikasikan. Kunci idempotensi submission milik murid lain ditolak dengan `409 IDEMPOTENCY_KEY_REUSED`.

Import/export Excel siswa, form import, file, list/export submission, audit logs, sync batch/status belum tersedia. Daftar form murid dibatasi pada form published yang ditugaskan kepada kelas atau murid tersebut.
