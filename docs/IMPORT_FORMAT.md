# Format import

## Data murid (.xlsx)

Panel **Data murid** menyediakan unduhan template, ekspor, dan impor `.xlsx`. Impor membaca sheet pertama dan menerima maksimal 500 baris.

| Kolom | Wajib | Keterangan |
|---|---|---|
| Nama | Ya | Nama lengkap murid. |
| Nama Pengguna | Untuk pembaruan | Cocokkan nilai ini dengan hasil ekspor untuk memperbarui atau memulihkan akun yang ada. |
| NISN | Murid baru | Tepat 10 angka. NISN menjadi kata sandi awal. Kosongkan untuk mempertahankan NISN akun yang diperbarui. Jika diisi pada akun lama, kata sandi direset dan wajib diganti pada login berikutnya. |
| Kelas | Tidak | Nama kelas yang tersedia. |
| Tahun Ajaran | Jika nama kelas tidak unik | Pasangan kelas dan tahun ajaran harus cocok dengan data sekolah. |
| Status | Tidak | `ACTIVE`, `INACTIVE`, atau `SUSPENDED`; bawaan `ACTIVE`. |

Ekspor tidak berisi NISN asli karena aplikasi hanya menyimpan hash NISN. Kolom NISN tetap kosong agar file ekspor dapat diimpor kembali untuk memperbarui data yang sudah ada tanpa mengubah kata sandi. Isi NISN hanya untuk membuat akun baru atau mereset kata sandi. Mengimpor akun dalam daftar terhapus akan memulihkannya.

Impor memvalidasi seluruh baris sebelum menyimpan; jika ada baris yang tidak valid, tidak ada perubahan yang diterapkan dan respons menyebut nomor baris yang perlu diperbaiki. Hapus semua adalah soft-delete yang memindahkan murid ke daftar terhapus, bukan menghapus permanen.

## Pertanyaan formulir (.docx)

Pada pembuat **Formulir baru**, unduh **Template (.docx)**, ubah contoh pertanyaan, kemudian pilih **Impor (.docx)**. Pertanyaan hasil impor ditambahkan ke daftar yang sedang dibuat dan masih dapat diedit sebelum disimpan. Jika daftar sudah berisi pertanyaan, aplikasi meminta konfirmasi sebelum menambahkan soal. Maksimal 100 soal per formulir dan ukuran file maksimal 10 MB.

Setelah soal masuk ke editor, pilih **Unduh soal rapi (.docx)** untuk membuat dokumen Microsoft Word siap dibaca atau dicetak. Dokumen keluaran menggunakan judul formulir, numbering otomatis, pilihan jawaban berhuruf, ruang jawaban untuk soal isian, dan bagian **Kunci Jawaban** di halaman berikutnya. Dokumen keluaran tidak menampilkan istilah teknis seperti `[SINGLE_CHOICE]` dan dapat dipilih kembali melalui **Impor (.docx)**; parser akan membaca nomor soal, pilihan berhuruf, kolom tabel, dan kunci jawaban.

Setiap pertanyaan dimulai dengan `[TIPE] Teks pertanyaan`. Tipe yang didukung: `SHORT_TEXT`, `PARAGRAPH`, `NUMBER`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `DROPDOWN`, dan `MATRIX`. Untuk soal pilihan, tulis `Pilihan:` lalu satu opsi per baris dengan awalan `- `. Baris opsional `Jawaban:`, `Bobot:`, dan `Wajib:` dapat ditambahkan di dalam blok soal. Kunci pilihan harus sama dengan teks opsi; untuk `MULTIPLE_CHOICE`, pisahkan beberapa jawaban dengan titik koma. Bobot menerima angka 0–1000; Wajib menerima `Ya` atau `Tidak`.

Contoh:

```text
[SINGLE_CHOICE] Planet yang paling dekat dengan Matahari?
Pilihan:
- Merkurius
- Venus
Jawaban: Merkurius
Bobot: 1
Wajib: Ya

[PARAGRAPH] Jelaskan jawabanmu.

[MATRIX] Data pengamatan tanaman
Kolom: Nama tanaman | SHORT_TEXT
Kolom: Kondisi daun | DROPDOWN
Opsi:
- Sehat
- Layu
Kolom: Catatan | PARAGRAPH
Wajib: Ya
```

Bobot diterapkan ketika mode kuis aktif. Kunci jawaban yang diimpor tetap disimpan dan dapat digunakan jika mode kuis diaktifkan. Teks di luar blok pertanyaan dan tipe yang tidak dikenal akan ditolak dengan informasi baris yang perlu diperbaiki.

## Pertanyaan tabel

Untuk mengimpor tabel dari DOCX, mulai blok dengan `[MATRIX] Judul tabel/pertanyaan`, lalu definisikan satu kolom per baris menggunakan `Kolom: Keterangan | JENIS`. Jenis yang didukung: `SHORT_TEXT`, `PARAGRAPH`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, dan `DROPDOWN`. Untuk tiga jenis pilihan, ikuti definisi kolom dengan `Opsi:` dan satu opsi per baris berawalan `- `; jumlah opsi tidak dibatasi oleh penghitung tetap, minimal dua opsi berbeda diperlukan. Nama kolom tidak boleh kosong atau duplikat. `Wajib: Ya/Tidak` berlaku untuk tabel. Maksimal 50 kolom; baris jawaban tidak ditulis di DOCX karena murid membuatnya sendiri.

Contoh tabel:

```text
[MATRIX] Data pengamatan tanaman
Kolom: Nama tanaman | SHORT_TEXT
Kolom: Kondisi daun | DROPDOWN
Opsi:
- Sehat
- Layu
Kolom: Catatan | PARAGRAPH
Wajib: Ya
```

Tabel hasil impor masih dapat diedit di pembuat formulir, termasuk judul, keterangan kolom, jenis pengisian, dan opsi. Di tampilan murid, tombol **Tambah baris** membuka formulir isian popup; setiap baris dapat diedit atau dihapus melalui menu aksi. Murid juga dapat mengunggah satu dokumen JPG, PNG, atau PDF per baris (maksimal 2 MB); pratinjau gambar atau PDF tersedia sebelum menyimpan jawaban. Tabel memiliki maksimal 50 baris jawaban dan 50 kolom. Jika pertanyaan wajib, setidaknya satu baris harus diisi lengkap. Jawaban tabel dinilai manual dalam mode kuis.

Impor spreadsheet pertanyaan belum tersedia. Format yang direncanakan untuk spreadsheet pertanyaan:

| No | Tipe Soal | Pertanyaan | Opsi | Wajib | Kunci Jawaban | Bobot | Bagian |
|---|---|---|---|---|---|---:|---|
| 1 | SINGLE_CHOICE | Hasil 2 + 3 adalah… | `2;3;5` | Ya | 5 | 1 | Hitung |

Jenis data yang direncanakan: `SHORT_TEXT`, `PARAGRAPH`, `NUMBERED_PARAGRAPH`, `NUMBER`, `SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `DROPDOWN`, `FILE`, `MATRIX`. Pemisah opsi `;` harus di-escape atau diganti JSON ketika ada karakter pemisah di opsi.

Rancangan import harus memvalidasi header, ukuran dan signature file, baris duplikat, nilai formula berbahaya, serta setiap tipe pertanyaan. Preview dan konfirmasi admin perlu terjadi sebelum draft tersimpan. Nilai spreadsheet yang diekspor perlu disanitasi dari formula injection.
