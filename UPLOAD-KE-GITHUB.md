# Upload ke GitHub Web (paket < 100 file)

Paket ini sengaja diringkas menjadi kurang dari 100 file agar bisa diunggah lewat
**Add file → Upload files** di situs GitHub. Fitur runtime Web-CCTV dan proyek Android tetap ada.
Berkas pengujian, screenshot dokumentasi, log, serta CSS Font Awesome duplikat tidak disertakan.

## Cara upload

1. Ekstrak ZIP di komputer/HP.
2. Buka repositori GitHub tujuan.
3. Pilih **Add file → Upload files**.
4. Seret **isi folder hasil ekstrak**, bukan file ZIP-nya.
5. Pastikan folder `.github` ikut. Jika file manager menyembunyikannya, buat manual di GitHub:
   **Add file → Create new file**, nama `.github/workflows/android-build.yml`, lalu salin isi workflow dari paket.
6. Isi pesan commit, lalu pilih **Commit changes**.

Jangan unggah `node_modules`; server akan memasangnya dengan `npm ci --omit=dev`.
