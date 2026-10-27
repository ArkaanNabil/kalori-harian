# Kalori Harian

PWA pencatat kalori dan makro harian. Tanpa server, tanpa akun, tanpa build step — cukup file statis, jadi bisa langsung di-host di GitHub Pages dan dipasang di HP seperti aplikasi biasa.

## Fitur

- **Dashboard harian** — ring sisa kalori (target + kalori terbakar − kalori masuk), progress bar karbo/protein/lemak
- **4 waktu makan** — sarapan, makan siang, makan malam, camilan, masing-masing punya target kalori sendiri
- **Tiga cara input** — pilih dari pustaka, simpan makanan baru, atau catat cepat sekali pakai
- **Pustaka makanan pribadi** — simpan nilai gizi per takaran acuan, berikutnya tinggal atur jumlah porsi
- **Target otomatis** — Mifflin-St Jeor (BMR → TDEE → target), bisa di-override manual
- **Riwayat 14 hari** — grafik batang, rata-rata kalori dan protein, ketuk tanggal untuk membuka hari itu
- **Offline** — service worker menyimpan app shell, jalan tanpa internet
- **Export / import JSON** — backup manual

## Cara deploy ke GitHub Pages

```bash
# dari dalam folder ini
git init
git add .
git commit -m "Kalori Harian v1.0.0"
git branch -M main
git remote add origin https://github.com/<username>/kalori-harian.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Build and deployment**, pilih **Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**. Tunggu 1-2 menit, URL-nya muncul di halaman yang sama:

```
https://<username>.github.io/kalori-harian/
```

Repo publik atau privat sama-sama bisa, tapi GitHub Pages untuk repo privat butuh paket berbayar. Untuk pemakaian pribadi, repo publik paling praktis — di dalamnya tidak ada data pribadi, hanya kode (semua catatan makan tersimpan di HP, bukan di repo).

## Cara pasang di HP

**Android (Chrome)** — buka URL di atas → menu ⋮ → *Add to Home screen* / *Install app*.

**iPhone (Safari)** — buka URL → tombol Share → *Add to Home Screen*. Harus lewat Safari; Chrome di iOS tidak bisa memasang PWA.

Setelah terpasang, ikonnya ada di home screen, terbuka full screen tanpa address bar, dan tetap jalan saat offline.

## Catatan penyimpanan data

Semua data ada di **IndexedDB browser pada perangkat itu saja**. Konsekuensinya:

- Tidak sinkron antar perangkat. HP dan laptop punya data sendiri-sendiri.
- Data ikut terhapus kalau kamu clear browsing data / site data untuk domain tersebut, atau uninstall aplikasinya di iOS.
- iOS menghapus data situs yang tidak dibuka selama ±7 hari untuk web app yang belum di-*Add to Home Screen*. Setelah dipasang ke home screen, datanya persisten.

Jadi biasakan **Pengaturan → Data → Export JSON** sesekali dan simpan filenya di Drive. Import mengganti seluruh data dengan isi file.

## Struktur file

```
index.html              markup semua layar
styles.css              styling + light/dark mode
app.js                  IndexedDB, perhitungan target, render, semua interaksi
sw.js                   service worker (offline)
manifest.webmanifest    metadata PWA
icons/                  ikon aplikasi
.nojekyll               cegah GitHub Pages memproses file lewat Jekyll
```

Tidak ada dependency eksternal sama sekali. Mau diedit tinggal buka filenya.

## Jalankan lokal

```bash
python3 -m http.server 8080
# buka http://localhost:8080
```

Service worker dan PWA install butuh HTTPS, tapi `localhost` dikecualikan browser, jadi tetap bisa dites penuh dari sini.

## Rumus yang dipakai

**BMR (Mifflin-St Jeor)**
```
pria   : 10×BB(kg) + 6,25×TB(cm) − 5×umur + 5
wanita : 10×BB(kg) + 6,25×TB(cm) − 5×umur − 161
```

**TDEE** = BMR × faktor aktivitas (1,2 / 1,375 / 1,55 / 1,725 / 1,9)

**Target kalori** = TDEE + penyesuaian tujuan (±275 atau ±550 kkal/hari), dibatasi minimum 1200 kkal

**Makro**
```
protein = g per kg × berat badan
lemak   = (target kalori × %lemak) / 9
karbo   = (target kalori − protein×4 − lemak×9) / 4
```

Angka-angka ini perkiraan populasi, bukan pengukuran individu. Kalau berat badan tidak bergerak sesuai perhitungan setelah 2-3 minggu, sesuaikan target kalorinya berdasarkan hasil nyata, bukan rumusnya.
