# PANDUAN TEKNIS & PROMPT LENGKAP UNTUK GLM AI (FRONTEND / UI-UX ENGINEER)

Dokumen ini dirancang untuk diberikan langsung kepada **GLM AI** (atau LLM Frontend Engineer) agar menghasilkan kode lengkap yang siap diintegrasikan ke codebase:
- `web/index.html`
- `web/style.css`
- `web/app.js`

Backend firmware ESP32, protokol komunikasi (Web Bluetooth NUS & Web Serial 115200), FSM robot, dan data logger SPIFFS Flash telah di-fix dan disiapkan secara penuh.

---

## 📋 DAFTAR PERUBAHAN & SPESIFIKASI UI/UX

### 1. Penyatuan Halaman Tuning ke Bawah Halaman Telemetri Sensor
* **Kondisi Sebelumnya:** Tab *Tuning Parameter* (`tab-tuning`) terpisah dari tab *Telemetri Sensor* (`tab-telemetry`).
* **Spesifikasi Baru:** 
  * Tab Telemetri Sensor (`tab-telemetry`) menjadi halaman utama dashboard.
  * Komponen panel tuning parameter (slider kecepatan, pushback, dodge, reflex garis, dll.) dipindahkan **langsung di bagian bawah** dari kartu data sensor live di `tab-telemetry`.
  * Pengguna dapat memantau respon sensor dan langsung men-tuning nilai PWM tanpa perlu bolak-balik ganti tab.

### 2. Logging Canggih Tersinkronisasi Kamera Laptop
* **Pemilih Input Kamera (Camera Device Selector):**
  * Dropdown pemilihan kamera menggunakan `navigator.mediaDevices.enumerateDevices()`.
  * Menampilkan label kamera (misal: "Integrated Webcam", "USB Wide-Angle Camera", dll.).
  * Preview live feed kamera kecil di panel perekaman.
* **Auto-Start & Auto-Stop Sinkron:**
  * Saat tombol *Mulai Rekam* (`btnLogStart` atau quick start) diklik:
    1. Kirim perintah `{ cmd: "log_start" }` ke robot.
    2. Kamera laptop otomatis mulai merekam video menggunakan `MediaRecorder` API (MIME: `video/webm;codecs=vp8,opus` atau fallback `video/mp4`).
    3. Catat timestamp awal perekaman (`t0_camera = performance.now()`).
  * Saat tombol *Berhenti Rekam* (`btnLogStop` atau `estop`) diklik:
    1. Kirim perintah `{ cmd: "log_stop" }` atau `{ cmd: "estop" }` ke robot.
    2. `MediaRecorder` otomatis berhenti.
    3. Simpan video ke Memory/IndexedDB/Blob URL lokal (`currentVideoBlobUrl`).
    4. Tampilkan tombol langsung: "Lihat Preview & Replay Cocokkan Video".

### 3. Halaman Khusus Preview & Replay Hasil Logging (`tab-preview`)
Tambahkan tab navigasi baru: **"PREVIEW & REPLAY"** (`tab-preview`):
* **Layout Split Screen Elegan:**
  * **Sisi Kanan (50% Lebar): Video Footage Player**
    * Pemutar video dari rekaman kamera laptop.
    * Kontrol video lengkap: Play/Pause, Slider Waktu (Seek), Pilihan Kecepatan Playback (0.25x, 0.5x, 1.0x, 1.5x, 2.0x).
    * Indikator waktu detik/milidetik (`mm:ss.ms`).
  * **Sisi Kiri (50% Lebar): Dashboard Telemetri Interaktif Tersinkronisasi**
    * Telemetri robot yang bergerak secara *real-time* mengikuti posisi pemutaran video (`video.currentTime * 1000` $\approx$ `tMs` data blackbox).
    * Saat video di-play atau di-scrub, seluruh elemen visual di sisi kiri bergerak sinkron!

### 4. Elemen Visualisasi Interaktif di Sisi Kiri
1. **Ilustrasi 2D Robot Sumo (Chassis Display):**
   * Robot berada di tengah arena berbentuk persegi dengan arah hadap ke atas (0°).
   * **4 Titik Sensor Garis IR:**
     * `FL` (Depan-Kiri), `FR` (Depan-Kanan), `BL` (Belakang-Kiri), `BR` (Belakang-Kanan).
     * Normal: Hijau neon redup atau abu-abu.
     * **Ke-trigger garis putih (`edgeMask` bit active):** Menyala **MERAH TERANG (PULSING GLOW)**!
   * **6 Sensor Jarak Time-of-Flight (VL53L1X):**
     * 3 Depan: FL (serong kiri 30°), FC (tengah 0°), FR (serong kanan 30°).
     * 2 Samping: ML (kiri 90°), MR (kanan 90°).
     * 1 Belakang: RR (belakang 180°).
     * Tiap sensor memancarkan kerucut pandang (cone) / beam:
       * Jika jarak musuh $\le 400\text{ mm}$: Beam berubah **MERAH TERANG** dan menampilkan angka jarak (contoh: `185 mm`).
       * Jika $> 400\text{ mm}$ atau clear: Beam berwarna abu-abu/cyan redup.
2. **Indikator Arah Gerak & Speed Roda:**
   * Panah vektor gerak di atas robot:
     * Maju lurus $\uparrow$, Mundur $\downarrow$, Belok serong kiri $\nwarrow$, Belok serong kanan $\nearrow$, Putar di tempat $\circlearrowleft$ / $\circlearrowright$.
   * Gauge / bar nilai kecepatan: Motor Kiri (`pwmL` %) & Motor Kanan (`pwmR` %).
3. **Bar Jarak ToF di Bagian Atas:**
   * 6 Progress bar horizontal di baris atas untuk visualisasi cepat jarak FL, FC, FR, ML, MR, RR (skala 0 s/d 1200 mm).
4. **Ilustrasi IMU / Gyro 2 Sisi (Tilt Detection):**
   * **Sisi Samping (Roll):** Ilustrasi robot tampak depan/belakang miring ke kiri atau kanan.
   * **Sisi Depan-Belakang (Pitch):** Ilustrasi robot tampak samping terangkat moncongnya (tercongkel blade musuh).
   * Jika kemiringan $> 15^\circ$, muncul badge alert kemiringan **"TILT DETECTED"**.

---

## 📡 KONTRAK DATA PROTOKOL (BACKEND INTERFACE)

Firmware ESP32 mengirimkan data baris JSON melalui Web Bluetooth NUS & Web Serial:

### 1. Data Sampel Blackbox (`log_data`)
```json
{
  "t": "log_data",
  "idx": 0,
  "rows": [
    [
      150,     // [0]  tMs (milidetik relatif)
      4,       // [1]  stateId (0=WAIT, 1=DODGE, 2=SEARCH, 3=TRACK, 4=ATTACK, 5=EDGE, 6=PUSH, 7=TILT, 8=TEST)
      85,      // [2]  pwmL (-100 s/d +100%)
      90,      // [3]  pwmR (-100 s/d +100%)
      1,       // [4]  edgeMask (bit0=FL, bit1=FR, bit2=BL, bit3=BR)
      210,     // [5]  tof[0] - FL (mm)
      180,     // [6]  tof[1] - FC (mm)
      450,     // [7]  tof[2] - FR (mm)
      999,     // [8]  tof[3] - ML (mm)
      999,     // [9]  tof[4] - MR (mm)
      999,     // [10] tof[5] - RR (mm)
      -25,     // [11] pitch (* 10, e.g. -2.5 deg)
      12,      // [12] roll  (* 10, e.g. +1.2 deg)
      98       // [13] accel (* 100, e.g. 0.98 G)
    ]
  ]
}
```

### 2. Status Flash & Log (`log_status`)
```json
{
  "t": "log_status",
  "recording": false,
  "count": 420,
  "hasFlash": true,
  "totalBytes": 1966080,
  "usedBytes": 32768,
  "freeBytes": 1933312,
  "fileSize": 18450
}
```

### 3. Perintah yang Dikirim dari Web ke Robot
* `{ "cmd": "estop" }` -> Emergency stop, matikan motor seketika.
* `{ "cmd": "combat_start" }` -> Start match otonom.
* `{ "cmd": "combat_stop" }` -> Standby.
* `{ "cmd": "log_start" }` -> Mulai rekam blackbox.
* `{ "cmd": "log_stop" }` -> Berhenti rekam & simpan flash.
* `{ "cmd": "log_fetch" }` -> Tarik data rekaman dari flash.
* `{ "cmd": "log_clear" }` -> Hapus file flash `/blackbox.csv`.
* `{ "cmd": "save_profile", ... }` -> Simpan parameter kecepatan.

---

## 💬 PROMPT COPY-PASTE LENGKAP UNTUK GLM AI

> **Salin teks di dalam blok kutipan berikut dan kirimkan langsung ke GLM AI:**

```markdown
Halo GLM AI! Kamu bertindak sebagai Senior Frontend Engineer & UI/UX Specialist untuk project Summobot V1 (Autonomous 500g Sumo Robot Studio).

Tugasmu adalah memperbarui dan menyempurnakan 3 file frontend web:
1. `web/index.html`
2. `web/style.css`
3. `web/app.js`

Seluruh logic backend firmware (ESP32 FreeRTOS, BLE Nordic UART, Web Serial 115200, NVM Flash, SPIFFS Data Logger) sudah 100% siap dan telah difix. Kamu HANYA perlu fokus mengerjakan sisi FRONTEND UI/UX.

---

### TUGAS UTAMA YANG HARUS KAMU KERJAKAN:

#### 1. Penyatuan Kontrol Tuning ke Halaman Utama (Telemetry)
- Hapus tab terpisah "Tuning Parameter" dari navigasi atas.
- Pindahkan seluruh section input parameter tuning profil kecepatan (Attack, Dodge, Turn, Reflex Edge, Tilt, Pushback, Accel Rate) ke BAGIAN BAWAH dari kartu telemetri live di `tab-telemetry`.
- Buat layout yang rapi, compact, dan responsif dengan grup kartu (Combat Tuning, Reflex & Safety Tuning, Start Strategy Tuning).

#### 2. Fitur Perekaman Kamera Laptop Sinkron dengan Blackbox Logging
- Tambahkan UI Pemilihan Kamera di bagian banner/kartu Blackbox:
  - Dropdown `<select id="cameraSelect">` untuk memilih input webcam laptop atau kamera eksternal (`navigator.mediaDevices.enumerateDevices()` dengan filter `kind === 'videoinput'`).
  - Elemen video preview kecil `<video id="cameraLivePreview" autoplay playsinline muted></video>`.
- Sinkronisasi Otomatis:
  - Ketika tombol "Mulai Rekam" diklik (`btnLogStart` / `btnQuickLogStart`):
    - Mulai perekaman kamera menggunakan `MediaRecorder` API.
    - Simpan timestamp mulai `cameraStartTime = performance.now()`.
    - Kirim `{ cmd: "log_start" }` ke robot.
  - Ketika tombol "Berhenti Rekam" atau "Emergency Stop" diklik:
    - Hentikan `MediaRecorder`.
    - Buat Blob URL dari potongan video (`videoChunks`) dan simpan ke variabel global `currentMatchVideoUrl`.
    - Tampilkan notifikasi "Video Match Siap Direplay Bersama Telemetri".
  - Berikan juga opsi:
    - "Unggah Video Rekaman Sendiri" (`<input type="file" accept="video/*">`) jika pengguna merekam dengan HP/kamera luar.

#### 3. Halaman Baru: "PREVIEW & REPLAY" (`tab-preview`)
Buat tab baru di navigasi utama bernama `PREVIEW & REPLAY`:
- **Split-Screen Layout (Side-by-Side):**
  - **Sisi Kanan:** Video Player
    - `<video id="replayVideoPlayer" controls playsinline></video>`
    - Kontrol scrubber sinkron, tombol Play/Pause, speed selector (0.5x, 1.0x, 1.5x, 2.0x).
  - **Sisi Kiri:** Visualisasi Telemetri Robot Interaktif
    - Telemetri bergerak secara otomatis mengikuti `currentTime` video (`video.currentTime * 1000` dicocokkan ke baris `blackboxData[i].tMs`).
    - Jika pengguna menggeser slider video / scrubber, data robot di sebelah kiri seketika ter-update!

#### 4. Visualisasi Interaktif di Sisi Kiri Halaman Replay:
1. **Chassis Robot Sumo 2D Interaktif (Canvas atau SVG):**
   - Di tengah layar terdapat ilustrasi sasis robot sumo (kotak dengan blade depan).
   - **4 Titik IR Tepi Garis (FL, FR, BL, BR):**
     - Berada di keempat sudut sasis.
     - Jika `edgeMask` aktif pada sensor tersebut, titik IR menyala MERAH TERANG dengan efek pulsing neon glow!
   - **6 Cone Sensor ToF (FL 30°, FC 0°, FR 30°, ML 90°, MR 90°, RR 180°):**
     - Jika jarak <= 400 mm (musuh terdeteksi), kerucut sensor menyala MERAH TERANG dan menampilkan angka jarak (misal: 142 mm).
     - Jika tidak ada musuh, kerucut transparan atau cyan redup.
   - **Panah Vektor Gerak & Kecepatan:**
     - Panah dinamis di tengah bodi robot menunjukkan arah aksi: Maju, Mundur, Belok Kiri, Belok Kanan, atau Spin.
     - Teks / gauge menunjukkan: `Kiri: XX% | Kanan: YY%`.
2. **Top Bar Jarak ToF:**
   - 6 Progress bar horizontal di atas visualisator untuk membandingkan jarak 6 sensor secara instan.
3. **Ilustrasi Gyro 2 Sisi (Pitch & Roll):**
   - Dua ilustrasi mini:
     1. Tampak Depan (Roll): Robot miring ke kiri/kanan.
     2. Tampak Samping (Pitch): Robot terangkat bagian depan/belakangnya.
     3. Warning badge jika pitch/roll > 15 deg ("TERANGKAT / TILT ESCAPE").

---

### DESAIN & AESTHETICS:
- Gunakan tema yang sudah ada: Cyberpunk / Futuristic Dark Theme:
  - Background: `#080c14`, `#0d1424`, `#131d33`
  - Aksen Utama: Cyan neon `#00f3ff`, Purple/Violet `#d946ef`, Green neon `#10b981`, Warning Amber `#f59e0b`, Danger Red `#ef4444`.
  - Font: `Inter`, `JetBrains Mono` untuk angka telemetri.
  - Border lembut dengan glassmorphism (`backdrop-filter: blur(8px)`).
- Semua komponen harus responsif dan tidak merusak layout yang sudah ada.

Berikan output kode lengkap dan terstruktur (bisa langsung diganti atau diimplementasikan) untuk `index.html`, `style.css`, dan `app.js`.
```
