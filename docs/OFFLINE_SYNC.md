# PWA dan sinkronisasi offline

## Implementasi

- `manifest.webmanifest`, ikon SVG, fallback offline, dan service worker disediakan.
- Service worker melakukan network-first untuk navigasi/aset dan tidak mengintersep API. Shell fallback dapat dibuka saat jaringan gagal.
- Dexie menyimpan `cachedForms`, `draftSubmissions`, `pendingMutations`, dan `syncLogs`.
- Autosave draft memperbarui IndexedDB. Ketika submit saat offline, data antrean berstatus PENDING.
- Ketika online, atau ketika tombol sinkronisasi dipilih, aplikasi mengirim `clientMutationId` UUID ke `POST /api/v1/submissions/sync`.
- Server mengembalikan hasil yang sudah ada ketika UUID idempotensi yang sama dikirim lagi. Aplikasi baru menunjukkan status terkirim setelah respons sukses.
- Jika request gagal, jawaban tetap berada di antrean dengan status FAILED.

## Batasan MVP

Background Sync belum digunakan karena dukungan browser bervariasi. Sinkronisasi hanya event `online`, saat halaman aktif, atau tombol manual. Saat ini draft offline adalah draft satu perangkat; belum ada `recordVersion` server untuk draft dan belum tersedia UI penyelesaian konflik multi-perangkat. Form offline hanya tersedia setelah pernah berhasil dimuat. File tidak dapat dipilih/diantrekan offline. Jangan menyatakan konflik atau berkas offline telah didukung.

Jawaban final dibuat immutable di MVP. Perubahan draft lintas tab/perangkat belum digabung otomatis. Data lokal bergantung pada kuota/browser storage; browser dapat menghapus data lokal. Pengguna harus menyinkronkan ketika online sebelum menghapus data browser.

## Pengujian manual

Login dan cache form saat online → matikan koneksi di DevTools → simpan draft dan submit → verifikasi status menunggu → hidupkan kembali → pilih Sinkronkan sekarang → verifikasi status hasil. Verifikasi Network/Cache Storage bahwa endpoint API dan data autentikasi tidak berada di Cache Storage.
