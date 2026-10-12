# Sistem PPN Lilin Aromaterapi

Kerangka aplikasi web untuk membantu usaha lilin aromaterapi berstatus PKP mencatat persediaan perpetual dan transaksi terkait PPN 11%. HPP setiap produk akan ditetapkan secara manual pada master produk.

## Teknologi

- Frontend: HTML, CSS, dan JavaScript murni
- Backend: Node.js 18+ dengan modul bawaan `http` dan `fetch`
- Database: Supabase (PostgreSQL)

## Setup Supabase

1. Buat akun di [Supabase](https://supabase.com/) dan buat project PostgreSQL baru.
2. Setelah project siap, buka **SQL Editor** di dashboard Supabase.
3. Jalankan skrip database dari `backend/database.sql` setelah skrip tersebut tersedia.
4. Ambil **Project URL** dan **anon/public key** dari pengaturan API project. Nilai ini akan dikonfigurasi langsung di `backend/app.js` ketika backend dibuat.

Jangan pernah menaruh `service_role` key di frontend atau membagikannya ke GitHub. Terapkan kebijakan Row Level Security (RLS) yang sesuai sebelum menggunakan data nyata.

## Menjalankan backend

Pastikan Node.js versi 18 atau lebih baru tersedia, lalu dari folder `lilin-ppn-app` jalankan:

```bash
node backend/app.js
```

Backend belum diimplementasikan pada kerangka awal ini; perintah tersebut dapat digunakan setelah kode backend ditambahkan.

## Membuka frontend

Buka `frontend/index.html` langsung di browser. Frontend belum diimplementasikan pada kerangka awal ini.

## Push ke GitHub

Buat repository kosong di GitHub, lalu jalankan perintah berikut dari folder `lilin-ppn-app` (ganti URL remote dengan URL repository Anda):

```bash
git init
git add .
git commit -m "Initial project structure"
git branch -M main
git remote add origin https://github.com/USERNAME/NAMA-REPOSITORY.git
git push -u origin main
```
