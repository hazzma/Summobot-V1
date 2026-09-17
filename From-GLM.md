

Share
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

Thought Process
Siap. Berikut implementasi lengkap 3 file frontend untuk Summobot V1 Studio — dengan tab Tuning yang digabung ke Dashboard, perekaman kamera laptop tersinkron dengan blackbox, serta halaman PREVIEW & REPLAY split-screen dengan visualisasi telemetri interaktif (chassis 2D, cone ToF, IR edge pulsing, vektor gerak, IMU tilt). Saya juga menyematkan mode Simulasi agar seluruh pipeline (termasuk sinkronisasi video ↔ blackbox) bisa diuji di laptop tanpa hardware.

📄 web/index.html
🎨 web/style.css
css

  display:flex;align-items:center;gap:12px;margin-top:12px;padding:12px;
  border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.07);border-radius:8px;
}
.rec-ready .ic{width:22px;height:22px;color:var(--green);flex:none}
.rec-ready b{display:block;font-size:12px}
.rec-ready small{color:var(--txt3);font-size:10px}
.rec-ready .btn{margin-left:auto;flex:none}
.upload-row,.flash-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

/* ================= PREVIEW & REPLAY ================= */
.replay-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap;padding:12px 16px}
.rb-info h3{font-size:12px;letter-spacing:.18em;margin-bottom:2px}
.rb-sync{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--txt3);letter-spacing:.1em}
.rb-sync b{color:var(--cyan);min-width:56px;text-align:center}
.replay-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}
.replay-left{position:relative}
.vp-empty{
  position:absolute;inset:46px 16px 16px;z-index:5;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  text-align:center;color:var(--txt3);font-size:12px;line-height:1.7;
  background:rgba(8,12,20,.85);border:1px dashed var(--line2);border-radius:8px;
}
.vp-empty .ic{width:26px;height:26px;color:var(--amber)}
.video-stage{position:relative;background:#000;border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:16/9}
.video-stage video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.video-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  color:var(--txt3);font-size:12px;text-align:center;line-height:1.6;
  background:repeating-linear-gradient(-45deg,rgba(139,152,184,.05) 0 10px,transparent 10px 20px);
}
.video-empty .ic{width:30px;height:30px;color:var(--txt2)}
.vctrl{display:flex;align-items:center;gap:10px;margin-top:12px}
.vtime{font-size:11px}
.vtime.dim{color:var(--txt3)}
#vSeek{flex:1}
.sel-speed{width:76px;flex:none}
.sync-chip{font:700 9px var(--mono);letter-spacing:.12em;padding:3px 8px;border-radius:3px;border:1px solid var(--line);color:var(--txt3)}
.sync-chip.live{color:var(--green);border-color:rgba(16,185,129,.5);animation:recblink 1s steps(2) infinite}

/* ================= TOAST ================= */
#toasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:200}
.toast{
  background:rgba(13,20,36,.95);border:1px solid var(--line2);border-left:3px solid var(--cyan);
  color:var(--txt);font-size:12px;padding:10px 14px;border-radius:6px;max-width:340px;
  opacity:0;transform:translateX(16px);transition:.25s;backdrop-filter:blur(8px);
}
.toast.in{opacity:1;transform:none}
.toast.ok{border-left-color:var(--green)}
.toast.warn{border-left-color:var(--amber)}
.toast.err{border-left-color:var(--red)}

/* ================= RESPONSIVE ================= */
@media(max-width:1240px){
  .bb-grid{grid-template-columns:1fr 1fr}
  .bb-grid .card:nth-child(3){grid-column:1/-1}
}
@media(max-width:980px){
  .replay-split{grid-template-columns:1fr}
  .vp-main{grid-template-columns:1fr}
  .vp-side{flex-direction:row;flex-wrap:wrap}
  .vp-side .vp-block{flex:1 1 210px}
  .bb-grid{grid-template-columns:1fr}
  .bb-grid .card:nth-child(3){grid-column:auto}
}
@media(max-width:640px){
  .topbar{gap:10px;padding:10px 12px}
  .tabs{order:3;width:100%;border-top:1px solid var(--line);padding-top:4px}
  .vp-tof{grid-template-columns:1fr 1fr}
  .replay-bar{flex-direction:column;align-items:flex-start}
}
⚙️ web/app.js
javascript

  });
  $('#btnBle').addEventListener('click', () => {
    link.mode === 'ble' ? (link.bleDev && link.bleDev.gatt.disconnect()) : bleConnect();
  });
  $('#btnSerial').addEventListener('click', () => {
    link.mode === 'serial' ? serialDisconnect() : serialConnect();
  });
  $('#btnSim').addEventListener('click', () => sim.toggle());

  $('#btnQuickStart').addEventListener('click', () => {
    sendCmd({ cmd:'combat_start' });
    if (!loggingActive) startLogging();   // quick start = mulai match + rekam sinkron
  });
  $('#btnQuickStop').addEventListener('click', () => {
    sendCmd({ cmd:'combat_stop' });
    if (loggingActive) stopLogging(false);
  });
  $('#btnEstop').addEventListener('click', () => {
    sendCmd({ cmd:'estop' });
    if (link.mode === 'sim'){ sim.running = false; sim.st = 0; sim.pl = 0; sim.pr = 0; }
    stopLogging(true);
    document.body.classList.remove('estop-flash');
    void document.body.offsetWidth;       // restart animasi
    document.body.classList.add('estop-flash');
    toast('EMERGENCY STOP', 'err');
  });
}

let lastT = performance.now();
function loop(now){
  const dt = Math.min(100, now - lastT);
  lastT = now;

  livePanel.viz.render(now);
  if ($('#tab-preview').classList.contains('active')){
    replayPanel.viz.render(now);
    replayTick(dt);
  }
  sim.step(dt);

  // Meter link
  if (now - hzLast > 500){
    $('#statHz').textContent = (pktWindow * 1000 / (now - hzLast)).toFixed(1) + ' Hz';
    pktWindow = 0; hzLast = now;
  }
  $('#statPk').textContent = pktCount + ' pkt';
  const age = lastPktAt ? now - lastPktAt : null;
  const ageEl = $('#statAge');
  if (age == null){ ageEl.textContent = '—'; ageEl.classList.remove('ok'); }
  else if (age < 500){ ageEl.textContent = 'LIVE'; ageEl.classList.add('ok'); }
  else { ageEl.textContent = 'idle ' + Math.round(age/1000) + 's'; ageEl.classList.remove('ok'); }

  // Refresh counter buffer (throttled)
  if (cntDirty && now - lastCnt > 300){
    lastCnt = now; cntDirty = false;
    refreshCounters();
  }
  requestAnimationFrame(loop);
}

/* ---------------- BOOT ---------------- */
bindTuning();
bindCam();
bindBlackbox();
bindReplay();
bindHeader();
updateRecUI();
rpRefreshInfo();
requestAnimationFrame(loop);
📝 Penjelasan Implementasi
1. Tuning menyatu dengan Telemetri. Tab "Tuning Parameter" dihapus dari navigasi; seluruh slider (Combat / Reflex & Safety / Start Strategy) kini berada langsung di bawah kartu telemetri live. Slider bertanda dot amber saat ada perubahan belum tersimpan, lalu SIMPAN PROFIL mengirim satu paket {cmd:"save_profile", ...}.

2. Kamera sinkron dengan blackbox. enumerateDevices() mengisi dropdown (label muncul setelah izin kamera diberikan lewat tombol Aktifkan). Satu tombol MULAI REKAM (atau quick MULAI di header) mengirim log_start, memulai MediaRecorder (vp8/opus dengan fallback webm/mp4), dan sejak saat itu setiap baris log_data masuk ke buffer replay. BERHENTI / E-STOP mengirim log_stop/estop, menghentikan recorder, membuat Blob URL, dan memunculkan panel "Lihat Preview & Replay". Tersedia juga input unggah video eksternal.

3. Split-screen replay tersinkronisasi. Video adalah master clock: setiap frame, video.currentTime*1000 (+ offset) dicocokkan ke tMs blackbox lewat binary search, sehingga chassis, cone ToF, bar jarak, gauge PWM, panah arah, dan indikator IMU bergerak bersama video — termasuk saat di-scrub. Fitur SYNC OFFSET ±25 ms untuk kalibrasi fase. Tanpa video pun replay tetap jalan (playback telemetri murni dari buffer).

4. Visualisasi. Chassis digambar di canvas (roda, dek, blade amber, indikator heading); 4 IR sudut menyala merah pulsing dengan cincin mengembang saat bit edgeMask aktif; 6 kerucut ToF memerah + menampilkan angka mm saat ≤400 mm; state FSM diberi badge berwarna; pitch/roll divisualkan dua mini-robot CSS dengan badge TILT DETECTED di atas 15°.

5. Cara uji cepat tanpa robot: klik Simulasi → aktifkan kamera → MULAI REKAM → biarkan ~20 detik → BERHENTI → buka PREVIEW & REPLAY; seluruh pipeline video↔blackbox langsung teruji di browser. Koneksi asli memakai tombol Bluetooth (NUS) atau Serial USB (115200).





HTML:

<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>SUMOBOT V1 — Control Studio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css"/>
</head>
<body>

<!-- ====== SPRITE IKON SVG ====== -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></symbol>
  <symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/></symbol>
  <symbol id="i-bt" viewBox="0 0 24 24"><path d="M6.5 7.5l11 9L12 21V3l5.5 4.5-11 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></symbol>
  <symbol id="i-usb" viewBox="0 0 24 24"><rect x="2.5" y="9" width="19" height="6.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.5 9V6.5M12 9V6.5M17.5 9V6.5M6.5 15.5V18M12 15.5V18M17.5 15.5V18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-cam" viewBox="0 0 24 24"><path d="M4 8h3.2L9 5.5h6L16.8 8H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-down" viewBox="0 0 24 24"><path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5M4 20h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 3.5L2.5 20h19L12 3.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-bot" viewBox="0 0 24 24"><rect x="5" y="8.5" width="14" height="10.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4.5v4M8.5 13h.01M15.5 13h.01M9 16.5h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-rec" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></symbol>
  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L4.5 14H11l-1.5 8L18 10h-6.5L13 2z" fill="currentColor"/></symbol>
  <symbol id="i-wave" viewBox="0 0 24 24"><path d="M2 12h3l2-7 3 14 3-10 2 5 2-2h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
</svg>

<!-- ====== TOPBAR ====== -->
<header class="topbar">
  <div class="brand">
    <svg class="ic brand-ic"><use href="#i-bot"/></svg>
    <div class="brand-txt">
      <b>SUMOBOT<span>V1</span></b>
      <small>CONTROL STUDIO</small>
    </div>
  </div>

  <nav class="tabs" id="tabs">
    <button class="tab active" data-tab="tab-dashboard">DASHBOARD</button>
    <button class="tab" data-tab="tab-blackbox">BLACKBOX</button>
    <button class="tab" data-tab="tab-preview">PREVIEW &amp; REPLAY</button>
  </nav>

  <div class="topbar-right">
    <div class="conn">
      <button class="btn" id="btnBle"><svg class="ic"><use href="#i-bt"/></svg><span>Bluetooth</span></button>
      <button class="btn" id="btnSerial"><svg class="ic"><use href="#i-usb"/></svg><span>Serial USB</span></button>
      <button class="btn" id="btnSim"><svg class="ic"><use href="#i-wave"/></svg><span>Simulasi</span></button>
      <div class="chips">
        <span class="chip" id="chipBle">BLE</span>
        <span class="chip" id="chipSer">SER</span>
        <span class="chip" id="chipSim">SIM</span>
      </div>
    </div>
    <div class="matchctl">
      <button class="btn btn-go" id="btnQuickStart"><svg class="ic"><use href="#i-play"/></svg><span>MULAI</span></button>
      <button class="btn" id="btnQuickStop"><svg class="ic"><use href="#i-stop"/></svg><span>STOP</span></button>
      <button class="estop" id="btnEstop">E-STOP</button>
    </div>
  </div>
</header>

<main>
  <!-- ============================================================
       TAB 1 : DASHBOARD  (Telemetri Live + Tuning di bawahnya)
  ============================================================= -->
  <section id="tab-dashboard" class="tabpage active">

    <div class="card live-card">
      <div class="card-head">
        <h3>TELEMETRI SENSOR — LIVE</h3>
        <div class="live-stats mono">
          <span id="statHz">0.0 Hz</span><span class="sep"></span>
          <span id="statPk">0 pkt</span><span class="sep"></span>
          <span id="statAge">—</span>
        </div>
      </div>
      <div id="liveVizPanel" class="vizpanel"></div>
    </div>

    <div class="tuning">
      <div class="tuning-head">
        <h2><svg class="ic"><use href="#i-bolt"/></svg> TUNING PARAMETER</h2>
        <p class="hint">Perubahan berlaku lokal — tekan <b>SIMPAN PROFIL</b> untuk mengirim ke robot (<code>{cmd:"save_profile"}</code>).</p>
        <button class="btn btn-save" id="btnSaveProfile">SIMPAN PROFIL<span class="dirty-dot"></span></button>
      </div>

      <div class="tuning-grid">
        <!-- COMBAT -->
        <div class="card tune t-combat">
          <h4>COMBAT</h4>
          <div class="srow">
            <label for="s_attackPwm">Kecepatan Attack <small>PWM %</small></label>
            <input type="range" id="s_attackPwm" data-key="attackPwm" data-unit="%" min="30" max="100" value="85">
            <output class="mono" id="o_attackPwm">85%</output>
          </div>
          <div class="srow">
            <label for="s_pushPwm">Daya Push <small>PWM %</small></label>
            <input type="range" id="s_pushPwm" data-key="pushPwm" data-unit="%" min="30" max="100" value="70">
            <output class="mono" id="o_pushPwm">70%</output>
          </div>
          <div class="srow">
            <label for="s_turnPwm">Kecepatan Turn / Search <small>PWM %</small></label>
            <input type="range" id="s_turnPwm" data-key="turnPwm" data-unit="%" min="20" max="100" value="55">
            <output class="mono" id="o_turnPwm">55%</output>
          </div>
          <div class="srow">
            <label for="s_dodgePwm">Dodge PWM <small>PWM %</small></label>
            <input type="range" id="s_dodgePwm" data-key="dodgePwm" data-unit="%" min="30" max="100" value="75">
            <output class="mono" id="o_dodgePwm">75%</output>
          </div>
        </div>

        <!-- REFLEX & SAFETY -->
        <div class="card tune t-reflex">
          <h4>REFLEX &amp; SAFETY</h4>
          <div class="srow">
            <label for="s_reflexPwm">Reflex Edge PWM <small>PWM %</small></label>
            <input type="range" id="s_reflexPwm" data-key="reflexPwm" data-unit="%" min="40" max="100" value="80">
            <output class="mono" id="o_reflexPwm">80%</output>
          </div>
          <div class="srow">
            <label for="s_edgeBackoffMs">Durasi Backoff Edge <small>ms</small></label>
            <input type="range" id="s_edgeBackoffMs" data-key="edgeBackoffMs" data-unit=" ms" min="50" max="500" step="10" value="220">
            <output class="mono" id="o_edgeBackoffMs">220 ms</output>
          </div>
          <div class="srow">
            <label for="s_pushbackPwm">Pushback PWM <small>PWM %</small></label>
            <input type="range" id="s_pushbackPwm" data-key="pushbackPwm" data-unit="%" min="30" max="100" value="60">
            <output class="mono" id="o_pushbackPwm">60%</output>
          </div>
          <div class="srow">
            <label for="s_tiltDeg">Ambang Tilt <small>derajat</small></label>
            <input type="range" id="s_tiltDeg" data-key="tiltDeg" data-unit="°" min="10" max="45" value="25">
            <output class="mono" id="o_tiltDeg">25°</output>
          </div>
          <div class="srow">
            <label for="s_accelRate">Accel Rate <small>%/s</small></label>
            <input type="range" id="s_accelRate" data-key="accelRate" data-unit=" %/s" min="2" max="100" value="12">
            <output class="mono" id="o_accelRate">12 %/s</output>
          </div>
        </div>

        <!-- START STRATEGY -->
        <div class="card tune t-start">
          <h4>START STRATEGY</h4>
          <div class="srow srow-sel">
            <label for="s_startMode">Strategi Awal</label>
            <select id="s_startMode" data-key="startMode">
              <option value="dash" selected>Dash Lurus</option>
              <option value="sweepL">Sapu Kiri</option>
              <option value="sweepR">Sapu Kanan</option>
              <option value="hold">Diam (Hold)</option>
            </select>
          </div>
          <div class="srow">
            <label for="s_startDelayMs">Delay Start <small>ms</small></label>
            <input type="range" id="s_startDelayMs" data-key="startDelayMs" data-unit=" ms" min="0" max="5000" step="100" value="1500">
            <output class="mono" id="o_startDelayMs">1500 ms</output>
          </div>
          <div class="srow">
            <label for="s_startDashPwm">Dash PWM <small>PWM %</small></label>
            <input type="range" id="s_startDashPwm" data-key="startDashPwm" data-unit="%" min="30" max="100" value="90">
            <output class="mono" id="o_startDashPwm">90%</output>
          </div>
          <div class="srow">
            <label for="s_startTurnMs">Durasi Sapu Awal <small>ms</small></label>
            <input type="range" id="s_startTurnMs" data-key="startTurnMs" data-unit=" ms" min="0" max="1000" step="50" value="400">
            <output class="mono" id="o_startTurnMs">400 ms</output>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================================================
       TAB 2 : BLACKBOX  (Flash + Kamera + Perekaman Sinkron)
  ============================================================= -->
  <section id="tab-blackbox" class="tabpage">
    <div class="bb-grid">

      <!-- STATUS FLASH -->
      <div class="card">
        <div class="card-head">
          <h3>STATUS FLASH (SPIFFS)</h3>
          <span class="rec-badge" id="recBadge"><svg class="ic"><use href="#i-rec"/></svg> REC</span>
        </div>
        <div class="kv"><span>File</span><b class="mono">/blackbox.csv</b></div>
        <div class="kv"><span>Baris terekam</span><b class="mono" id="flCount">0</b></div>
        <div class="kv"><span>Ukuran file</span><b class="mono" id="flSize">—</b></div>
        <div class="kv"><span>Chip terdeteksi</span><b class="mono" id="flHas">—</b></div>
        <div class="usage">
          <div class="usage-track"><div class="usage-fill" id="flFill"></div></div>
          <div class="usage-txt mono"><span id="flUsed">0 B</span> / <span id="flTotal">—</span> · sisa <span id="flFree">—</span></div>
        </div>
      </div>

      <!-- KAMERA -->
      <div class="card">
        <div class="card-head"><h3>KAMERA LAPTOP</h3></div>
        <div class="cam-row">
          <svg class="ic"><use href="#i-cam"/></svg>
          <select id="cameraSelect"><option value="">— Kamera belum diizinkan —</option></select>
          <button class="btn" id="btnCamEnable">Aktifkan</button>
        </div>
        <div class="cam-preview">
          <video id="cameraLivePreview" autoplay playsinline muted></video>
          <div class="cam-off" id="camOff">PREVIEW NONAKTIF</div>
          <span class="rec-dot" id="camRecDot">REC</span>
        </div>
      </div>

      <!-- PEREKAMAN MATCH -->
      <div class="card">
        <div class="card-head"><h3>PEREKAMAN MATCH</h3></div>
        <div class="rec-actions">
          <button class="btn btn-rec" id="btnLogStart"><svg class="ic"><use href="#i-rec"/></svg><span>MULAI REKAM</span></button>
          <button class="btn" id="btnLogStop" disabled><svg class="ic"><use href="#i-stop"/></svg><span>BERHENTI</span></button>
        </div>
        <div class="rec-note">Rekaman mengirim <code>{cmd:"log_start"}</code> ke robot lalu langsung merekam video kamera secara sinkron. Saat berhenti: <code>{cmd:"log_stop"}</code> + video disimpan lokal.</div>
        <div class="rec-count mono" id="recBuf">0 baris · 00:00.000</div>

        <div class="rec-ready hidden" id="recReady">
          <svg class="ic"><use href="#i-eye"/></svg>
          <div><b>Video match siap.</b><small>Replay tersinkron dengan telemetri blackbox.</small></div>
          <button class="btn btn-go" id="btnGoPreview">LIHAT PREVIEW &amp; REPLAY</button>
        </div>

        <hr class="rule"/>
        <div class="upload-row">
          <label class="btn" for="fileVideo"><svg class="ic"><use href="#i-up"/></svg><span>Unggah Video Sendiri</span></label>
          <input type="file" id="fileVideo" accept="video/*" hidden/>
          <span class="hint" id="fileVideoName">— untuk rekaman dari HP / kamera eksternal —</span>
        </div>

        <hr class="rule"/>
        <div class="flash-actions">
          <button class="btn" id="btnLogFetch"><svg class="ic"><use href="#i-down"/></svg><span>TARIK DATA</span></button>
          <button class="btn" id="btnCsv"><svg class="ic"><use href="#i-down"/></svg><span>DOWNLOAD CSV</span></button>
          <button class="btn btn-danger" id="btnLogClear"><svg class="ic"><use href="#i-trash"/></svg><span id="clearLabel">HAPUS FLASH</span></button>
        </div>
      </div>
    </div>
  </section>

  <!-- ============================================================
       TAB 3 : PREVIEW & REPLAY  (Split screen tersinkronisasi)
  ============================================================= -->
  <section id="tab-preview" class="tabpage">
    <div class="replay-bar card">
      <div class="rb-info">
        <h3>PREVIEW &amp; REPLAY</h3>
        <span class="mono hint" id="rpInfo">0 baris data · durasi 00:00.000</span>
      </div>
      <div class="rb-sync mono">
        <span>SYNC OFFSET</span>
        <button class="btn btn-xs" id="offMinus">−25 ms</button>
        <b id="offVal">0 ms</b>
        <button class="btn btn-xs" id="offPlus">+25 ms</button>
        <button class="btn btn-xs" id="offReset">reset</button>
      </div>
    </div>

    <div class="replay-split">
      <!-- KIRI : TELEMETRI -->
      <div class="replay-left card">
        <div class="card-head">
          <h3>TELEMETRI ROBOT</h3>
          <span class="sync-chip" id="syncChip">SYNC</span>
        </div>
        <div id="replayVizPanel" class="vizpanel"></div>
        <div class="vp-empty" id="rpEmpty">
          <svg class="ic"><use href="#i-warn"/></svg>
          <p>Belum ada data blackbox.<br>Rekam match di tab <b>BLACKBOX</b> atau tekan <b>TARIK DATA</b> dari flash.</p>
        </div>
      </div>

      <!-- KANAN : VIDEO -->
      <div class="replay-right card video-card">
        <div class="card-head">
          <h3>VIDEO FOOTAGE</h3>
          <span class="hint" id="vidName">— tanpa video —</span>
        </div>
        <div class="video-stage">
          <video id="replayVideo" playsinline></video>
          <div class="video-empty" id="videoEmpty">
            <svg class="ic"><use href="#i-cam"/></svg>
            <p>Belum ada video.<br>Rekam kamera dari tab BLACKBOX atau unggah file.</p>
            <label class="btn" for="fileVideo2">Pilih File Video</label>
            <input type="file" id="fileVideo2" accept="video/*" hidden/>
          </div>
        </div>
        <div class="vctrl">
          <button class="btn btn-icon" id="btnVPlay"><svg class="ic"><use href="#i-play"/></svg></button>
          <span class="mono vtime" id="vTime">00:00.000</span>
          <input type="range" id="vSeek" min="0" max="1000" value="0" step="1"/>
          <span class="mono vtime dim" id="vDur">00:00.000</span>
          <select id="vSpeed" class="sel-speed">
            <option value="0.25">0.25×</option>
            <option value="0.5">0.5×</option>
            <option value="1" selected>1.0×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2.0×</option>
          </select>
        </div>
      </div>
    </div>
  </section>
</main>

<div id="toasts"></div>
<script src="app.js"></script>
</body>
</html>





CSS:

/* ==========================================================
   SUMOBOT V1 STUDIO — Cyberpunk Dark Theme
   ========================================================== */
*{margin:0;padding:0;box-sizing:border-box}

:root{
  --bg0:#080c14; --bg1:#0d1424; --bg2:#131d33; --bg3:#1a2745;
  --line:rgba(0,243,255,.14); --line2:rgba(0,243,255,.28);
  --cyan:#00f3ff; --violet:#d946ef; --green:#10b981;
  --amber:#f59e0b; --red:#ef4444;
  --txt:#e6f1ff; --txt2:#8b98b8; --txt3:#5b688a;
  --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif;
}
html,body{height:100%}
body{
  font-family:var(--sans);color:var(--txt);font-size:14px;
  background:var(--bg0);
  background-image:
    linear-gradient(rgba(0,243,255,.03) 1px,transparent 1px),
    linear-gradient(90deg,rgba(0,243,255,.03) 1px,transparent 1px);
  background-size:36px 36px;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;
}
.mono{font-family:var(--mono)}
.hidden{display:none!important}
::selection{background:rgba(0,243,255,.25)}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:var(--bg0)}
::-webkit-scrollbar-thumb{background:var(--bg3);border-radius:5px;border:2px solid var(--bg0)}

/* ================= TOPBAR ================= */
.topbar{
  display:flex;align-items:center;gap:18px;flex-wrap:wrap;
  padding:10px 18px;position:sticky;top:0;z-index:50;
  background:rgba(8,12,20,.88);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);
}
.brand{display:flex;align-items:center;gap:10px}
.brand-ic{width:30px;height:30px;color:var(--cyan)}
.brand-txt b{font-weight:800;letter-spacing:.06em;font-size:15px}
.brand-txt b span{color:var(--cyan);margin-left:4px}
.brand-txt small{display:block;font-size:9px;letter-spacing:.34em;color:var(--txt3);font-weight:600}
.tabs{display:flex;gap:2px}
.tab{
  background:none;border:none;cursor:pointer;color:var(--txt2);
  font:600 12px var(--sans);letter-spacing:.14em;
  padding:10px 14px;border-bottom:2px solid transparent;transition:.15s;
}
.tab:hover{color:var(--txt)}
.tab.active{color:#fff;border-bottom-color:var(--cyan)}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.conn{display:flex;align-items:center;gap:6px}
.chips{display:flex;gap:4px}
.chip{font:700 9px var(--mono);letter-spacing:.08em;color:var(--txt3);border:1px solid var(--line);padding:3px 6px;border-radius:4px}
.chip.on{color:var(--cyan);border-color:rgba(0,243,255,.5);background:rgba(0,243,255,.08);box-shadow:0 0 8px rgba(0,243,255,.25)}
.matchctl{display:flex;align-items:center;gap:8px}

/* ================= TOMBOL ================= */
.btn{
  display:inline-flex;align-items:center;gap:7px;cursor:pointer;
  background:rgba(19,29,51,.7);border:1px solid var(--line2);color:var(--txt2);
  font:600 11px var(--sans);letter-spacing:.1em;text-transform:uppercase;
  padding:8px 12px;border-radius:6px;transition:.15s;
}
.btn:hover{color:var(--cyan);border-color:var(--cyan)}
.btn:active{transform:translateY(1px)}
.btn.active{color:var(--cyan);border-color:var(--cyan);background:rgba(0,243,255,.08)}
.btn:disabled{opacity:.35;pointer-events:none}
.btn .ic{width:14px;height:14px}
.btn-go{color:var(--green);border-color:rgba(16,185,129,.5)}
.btn-go:hover{color:#34d399;border-color:var(--green);background:rgba(16,185,129,.08)}
.btn-rec{color:var(--red);border-color:rgba(239,68,68,.5)}
.btn-rec:hover{color:#ff6b6b;border-color:var(--red);background:rgba(239,68,68,.07)}
.btn-danger:hover{color:var(--red);border-color:var(--red)}
.btn-danger.armed{background:var(--red);color:#fff;border-color:var(--red)}
.btn-save{color:var(--violet);border-color:rgba(217,70,239,.5);position:relative}
.btn-save:hover{color:#e879f9;border-color:var(--violet);background:rgba(217,70,239,.07)}
.btn-xs{padding:4px 8px;font-size:10px}
.btn-icon{padding:8px 10px}
.dirty-dot{width:7px;height:7px;border-radius:50%;background:var(--amber);display:none;margin-left:7px;box-shadow:0 0 6px var(--amber)}
.btn-save.dirty .dirty-dot{display:inline-block}
.estop{
  font:800 13px var(--sans);letter-spacing:.12em;color:#fff;background:var(--red);
  border:none;padding:12px 18px;cursor:pointer;transition:.12s;
  clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 4px 18px rgba(239,68,68,.35);
}
.estop:hover{background:#ff5b5b}
.estop:active{transform:scale(.95)}
body.estop-flash::after{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:300;
  box-shadow:inset 0 0 140px rgba(239,68,68,.6);animation:eflash .55s ease-out forwards;
}
@keyframes eflash{from{opacity:1}to{opacity:0}}

/* ================= LAYOUT & KARTU ================= */
main{padding:16px 18px 46px;max-width:1560px;margin:0 auto}
.tabpage{display:none}
.tabpage.active{display:block;animation:fadein .25s}
@keyframes fadein{from{opacity:0;transform:translateY(6px)}}
.card{
  position:relative;background:rgba(13,20,36,.72);border:1px solid var(--line);
  border-radius:10px;padding:14px 16px;backdrop-filter:blur(8px);
}
.card::before,.card::after{content:'';position:absolute;width:12px;height:12px;pointer-events:none;opacity:.55}
.card::before{top:-1px;left:-1px;border-top:2px solid var(--cyan);border-left:2px solid var(--cyan);border-top-left-radius:10px}
.card::after{bottom:-1px;right:-1px;border-bottom:2px solid var(--cyan);border-right:2px solid var(--cyan);border-bottom-right-radius:10px}
.card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.card-head h3{font-size:11px;font-weight:700;letter-spacing:.22em;color:var(--txt2);display:flex;align-items:center}
.card-head h3::before{content:'';display:inline-block;width:7px;height:7px;background:var(--cyan);margin-right:9px;clip-path:polygon(0 0,100% 50%,0 100%)}
.hint{color:var(--txt3);font-size:11px}
.hint code,.rec-note code{font-family:var(--mono);color:var(--cyan);font-size:10px}
.sep{width:1px;height:10px;background:var(--line2);display:inline-block;margin:0 8px}
.rule{border:none;border-top:1px dashed rgba(139,152,184,.2);margin:14px 0}

/* ================= PANEL VISUALISASI (dipakai LIVE & REPLAY) ================= */
.vp-tof{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 20px;margin-bottom:12px}
.tofbar{display:grid;grid-template-columns:24px 1fr 46px;align-items:center;gap:8px}
.tb-l{font:700 10px var(--mono);color:var(--txt2)}
.tb-t{height:8px;background:rgba(139,152,184,.12);border-radius:2px;overflow:hidden}
.tb-f{height:100%;width:0;background:rgba(0,243,255,.65);border-radius:2px;transition:width .12s linear}
.tofbar.hot .tb-f{background:var(--red);box-shadow:0 0 8px rgba(239,68,68,.7)}
.tofbar.hot .tb-v{color:#ff8fa0}
.tb-v{font:600 10px var(--mono);color:var(--txt3);text-align:right}

.vp-main{display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:14px}
.vp-stage{position:relative;background:rgba(8,12,20,.55);border:1px solid var(--line);border-radius:8px;overflow:hidden}
.vp-stage canvas{display:block;width:100%;aspect-ratio:1.2/1;max-height:600px}
.vp-badge{
  position:absolute;top:10px;left:10px;font:700 11px var(--mono);letter-spacing:.14em;
  padding:5px 10px;border:1px solid;border-radius:4px;background:rgba(8,12,20,.72);
}
.vp-clock{
  position:absolute;top:10px;right:10px;font:600 12px var(--mono);color:var(--txt2);
  background:rgba(8,12,20,.72);padding:5px 9px;border-radius:4px;border:1px solid var(--line);
}
.vp-legend{position:absolute;bottom:8px;left:10px;display:flex;gap:12px;font:500 9px var(--mono);color:var(--txt3);letter-spacing:.05em}
.vp-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}

.vp-side{display:flex;flex-direction:column;gap:10px}
.vp-block{background:rgba(8,12,20,.45);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.vp-block h4{font:700 9px var(--sans);letter-spacing:.24em;color:var(--txt3);margin-bottom:8px}

/* Drive / PWM */
.pwm-wrap{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:end}
.pwm-unit{display:flex;flex-direction:column;align-items:center;gap:5px}
.pwm-track{position:relative;width:26px;height:86px;background:rgba(139,152,184,.1);border:1px solid var(--line);border-radius:4px;overflow:hidden}
.pwm-mid{position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(139,152,184,.35)}
.pwm-fill{position:absolute;left:2px;right:2px;background:var(--cyan);border-radius:2px}
.pwm-fill.neg{background:var(--amber)}
.pwm-val{font:600 11px var(--mono);color:var(--txt)}
.pwm-unit label{font:700 8px var(--sans);letter-spacing:.16em;color:var(--txt3)}
.move-ind{display:flex;flex-direction:column;align-items:center;gap:2px;padding-bottom:6px}
.move-arrow{font-size:26px;line-height:1;color:var(--txt2);display:inline-block;transition:transform .12s}
.move-desc{font:600 9px var(--mono);letter-spacing:.08em;color:var(--txt3);white-space:nowrap}
.accel-row{margin-top:9px;font:600 10px var(--mono);color:var(--txt3);display:flex;justify-content:space-between}
.accel-row b{color:var(--txt)}

/* IMU mini */
.imu-duo{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.imu-mini{display:flex;flex-direction:column;align-items:center;gap:4px}
.imu-stage{position:relative;width:100%;height:56px;background:rgba(0,243,255,.03);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.horizon{position:absolute;left:6%;right:6%;top:50%;height:1px;background:rgba(139,152,184,.3)}
.mini-bot{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);transition:transform .1s}
.mini-bot.front{width:36px;height:24px;background:rgba(19,29,51,.95);border:1.5px solid rgba(0,243,255,.55);border-radius:3px}
.mini-bot.front::before{content:'';position:absolute;left:6px;right:6px;top:-5px;height:4px;background:rgba(245,158,11,.8);border-radius:1px}
.mini-bot.front::after{content:'';position:absolute;bottom:-4px;left:3px;width:5px;height:5px;background:#2a3a63;box-shadow:25px 0 0 #2a3a63}
.mini-bot.side{width:44px;height:18px;background:#16233f;clip-path:polygon(0 100%,16% 0,100% 0,100% 100%)}
.mini-bot.side::after{content:'';position:absolute;left:0;right:0;top:0;height:2px;background:rgba(0,243,255,.5)}
.imu-mini label{font:700 8px var(--sans);letter-spacing:.2em;color:var(--txt3)}
.imu-mini b{font:600 11px var(--mono);color:var(--txt2)}
.tilt-badge{
  display:none;margin-top:9px;align-items:center;gap:7px;justify-content:center;
  font:800 10px var(--sans);letter-spacing:.14em;color:#fff;background:var(--red);
  padding:6px;border-radius:5px;animation:tiltblink .5s steps(2) infinite;
}
.tilt-badge.on{display:flex}
.tilt-badge .ic{width:13px;height:13px}
@keyframes tiltblink{50%{background:#b91c1c}}

/* Edge IR chips */
.edge-chips{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.edge-chip{
  font:700 10px var(--mono);text-align:center;padding:6px 0;border-radius:4px;
  color:var(--txt3);background:rgba(16,185,129,.07);border:1px solid rgba(16,185,129,.25);
}
.edge-chip.on{
  color:#ff5b6e;border-color:rgba(239,68,68,.6);background:rgba(239,68,68,.12);
  box-shadow:0 0 10px rgba(239,68,68,.4);animation:chipblink .4s steps(2) infinite;
}
@keyframes chipblink{50%{background:rgba(239,68,68,.28)}}

/* Statistik link */
.live-stats{font-size:10px;color:var(--txt3);display:flex;align-items:center}
.live-stats .ok{color:var(--green)}

/* ================= TUNING ================= */
.tuning{margin-top:18px}
.tuning-head{display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap}
.tuning-head h2{font-size:13px;letter-spacing:.2em;display:flex;align-items:center;gap:8px}
.tuning-head h2 .ic{width:16px;height:16px;color:var(--violet)}
.tuning-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.tune h4{font:700 10px var(--sans);letter-spacing:.22em;margin-bottom:12px}
.t-combat h4{color:var(--cyan)}
.t-reflex h4{color:var(--amber)}
.t-start h4{color:var(--violet)}
.srow{display:grid;grid-template-columns:1fr 64px;gap:4px 10px;align-items:center;margin-bottom:12px}
.srow label{grid-column:1/-1;font-size:11px;color:var(--txt2);display:flex;justify-content:space-between;align-items:baseline}
.srow label small{color:var(--txt3);font:500 9px var(--mono)}
.srow output{font:600 11px var(--mono);color:var(--cyan);text-align:right}
.srow-sel{grid-template-columns:1fr}
.srow-sel select{width:100%;margin-top:2px}
input[type=range]{-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:rgba(139,152,184,.18);outline:none;cursor:pointer;width:100%}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:3px;background:var(--cyan);box-shadow:0 0 8px rgba(0,243,255,.6);cursor:pointer;border:none}
input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:3px;background:var(--cyan);box-shadow:0 0 8px rgba(0,243,255,.6);cursor:pointer;border:none}
select{
  background:var(--bg2);border:1px solid var(--line2);color:var(--txt);
  font:500 11px var(--sans);padding:7px 9px;border-radius:6px;outline:none;cursor:pointer;
}
select:focus{border-color:var(--cyan)}

/* ================= BLACKBOX ================= */
.bb-grid{display:grid;grid-template-columns:1.05fr 1fr 1.15fr;gap:14px;align-items:start}
.kv{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(139,152,184,.15);font-size:11px;color:var(--txt3)}
.kv b{color:var(--txt);font-weight:600;font-size:11px}
.usage{margin-top:12px}
.usage-track{height:10px;background:rgba(139,152,184,.12);border-radius:3px;overflow:hidden;border:1px solid var(--line)}
.usage-fill{height:100%;width:0;background:var(--green);transition:width .3s}
.usage-txt{margin-top:6px;font-size:10px;color:var(--txt3)}
.cam-row{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.cam-row .ic{width:16px;height:16px;color:var(--txt2);flex:none}
.cam-row select{flex:1;min-width:0}
.cam-preview{position:relative;background:#000;border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:16/10}
.cam-preview video{width:100%;height:100%;object-fit:cover;display:block}
.cam-off{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font:600 10px var(--mono);letter-spacing:.22em;color:var(--txt3);
  background:repeating-linear-gradient(-45deg,rgba(139,152,184,.05) 0 8px,transparent 8px 16px);
}
.rec-dot{
  position:absolute;top:8px;right:8px;font:800 9px var(--mono);letter-spacing:.1em;
  color:#fff;background:var(--red);padding:3px 7px;border-radius:3px;display:none;
}
.rec-dot.on{display:block;animation:recblink 1s steps(2) infinite}
@keyframes recblink{50%{opacity:.25}}
.rec-badge{display:none;align-items:center;gap:6px;font:800 10px var(--mono);letter-spacing:.1em;color:#fff;background:var(--red);padding:4px 9px;border-radius:4px}
.rec-badge.on{display:inline-flex;animation:recblink 1s steps(2) infinite}
.rec-badge .ic{width:11px;height:11px}
.rec-actions{display:flex;gap:10px;margin-bottom:10px}
.rec-actions .btn{flex:1;justify-content:center;padding:12px}
.rec-note{font-size:11px;color:var(--txt3);line-height:1.55}
.rec-count{margin-top:8px;font:600 11px var(--mono);color:var(--txt2)}
.rec-ready{
  display:flex;align-items:center;gap:12px;margin-top:12px;padding:12px;
  border:1px solid rgba(16,185,129,.4);background:rgba(16,185,129,.07);border-radius:8px;
}
.rec-ready .ic{width:22px;height:22px;color:var(--green);flex:none}
.rec-ready b{display:block;font-size:12px}
.rec-ready small{color:var(--txt3);font-size:10px}
.rec-ready .btn{margin-left:auto;flex:none}
.upload-row,.flash-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}

/* ================= PREVIEW & REPLAY ================= */
.replay-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px;flex-wrap:wrap;padding:12px 16px}
.rb-info h3{font-size:12px;letter-spacing:.18em;margin-bottom:2px}
.rb-sync{display:flex;align-items:center;gap:8px;font-size:10px;color:var(--txt3);letter-spacing:.1em}
.rb-sync b{color:var(--cyan);min-width:56px;text-align:center}
.replay-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px;align-items:start}
.replay-left{position:relative}
.vp-empty{
  position:absolute;inset:46px 16px 16px;z-index:5;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  text-align:center;color:var(--txt3);font-size:12px;line-height:1.7;
  background:rgba(8,12,20,.85);border:1px dashed var(--line2);border-radius:8px;
}
.vp-empty .ic{width:26px;height:26px;color:var(--amber)}
.video-stage{position:relative;background:#000;border:1px solid var(--line);border-radius:8px;overflow:hidden;aspect-ratio:16/9}
.video-stage video{width:100%;height:100%;object-fit:contain;display:block;background:#000}
.video-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  color:var(--txt3);font-size:12px;text-align:center;line-height:1.6;
  background:repeating-linear-gradient(-45deg,rgba(139,152,184,.05) 0 10px,transparent 10px 20px);
}
.video-empty .ic{width:30px;height:30px;color:var(--txt2)}
.vctrl{display:flex;align-items:center;gap:10px;margin-top:12px}
.vtime{font-size:11px}
.vtime.dim{color:var(--txt3)}
#vSeek{flex:1}
.sel-speed{width:76px;flex:none}
.sync-chip{font:700 9px var(--mono);letter-spacing:.12em;padding:3px 8px;border-radius:3px;border:1px solid var(--line);color:var(--txt3)}
.sync-chip.live{color:var(--green);border-color:rgba(16,185,129,.5);animation:recblink 1s steps(2) infinite}

/* ================= TOAST ================= */
#toasts{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:200}
.toast{
  background:rgba(13,20,36,.95);border:1px solid var(--line2);border-left:3px solid var(--cyan);
  color:var(--txt);font-size:12px;padding:10px 14px;border-radius:6px;max-width:340px;
  opacity:0;transform:translateX(16px);transition:.25s;backdrop-filter:blur(8px);
}
.toast.in{opacity:1;transform:none}
.toast.ok{border-left-color:var(--green)}
.toast.warn{border-left-color:var(--amber)}
.toast.err{border-left-color:var(--red)}

/* ================= RESPONSIVE ================= */
@media(max-width:1240px){
  .bb-grid{grid-template-columns:1fr 1fr}
  .bb-grid .card:nth-child(3){grid-column:1/-1}
}
@media(max-width:980px){
  .replay-split{grid-template-columns:1fr}
  .vp-main{grid-template-columns:1fr}
  .vp-side{flex-direction:row;flex-wrap:wrap}
  .vp-side .vp-block{flex:1 1 210px}
  .bb-grid{grid-template-columns:1fr}
  .bb-grid .card:nth-child(3){grid-column:auto}
}
@media(max-width:640px){
  .topbar{gap:10px;padding:10px 12px}
  .tabs{order:3;width:100%;border-top:1px solid var(--line);padding-top:4px}
  .vp-tof{grid-template-columns:1fr 1fr}
  .replay-bar{flex-direction:column;align-items:flex-start}
}



App.js:
'use strict';
/* ============================================================
   SUMOBOT V1 STUDIO — app.js
   Transport : Web Bluetooth NUS + Web Serial 115200 (+ Simulasi)
   Modul     : Live Telemetry, Tuning, Blackbox+Kamera, Replay Sync
   ============================================================ */

/* ---------------- 1. UTIL ---------------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmtMs(t){
  t = Math.max(0, t | 0);
  const m = (t / 60000) | 0, s = ((t % 60000) / 1000) | 0, ms = t % 1000;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
}
function fmtBytes(b){
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}
function hexA(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;
}
function toast(msg, type = 'info', ms = 3200){
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  $('#toasts').appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 300); }, ms);
}

/* ---------------- 2. KONSTANTA PROTOKOL ---------------- */
const STATES = [
  { name:'WAIT',   c:'#8b98b8' }, // 0
  { name:'DODGE',  c:'#d946ef' }, // 1
  { name:'SEARCH', c:'#00f3ff' }, // 2
  { name:'TRACK',  c:'#f59e0b' }, // 3
  { name:'ATTACK', c:'#ef4444' }, // 4
  { name:'EDGE',   c:'#ff7a45' }, // 5
  { name:'PUSH',   c:'#10b981' }, // 6
  { name:'TILT',   c:'#ff3b5c' }, // 7
  { name:'TEST',   c:'#60a5fa' }  // 8
];
const TOF_CH   = ['FL','FC','FR','ML','MR','RR'];
const TOF_ANGLE = [-30, 0, 30, -90, 90, 180].map(d => d * Math.PI / 180);
const EDGE_POS = ['FL','FR','BL','BR'];
const DEFROW = { t:0, st:0, pl:0, pr:0, em:0, tof:[1150,1150,1150,1100,1100,1200], pit:0, rol:0, acc:0 };

const NUS_SVC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // client menulis ke sini
const NUS_RX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // client subscribe notifikasi

/* ---------------- 3. STATE GLOBAL ---------------- */
const link = { mode:null, bleDev:null, bleTx:null, serialPort:null, serialWriter:null };
let rxBuf = '';
let pktCount = 0, pktWindow = 0, lastPktAt = 0, hzLast = performance.now();
const blackboxRows = [];              // buffer baris hasil konversi (live capture + log_fetch)
let captureActive = false;            // sedang merekam -> baris masuk ke buffer
let fetching      = false;            // sedang menarik data dari flash
let loggingActive = false;
let cntDirty = false, lastCnt = 0;

function convertRow(a){
  return {
    t: a[0]|0, st: a[1]|0, pl: a[2]|0, pr: a[3]|0, em: a[4]|0,
    tof: [a[5], a[6], a[7], a[8], a[9], a[10]],
    pit: (a[11]||0)/10, rol: (a[12]||0)/10, acc: (a[13]||0)/100
  };
}

/* ---------------- 4. TRANSPORT ---------------- */
function feedLine(line){
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  handleMsg(msg);
}
function feedChunk(text){
  rxBuf += text;
  let i;
  while ((i = rxBuf.indexOf('\n')) >= 0){ feedLine(rxBuf.slice(0, i)); rxBuf = rxBuf.slice(i + 1); }
}
function onWireText(t){ pktCount++; lastPktAt = performance.now(); feedChunk(t); }

function setLink(mode){
  link.mode = mode;
  $('#chipBle').classList.toggle('on',   mode === 'ble');
  $('#chipSer').classList.toggle('on',   mode === 'serial');
  $('#chipSim').classList.toggle('on',   mode === 'sim');
  $('#btnBle').classList.toggle('active',   mode === 'ble');
  $('#btnSerial').classList.toggle('active', mode === 'serial');
  $('#btnSim').classList.toggle('active',   mode === 'sim');
}

/* ---- Web Bluetooth (NUS) ---- */
async function bleConnect(){
  try{
    if (!navigator.bluetooth) throw new Error('Browser tidak mendukung Web Bluetooth');
    const dev = await navigator.bluetooth.requestDevice({ filters:[{ services:[NUS_SVC] }] });
    dev.addEventListener('gattserverdisconnected', () => bleCleanup());
    toast('Menghubungkan BLE…');
    const gatt = await dev.gatt.connect();
    const svc  = await gatt.getPrimaryService(NUS_SVC);
    link.bleTx = await svc.getCharacteristic(NUS_TX);
    const rx   = await svc.getCharacteristic(NUS_RX);
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged',
      e => onWireText(new TextDecoder().decode(e.target.value)));
    link.bleDev = dev;
    setLink('ble');
    toast('BLE terhubung: ' + (dev.name || 'NUS Device'), 'ok');
  } catch(e){ toast('BLE gagal: ' + e.message, 'err'); }
}
function bleCleanup(){
  link.bleDev = null; link.bleTx = null;
  if (link.mode === 'ble'){ setLink(null); toast('BLE terputus', 'warn'); }
}

/* ---- Web Serial 115200 ---- */
async function serialConnect(){
  try{
    if (!navigator.serial) throw new Error('Browser tidak mendukung Web Serial');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    link.serialPort = port;
    link.serialWriter = await port.writable.getWriter();
    setLink('serial');
    toast('Serial 115200 terhubung', 'ok');
    readSerialLoop(port);
  } catch(e){ toast('Serial gagal: ' + e.message, 'err'); }
}
async function readSerialLoop(port){
  const dec = new TextDecoder();
  try{
    while (port.readable && link.serialPort === port){
      const reader = port.readable.getReader();
      try{
        while (true){
          const { value, done } = await reader.read();
          if (done) break;
          if (value) onWireText(dec.decode(value, { stream:true }));
        }
      } finally { reader.releaseLock(); }
    }
  } catch(e){ console.warn(e); }
  if (link.mode === 'serial'){ setLink(null); toast('Serial terputus', 'warn'); }
}
async function serialDisconnect(){
  setLink(null);
  try { link.serialWriter && link.serialWriter.releaseLock(); } catch {}
  try { await link.serialPort.close(); } catch {}
  link.serialPort = null; link.serialWriter = null;
  toast('Serial diputus', 'info');
}

/* ---- Pengirim perintah JSON ---- */
const wireEnc = new TextEncoder();
function sendCmd(obj){
  const s = JSON.stringify(obj) + '\n';
  if (link.mode === 'ble' && link.bleTx){
    const bytes = wireEnc.encode(s);
    const p = link.bleTx.properties;
    const pr = p.writeWithoutResponse ? link.bleTx.writeValueWithoutResponse(bytes)
                                      : link.bleTx.writeValue(bytes);
    if (pr && pr.catch) pr.catch(() => {});
    return true;
  }
  if (link.mode === 'serial' && link.serialWriter){
    try { link.serialWriter.write(wireEnc.encode(s)); return true; }
    catch(e){ toast('Serial write gagal', 'err'); return false; }
  }
  if (link.mode === 'sim'){ sim.cmd(obj); return true; }
  toast('Tidak ada koneksi aktif — hubungkan robot / aktifkan Simulasi', 'warn');
  return false;
}

/* ---------------- 5. ROUTER PESAN ---------------- */
function handleMsg(m){
  lastPktAt = performance.now();
  if (m.t === 'log_data' && Array.isArray(m.rows)){
    pktWindow += m.rows.length;
    for (const r of m.rows){
      const row = convertRow(r);
      livePanel.setRow(row);
      if (captureActive || fetching) blackboxRows.push(row);
    }
    cntDirty = true;
  } else if (m.t === 'log_status'){
    applyLogStatus(m);
  }
}

function applyLogStatus(m){
  $('#flCount').textContent = (m.count ?? 0);
  $('#flHas').textContent   = m.hasFlash ? 'TERDETEKSI' : 'TIDAK ADA';
  $('#flTotal').textContent = fmtBytes(m.totalBytes);
  $('#flUsed').textContent  = fmtBytes(m.usedBytes);
  $('#flFree').textContent  = fmtBytes(m.freeBytes);
  $('#flSize').textContent  = fmtBytes(m.fileSize);
  $('#flFill').style.width  = (m.totalBytes ? clamp(m.usedBytes/m.totalBytes*100, 0, 100) : 0) + '%';
  $('#recBadge').classList.toggle('on', !!m.recording || loggingActive);
  $('#btnLogFetch').disabled = !m.hasFlash;
  // Selesai menarik data?
  if (fetching && !m.recording && m.count > 0 && blackboxRows.length >= m.count){
    fetching = false;
    toast('Blackbox diterima: ' + m.count + ' baris — siap replay', 'ok');
    refreshCounters();
  }
}

/* ============================================================
   6. CHASSIS VISUALIZER (Canvas 2D — dipakai Live & Replay)
   ============================================================ */
function rr(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
function arrowHead(ctx, x, y, dir, col, s){
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s * .7, s * .6); ctx.lineTo(-s * .7, s * .6);
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.restore();
}

class ChassisViz{
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.row = null; this.dpr = 1;
    new ResizeObserver(() => this.fit()).observe(canvas);
    this.fit();
  }
  fit(){
    const r = this.cv.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width  = Math.round(r.width  * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
  }
  render(now){
    const cv = this.cv, ctx = this.ctx, W = cv.width, H = cv.height;
    if (W < 20) return;
    const w = W / this.dpr, h = H / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2, unit = Math.min(w, h) / 2 * 0.94;
    const r = this.row || DEFROW;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);

    // ---- Arena (lintasan persegi + grid) ----
    ctx.strokeStyle = 'rgba(0,243,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 6; i++){
      const p = cy - unit + unit * 2 * i / 6, q = cx - unit + unit * 2 * i / 6;
      ctx.moveTo(cx - unit, p); ctx.lineTo(cx + unit, p);
      ctx.moveTo(q, cy - unit); ctx.lineTo(q, cy + unit);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,243,255,.12)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - unit, cy - unit, unit * 2, unit * 2);

    const HW = unit * 0.30, HH = unit * 0.385; // setengah dimensi sasis
    this.drawCones(ctx, cx, cy, unit, r, pulse);
    this.drawEdges(ctx, cx, cy, HW, HH, r, pulse, now);
    this.drawBody(ctx, cx, cy, HW, HH, r);
    this.drawMotion(ctx, cx, cy, unit, r);
  }
  /* 6 kerucut ToF */
  drawCones(ctx, cx, cy, unit, r, pulse){
    const spread = 0.24, r0 = unit * 0.34;
    for (let i = 0; i < 6; i++){
      const a = TOF_ANGLE[i];
      const v = r.tof[i] ?? 1200;
      const det = v > 0 && v <= 400;                       // musuh terdeteksi
      const len = det ? clamp(v/400, .18, 1) * unit * .55 : unit * .40;
      const px = cx + Math.sin(a) * r0,        py = cy - Math.cos(a) * r0;
      const x1 = cx + Math.sin(a-spread)*(r0+len), y1 = cy - Math.cos(a-spread)*(r0+len);
      const x2 = cx + Math.sin(a+spread)*(r0+len), y2 = cy - Math.cos(a+spread)*(r0+len);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      if (det){
        ctx.fillStyle = `rgba(239,68,68,${0.14 + 0.10 * pulse})`; ctx.fill();
        ctx.strokeStyle = 'rgba(255,80,90,.9)'; ctx.lineWidth = 1.4;
        ctx.shadowColor = 'rgba(239,68,68,.8)'; ctx.shadowBlur = 10;
        ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffb3ba';
        ctx.font = '600 11px "JetBrains Mono",monospace'; ctx.textAlign = 'center';
        ctx.fillText(String(Math.round(v)),
          cx + Math.sin(a) * (r0 + len + 16), cy - Math.cos(a) * (r0 + len + 16) + 4);
      } else {
        ctx.fillStyle = 'rgba(0,243,255,.045)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,243,255,.20)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  /* 4 sensor IR tepi di sudut */
  drawEdges(ctx, cx, cy, HW, HH, r, pulse, now){
    const pts = [[-.92,-.92,'FL'],[.92,-.92,'FR'],[-.92,.92,'BL'],[.92,.92,'BR']];
    for (let i = 0; i < 4; i++){
      const [fx, fy, name] = pts[i];
      const x = cx + fx * HW, y = cy + fy * HH;
      const on = !!(r.em & (1 << i));
      if (on){
        ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 16 * pulse + 4;
        ctx.fillStyle = '#ff3b5c';
        ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        const p = (now / 900) % 1;                       // cincin mengembang
        ctx.strokeStyle = `rgba(255,59,92,${(1 - p) * .6})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 5 + p * 13, 0, 7); ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(16,185,129,.5)';
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = on ? '#ff8fa0' : 'rgba(139,152,184,.85)';
      ctx.font = '600 10px "JetBrains Mono",monospace'; ctx.textAlign = 'center';
      ctx.fillText(name, x + (fx < 0 ? -14 : 14), y + (fy < 0 ? -8 : 15));
    }
  }
  /* sasis + blade + roda */
  drawBody(ctx, cx, cy, HW, HH, r){
    const st = STATES[r.st] || STATES[0];
    ctx.fillStyle = '#1c2a4a'; ctx.strokeStyle = 'rgba(0,243,255,.25)'; ctx.lineWidth = 1;
    for (const s of [-1, 1]){                            // roda kiri/kanan
      rr(ctx, cx + s * HW + (s < 0 ? -10 : 2), cy - HH * .55, 8, HH * 1.1, 2);
      ctx.fill(); ctx.stroke();
    }
    rr(ctx, cx - HW, cy - HH, HW * 2, HH * 2, 7);        // dek utama
    ctx.fillStyle = 'rgba(13,20,36,.92)'; ctx.fill();
    ctx.strokeStyle = st.c; ctx.globalAlpha = .55; ctx.lineWidth = 1.6;
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath();                                     // blade depan
    ctx.moveTo(cx - HW + 2, cy - HH + 1);
    ctx.lineTo(cx - HW * 1.22, cy - HH - 9);
    ctx.lineTo(cx + HW * 1.22, cy - HH - 9);
    ctx.lineTo(cx + HW - 2, cy - HH + 1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,158,11,.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(245,158,11,.75)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath();                                     // penanda arah hadap
    ctx.moveTo(cx, cy - HH * .55); ctx.lineTo(cx - 5, cy - HH * .32); ctx.lineTo(cx + 5, cy - HH * .32);
    ctx.closePath(); ctx.fillStyle = 'rgba(0,243,255,.6)'; ctx.fill();
  }
  /* panah vektor gerak dari pwmL/pwmR */
  drawMotion(ctx, cx, cy, unit, r){
    const pl = r.pl || 0, pr = r.pr || 0;
    const v = (pl + pr) / 2, wR = (pr - pl) / 2;
    const av = Math.abs(v), aw = Math.abs(wR);
    if (av < 6 && aw < 6){                               // diam
      ctx.strokeStyle = 'rgba(139,152,184,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.stroke(); return;
    }
    if (av < 12 && aw >= 12){                            // putar di tempat
      const cw = wR < 0;                                 // pwm kanan > kiri -> belok kiri (CCW)
      const R = unit * .17, a0 = -Math.PI * .5, span = Math.PI * 1.45;
      ctx.strokeStyle = '#00f3ff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,243,255,.7)'; ctx.shadowBlur = 8;
      ctx.beginPath();
      if (cw) ctx.arc(cx, cy, R, a0, a0 + span, false);
      else    ctx.arc(cx, cy, R, a0, a0 - span, true);
      ctx.stroke(); ctx.shadowBlur = 0;
      const ae = cw ? a0 + span : a0 - span;
      arrowHead(ctx, cx + Math.cos(ae) * R, cy + Math.sin(ae) * R,
                ae + (cw ? Math.PI/2 : -Math.PI/2), '#00f3ff', 8);
      return;
    }
    const fwd = v > 0;
    const ang = clamp(-wR * 1.4, -75, 75) * Math.PI / 180;
    const L = unit * (0.16 + Math.min(av, 100) / 100 * 0.26);
    const col = fwd ? (av > 70 ? '#ef4444' : '#10b981') : '#f59e0b';
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang + (fwd ? 0 : Math.PI));
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, L * .55); ctx.lineTo(0, -L * .45); ctx.stroke();
    arrowHead(ctx, 0, -L * .45, -Math.PI / 2, col, 9);
    ctx.restore(); ctx.shadowBlur = 0;
  }
}

/* ============================================================
   7. VIZ PANEL (DOM + Canvas) — template dipakai ulang
   ============================================================ */
function setPwm(fillEl, val){
  const p = clamp(Math.abs(val), 0, 100) / 2;
  if (val >= 0){ fillEl.style.top='auto'; fillEl.style.bottom='50%'; fillEl.classList.remove('neg'); }
  else         { fillEl.style.bottom='auto'; fillEl.style.top='50%'; fillEl.classList.add('neg'); }
  fillEl.style.height = p + '%';
}
const pct = v => (v > 0 ? '+' : '') + Math.round(v) + '%';

class VizPanel{
  constructor(root){
    this.root = root;
    root.innerHTML = this.tpl();
    this.viz = new ChassisViz($('canvas', root));
    this.ui = {
      badge:  $('.vp-badge', root),  clock: $('.vp-clock', root),
      tofBars:$$('.tofbar', root),
      pwmL:   $('.pu-l .pwm-fill', root), pwmR:  $('.pu-r .pwm-fill', root),
      pwmLv:  $('.pu-l .pwm-val',  root), pwmRv: $('.pu-r .pwm-val',  root),
      arrow:  $('.move-arrow', root),     desc:  $('.move-desc', root),
      acc:    $('.accel', root),
      rollBox: $('.mini-bot.front', root), pitchBox: $('.mini-bot.side', root),
      rollVal:$('.rv', root), pitchVal:$('.pv', root),
      tilt:   $('.tilt-badge', root),
      edgeChips: $$('.edge-chip', root)
    };
  }
  tpl(){
    const bars = TOF_CH.map(n => `
      <div class="tofbar">
        <span class="tb-l">${n}</span>
        <div class="tb-t"><div class="tb-f"></div></div>
        <span class="tb-v mono">---</span>
      </div>`).join('');
    const chips = EDGE_POS.map(n => `<span class="edge-chip">${n}</span>`).join('');
    return `
    <div class="vp-tof">${bars}</div>
    <div class="vp-main">
      <div class="vp-stage">
        <canvas></canvas>
        <div class="vp-badge">IDLE</div>
        <div class="vp-clock">00:00.000</div>
        <div class="vp-legend">
          <span><i style="background:#ff3b5c"></i>DETEKSI / EDGE</span>
          <span><i style="background:rgba(16,185,129,.6)"></i>IR AMAN</span>
          <span><i style="background:rgba(0,243,255,.5)"></i>CLEAR</span>
        </div>
      </div>
      <div class="vp-side">
        <div class="vp-block">
          <h4>DRIVE</h4>
          <div class="pwm-wrap">
            <div class="pwm-unit pu-l">
              <div class="pwm-track"><div class="pwm-mid"></div><div class="pwm-fill"></div></div>
              <span class="pwm-val mono">+0%</span><label>MOTOR KIRI</label>
            </div>
            <div class="move-ind">
              <span class="move-arrow">•</span><span class="move-desc">DIAM</span>
            </div>
            <div class="pwm-unit pu-r">
              <div class="pwm-track"><div class="pwm-mid"></div><div class="pwm-fill"></div></div>
              <span class="pwm-val mono">+0%</span><label>MOTOR KANAN</label>
            </div>
          </div>
          <div class="accel-row"><span>ACCEL</span><span><b class="accel">0.00</b> G</span></div>
        </div>
        <div class="vp-block">
          <h4>IMU TILT</h4>
          <div class="imu-duo">
            <div class="imu-mini">
              <div class="imu-stage"><div class="horizon"></div><div class="mini-bot front"></div></div>
              <label>ROLL</label><b class="mono rv">0.0°</b>
            </div>
            <div class="imu-mini">
              <div class="imu-stage"><div class="horizon"></div><div class="mini-bot side"></div></div>
              <label>PITCH</label><b class="mono pv">0.0°</b>
            </div>
          </div>
          <div class="tilt-badge"><svg class="ic"><use href="#i-warn"/></svg> TILT DETECTED</div>
        </div>
        <div class="vp-block">
          <h4>EDGE IR</h4>
          <div class="edge-chips">${chips}</div>
        </div>
      </div>
    </div>`;
  }
  setRow(row){
    if (!row) return;
    const u = this.ui;
    const st = STATES[row.st] || STATES[0];
    u.badge.textContent = st.name;
    u.badge.style.color = st.c;
    u.badge.style.borderColor = st.c;
    u.badge.style.background = hexA(st.c, .12);
    u.clock.textContent = fmtMs(row.t);

    row.tof.forEach((v, i) => {
      const b = u.tofBars[i];
      const vv = clamp(+v || 0, 0, 1200);
      b.classList.toggle('hot', vv <= 400);
      $('.tb-f', b).style.width = (vv / 1200 * 100).toFixed(1) + '%';
      $('.tb-v', b).textContent = Math.round(vv);
    });

    setPwm(u.pwmL, row.pl); setPwm(u.pwmR, row.pr);
    u.pwmLv.textContent = pct(row.pl); u.pwmRv.textContent = pct(row.pr);

    // Arah gerak
    const v = (row.pl + row.pr) / 2, w = (row.pr - row.pl) / 2;
    const av = Math.abs(v), aw = Math.abs(w);
    let glyph = '•', rot = 0, desc = 'DIAM', col = '#8b98b8';
    if (!(av < 6 && aw < 6)){
      if (av < 12 && aw >= 12){
        glyph = w > 0 ? '↺' : '↻';
        desc  = 'PUTAR ' + (w > 0 ? 'KIRI' : 'KANAN');
        col   = '#00f3ff';
      } else {
        const fwd = v > 0;
        rot = -w * 1.2 + (fwd ? 0 : 180);
        glyph = '↑';
        if (fwd){
          col = av > 70 ? '#ef4444' : '#10b981';
          desc = aw < 10 ? (av > 70 ? 'ATTACK' : 'MAJU')
                         : (w > 0 ? 'SERONG KIRI' : 'SERONG KANAN');
        } else {
          col = '#f59e0b';
          desc = aw < 10 ? 'MUNDUR' : 'MUNDUR ' + (w > 0 ? 'KIRI' : 'KANAN');
        }
      }
    }
    u.arrow.textContent = glyph;
    u.arrow.style.transform = `rotate(${rot}deg)`;
    u.arrow.style.color = col;
    u.desc.textContent = desc; u.desc.style.color = col;
    u.acc.textContent = row.acc.toFixed(2);

    // IMU
    u.rollBox.style.transform  = `translate(-50%,-50%) rotate(${clamp(row.rol, -45, 45)}deg)`;
    u.pitchBox.style.transform = `translate(-50%,-50%) rotate(${clamp(-row.pit, -45, 45)}deg)`;
    u.rollVal.textContent  = (row.rol > 0 ? '+' : '') + row.rol.toFixed(1) + '°';
    u.pitchVal.textContent = (row.pit > 0 ? '+' : '') + row.pit.toFixed(1) + '°';
    u.tilt.classList.toggle('on', Math.abs(row.pit) > 15 || Math.abs(row.rol) > 15);

    // IR edge chips (bit0 FL, bit1 FR, bit2 BL, bit3 BR)
    u.edgeChips.forEach((c, i) => c.classList.toggle('on', !!(row.em & (1 << i))));
  }
  setClock(t){ this.ui.clock.textContent = fmtMs(t); }
}

const livePanel   = new VizPanel($('#liveVizPanel'));
const replayPanel = new VizPanel($('#replayVizPanel'));

/* ============================================================
   8. TUNING
   ============================================================ */
const profile = {
  attackPwm:85, pushPwm:70, turnPwm:55, dodgePwm:75,
  reflexPwm:80, edgeBackoffMs:220, pushbackPwm:60, tiltDeg:25, accelRate:12,
  startDelayMs:1500, startDashPwm:90, startTurnMs:400, startMode:'dash'
};
function paintTrack(inp){
  const p = (inp.value - inp.min) / (inp.max - inp.min) * 100;
  inp.style.background =
    `linear-gradient(90deg, rgba(0,243,255,.55) ${p}%, rgba(139,152,184,.18) ${p}%)`;
}
function markDirty(){ $('#btnSaveProfile').classList.add('dirty'); }
function markClean(){ $('#btnSaveProfile').classList.remove('dirty'); }

function bindTuning(){
  $$('#tab-dashboard input[type=range][data-key]').forEach(inp => {
    const key = inp.dataset.key, out = $('#o_' + key);
    const show = () => { out.textContent = inp.value + (inp.dataset.unit || ''); paintTrack(inp); };
    inp.addEventListener('input', () => {
      profile[key] = +inp.value;
      show(); markDirty();
    });
    show();
  });
  $('#s_startMode').addEventListener('change', e => {
    profile.startMode = e.target.value; markDirty();
  });
  $('#btnSaveProfile').addEventListener('click', () => {
    if (sendCmd({ cmd:'save_profile', ...profile })){
      toast('Profil terkirim ke robot', 'ok'); markClean();
    }
  });
}

/* ============================================================
   9. KAMERA LAPTOP + MEDIARECORDER
   ============================================================ */
const cam = { stream:null, devices:[], mr:null, chunks:[], recording:false, url:null, mime:'' };

async function camRefreshDevices(){
  cam.devices = (await navigator.mediaDevices.enumerateDevices())
                  .filter(d => d.kind === 'videoinput');
  const sel = $('#cameraSelect');
  sel.innerHTML = '';
  cam.devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || ('Kamera ' + (i + 1));
    sel.appendChild(o);
  });
}
async function camStartPreview(deviceId){
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId:{ exact:deviceId }, width:{ ideal:1280 }, height:{ ideal:720 } }
                    : { width:{ ideal:1280 }, height:{ ideal:720 } },
    audio: false
  });
  $('#cameraLivePreview').srcObject = cam.stream;
  $('#camOff').classList.add('hidden');
}
async function camEnable(){
  try{
    // Minta izin agar label perangkat terbaca di enumerateDevices()
    const s = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
    s.getTracks().forEach(t => t.stop());
    await camRefreshDevices();
    if (cam.devices.length) await camStartPreview(cam.devices[0].deviceId);
    toast('Kamera aktif — ' + cam.devices.length + ' perangkat ditemukan', 'ok');
  } catch(e){
    $('#camOff').textContent = 'KAMERA TIDAK TERSEDIA';
    toast('Kamera tidak tersedia: ' + e.message, 'warn');
  }
}
function pickMime(){
  if (!window.MediaRecorder) return '';
  const list = ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm','video/mp4'];
  for (const m of list)
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function camStartRec(){
  if (!cam.stream || !cam.stream.getVideoTracks().length){
    toast('Kamera nonaktif — blackbox tetap direkam', 'warn');
    return;
  }
  if (!window.MediaRecorder){ toast('MediaRecorder tidak didukung browser', 'warn'); return; }
  try{
    cam.mime = pickMime(); cam.chunks = [];
    cam.mr = new MediaRecorder(cam.stream, cam.mime ? { mimeType:cam.mime } : undefined);
    cam.mr.ondataavailable = e => { if (e.data && e.data.size) cam.chunks.push(e.data); };
    cam.mr.onstop = () => {
      const blob = new Blob(cam.chunks, { type: cam.mime || 'video/webm' });
      if (cam.url) URL.revokeObjectURL(cam.url);
      cam.url = URL.createObjectURL(blob);
      cam.recording = false;
      loadReplayVideo(cam.url, 'rekaman-kamera.webm');
      $('#recReady').classList.remove('hidden');
      toast('Video match siap — buka tab PREVIEW & REPLAY', 'ok', 4500);
      updateRecUI();
    };
    cam.mr.start(250);
    cam.recording = true;
  } catch(e){ toast('Gagal mulai rekam kamera: ' + e.message, 'warn'); }
}
function camStopRec(){
  if (cam.mr && cam.mr.state !== 'inactive'){ try { cam.mr.stop(); } catch {} }
  else { cam.recording = false; }
  updateRecUI();
}
function bindCam(){
  $('#btnCamEnable').addEventListener('click', camEnable);
  $('#cameraSelect').addEventListener('change', async e => {
    if (cam.recording){ toast('Tidak bisa ganti kamera saat merekam', 'warn'); return; }
    try { await camStartPreview(e.target.value); }
    catch(err){ toast('Gagal buka kamera: ' + err.message, 'warn'); }
  });
  // Coba deteksi awal (jika izin sudah pernah diberikan)
  (async () => {
    if (!navigator.mediaDevices) return;
    try{
      const d = await navigator.mediaDevices.enumerateDevices();
      if (d.some(x => x.kind === 'videoinput' && x.label)){
        await camRefreshDevices();
        if (cam.devices.length) await camStartPreview(cam.devices[0].deviceId).catch(() => {});
      }
    } catch {}
  })();
}

/* ============================================================
   10. BLACKBOX — REKAM / FETCH / CSV / CLEAR
   ============================================================ */
function updateRecUI(){
  const on = loggingActive || cam.recording;
  $('#recBadge').classList.toggle('on', on);
  $('#camRecDot').classList.toggle('on', cam.recording);
  $('#btnLogStart').disabled = loggingActive;
  $('#btnLogStop').disabled  = !loggingActive;
}
function startLogging(){
  if (loggingActive) return;
  if (!link.mode){ toast('Hubungkan robot / aktifkan Simulasi dulu', 'warn'); return; }
  blackboxRows.length = 0; fetching = false;
  captureActive = true; loggingActive = true;
  sendCmd({ cmd:'log_start' });
  camStartRec();
  updateRecUI(); refreshCounters();
  toast('Merekam: blackbox + kamera sinkron', 'ok');
}
function stopLogging(viaEstop){
  if (!loggingActive && !cam.recording){
    if (viaEstop) sendCmd({ cmd:'estop' });
    return;
  }
  loggingActive = false; captureActive = false; fetching = false;
  sendCmd(viaEstop ? { cmd:'estop' } : { cmd:'log_stop' });
  camStopRec();
  updateRecUI(); refreshCounters();
  if (!cam.mr)
    toast('Rekaman dihentikan — data replay tersedia dari buffer live', 'info');
}
function refreshCounters(){
  const dur = blackboxRows.length ? blackboxRows[blackboxRows.length - 1].t : 0;
  $('#recBuf').textContent = `${blackboxRows.length} baris · ${fmtMs(dur)}`;
  rpRefreshInfo();
}
function downloadCsv(){
  if (!blackboxRows.length){ toast('Belum ada data untuk diunduh', 'warn'); return; }
  const head = 'tMs,state,pwmL,pwmR,edgeMask,fl,fc,fr,ml,mr,rr,pitch,roll,accel';
  const lines = blackboxRows.map(r => [
    r.t, (STATES[r.st] || { name:r.st }).name,
    r.pl, r.pr, r.em, ...r.tof,
    r.pit.toFixed(1), r.rol.toFixed(1), r.acc.toFixed(2)
  ].join(','));
  const blob = new Blob([head + '\n' + lines.join('\n')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'blackbox.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('CSV diunduh (' + blackboxRows.length + ' baris)', 'ok');
}
function bindBlackbox(){
  $('#btnLogStart').addEventListener('click', startLogging);
  $('#btnLogStop').addEventListener('click', () => stopLogging(false));
  $('#btnLogFetch').addEventListener('click', () => {
    if (!link.mode){ toast('Hubungkan robot dulu', 'warn'); return; }
    blackboxRows.length = 0; fetching = true;
    sendCmd({ cmd:'log_fetch' });
    refreshCounters();
    toast('Menarik data blackbox dari flash…');
  });
  $('#btnCsv').addEventListener('click', downloadCsv);

  // Hapus flash: konfirmasi dua-tahap (tanpa confirm())
  let armed = false, armT = null;
  const btn = $('#btnLogClear'), lbl = $('#clearLabel');
  const disarm = () => { armed = false; btn.classList.remove('armed'); lbl.textContent = 'HAPUS FLASH'; };
  btn.addEventListener('click', () => {
    if (!armed){
      armed = true; btn.classList.add('armed'); lbl.textContent = 'YAKIN? KLIK LAGI';
      clearTimeout(armT); armT = setTimeout(disarm, 3000);
      return;
    }
    clearTimeout(armT); disarm();
    blackboxRows.length = 0;
    sendCmd({ cmd:'log_clear' });
    refreshCounters();
    toast('File /blackbox.csv dihapus', 'warn');
  });

  $('#btnGoPreview').addEventListener('click', () => switchTab('tab-preview'));
}

/* ============================================================
   11. REPLAY — video sebagai master clock telemetri
   ============================================================ */
const rp = {
  video:null, ready:false, videoDur:0, dataDur:0,
  offset:0, manualT:0, manualPlay:false, speed:1,
  scrubbing:false, ownUrl:null
};
function masterDur(){ return Math.max(rp.ready ? rp.videoDur : 0, rp.dataDur); }

function rowAt(t){
  const a = blackboxRows;
  if (!a.length) return null;
  let lo = 0, hi = a.length - 1, res = a[0];
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (a[mid].t <= t){ res = a[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}
function loadReplayVideo(url, name){
  rp.video.src = url;
  $('#videoEmpty').classList.add('hidden');
  $('#vidName').textContent = name || 'video';
  rp.video.load();
}
function rpRefreshInfo(){
  rp.dataDur = blackboxRows.length ? blackboxRows[blackboxRows.length - 1].t : 0;
  $('#rpInfo').textContent = `${blackboxRows.length} baris data · durasi ${fmtMs(rp.dataDur)}`;
  $('#rpEmpty').classList.toggle('hidden', blackboxRows.length > 0);
  $('#vSeek').max = Math.max(1, Math.round(masterDur()));
  $('#vDur').textContent = fmtMs(masterDur());
}
function setVPlayIcon(playing){
  $('#btnVPlay').innerHTML =
    `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
}
function replayTick(dt){
  const dur = masterDur();
  let t;
  if (rp.ready && rp.video.src){
    t = rp.video.currentTime * 1000 + rp.offset;      // video = master clock
  } else {
    if (rp.manualPlay){
      rp.manualT += dt * rp.speed;
      if (rp.manualT >= dur){ rp.manualT = dur; rp.manualPlay = false; setVPlayIcon(false); }
    }
    t = rp.manualT;
  }
  t = clamp(t, 0, Math.max(dur, 1));
  if (!rp.scrubbing) $('#vSeek').value = Math.round(t);
  $('#vTime').textContent = fmtMs(t);
  const row = rowAt(t) || DEFROW;
  replayPanel.setRow(row);
  replayPanel.setClock(t);
  const playing = rp.ready && rp.video.src ? !rp.video.paused : rp.manualPlay;
  $('#syncChip').classList.toggle('live', playing);
}
function bindReplay(){
  rp.video = $('#replayVideo');
  rp.video.addEventListener('loadedmetadata', () => {
    rp.videoDur = rp.video.duration * 1000 || 0;
    rp.ready = true;
    rpRefreshInfo();
  });
  rp.video.addEventListener('play',  () => setVPlayIcon(true));
  rp.video.addEventListener('pause', () => setVPlayIcon(false));
  rp.video.addEventListener('ended', () => setVPlayIcon(false));

  $('#btnVPlay').addEventListener('click', () => {
    if (rp.ready && rp.video.src){
      rp.video.paused ? rp.video.play().catch(() => {}) : rp.video.pause();
    } else {
      if (!blackboxRows.length){ toast('Belum ada data blackbox', 'warn'); return; }
      if (rp.manualT >= masterDur()) rp.manualT = 0;
      rp.manualPlay = !rp.manualPlay;
      setVPlayIcon(rp.manualPlay);
    }
  });
  const seek = $('#vSeek');
  seek.addEventListener('pointerdown', () => rp.scrubbing = true);
  seek.addEventListener('input', e => {
    const t = +e.target.value;
    if (rp.ready && rp.video.src){
      rp.video.currentTime = clamp((t - rp.offset) / 1000, 0, rp.videoDur / 1000);
    } else rp.manualT = t;
    const row = rowAt(t) || DEFROW;
    replayPanel.setRow(row);
    replayPanel.setClock(t);
    $('#vTime').textContent = fmtMs(t);
  });
  seek.addEventListener('change', () => rp.scrubbing = false);

  $('#vSpeed').addEventListener('change', e => {
    rp.speed = +e.target.value;
    if (rp.video) rp.video.playbackRate = rp.speed;
  });

  // Sync offset (kalibrasi video vs blackbox)
  const offLbl = $('#offVal');
  const setOff = v => { rp.offset = clamp(v, -2000, 2000); offLbl.textContent = rp.offset + ' ms'; };
  $('#offMinus').addEventListener('click', () => setOff(rp.offset - 25));
  $('#offPlus') .addEventListener('click', () => setOff(rp.offset + 25));
  $('#offReset').addEventListener('click', () => setOff(0));

  // Upload video eksternal (dua input, satu handler)
  const onFile = e => {
    const f = e.target.files[0]; if (!f) return;
    if (rp.ownUrl) URL.revokeObjectURL(rp.ownUrl);
    rp.ownUrl = URL.createObjectURL(f);
    loadReplayVideo(rp.ownUrl, f.name);
    $('#fileVideoName').textContent = f.name;
    toast('Video dimuat: ' + f.name, 'ok');
    switchTab('tab-preview');
    e.target.value = '';
  };
  $('#fileVideo').addEventListener('change', onFile);
  $('#fileVideo2').addEventListener('change', onFile);

  // Spasi = play/pause saat di tab preview
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' &&
        $('#tab-preview').classList.contains('active') &&
        !/INPUT|SELECT|TEXTAREA|VIDEO/.test(document.activeElement.tagName)){
      e.preventDefault();
      $('#btnVPlay').click();
    }
  });
}

/* ============================================================
   12. MODE SIMULASI — generator data dummy (40 Hz)
   ============================================================ */
const sim = {
  active:false, running:false,
  t:0, idx:0, acc:0, st:0, pl:0, pr:0, em:0,
  tof:[1150,1150,1150,1100,1100,1200], tgt:null,
  pit:0, rol:0, pitT:0,
  phase:'idle', phT:0, dir:1,
  enemyT:0, enemy:600, pushT:2000, tiltT:0, edgeBit:0,

  reset(){
    Object.assign(this, {
      t:0, idx:0, acc:0, st:0, pl:0, pr:0, em:0, pit:0, rol:0, pitT:0,
      phase:'idle', phT:0, dir:1, enemyT:0, enemy:600, pushT:2000, tiltT:0
    });
  },
  toggle(){
    this.active = !this.active;
    if (this.active){ this.reset(); setLink('sim'); toast('Mode simulasi aktif — data dummy 40 Hz', 'ok'); }
    else { this.running = false; if (link.mode === 'sim') setLink(null); toast('Simulasi dimatikan', 'info'); }
  },
  cmd(o){
    switch (o.cmd){
      case 'estop':        this.running = false; this.st = 0; this.pl = 0; this.pr = 0; this.em = 0; break;
      case 'combat_start': this.running = true; this.phase = 'wait'; this.phT = 0; break;
      case 'combat_stop':  this.running = false; this.st = 0; this.pl = 0; this.pr = 0; break;
      case 'save_profile': toast('Profil disimpan (simulasi)', 'ok'); break;
    }
  },
  step(dt){
    if (!this.active) return;
    if (this.running) this.behave(dt);
    this.acc += dt;
    const stepMs = 25;                                   // 40 Hz
    while (this.acc >= stepMs){
      this.acc -= stepMs;
      this.t += stepMs;
      handleMsg({ t:'log_data', idx:this.idx++, rows:[[
        this.t, this.st, this.pl, this.pr, this.em,
        ...this.tof,
        Math.round(this.pit * 10), Math.round(this.rol * 10), Math.round(0.98 * 100)
      ]]});
    }
  },
  behave(dt){
    this.phT += dt;
    const R = Math.random;
    const m = (l, r) => { this.pl = l; this.pr = r; };
    const set = p => { this.phase = p; this.phT = 0; };

    switch (this.phase){
      case 'wait':  this.st = 0; m(0, 0);
        if (this.phT > 1400) set('dash'); break;
      case 'dash':  this.st = 2; m(profile.startDashPwm, profile.startDashPwm);
        if (this.phT > 480) set('search'); break;
      case 'search':{
        this.st = 2;
        m(38 * this.dir, -30 * this.dir);
        this.enemyT -= dt;
        this.tgt = [950, 880, 1010, 1100, 1080, 1150];
        if (this.enemyT <= 0){ this.enemy = 520 + R() * 160; set('track'); }
        break;
      }
      case 'track':{
        this.st = 3; m(42, 58);
        this.enemy -= dt * .35;
        this.tgt = [this.enemy*1.5, this.enemy*1.05, this.enemy*1.25, 1000, 1050, 1150];
        if (this.enemy <= 240) set('attack');
        else if (R() < dt/6000){ this.enemyT = 1800 + R()*2600; this.dir *= -1; set('search'); }
        break;
      }
      case 'attack':{
        this.st = 4; m(profile.attackPwm, profile.attackPwm);
        this.enemy = Math.max(95, this.enemy - dt * .75);
        this.tgt = [this.enemy*1.4, this.enemy, this.enemy*1.15, 900, 980, 1150];
        if (this.enemy <= 130) set('push');
        else if (R() < dt/5000){ this.enemyT = 1500 + R()*2500; set('search'); }
        break;
      }
      case 'push':{
        this.st = 6; m(profile.pushPwm, profile.pushPwm);
        this.enemy = 100 + Math.sin(this.t/90) * 18;
        this.tgt = [this.enemy*1.3, this.enemy, this.enemy*1.1, 880, 960, 1150];
        this.pitT = Math.sin(this.t/110) * 3.5;
        this.pushT -= dt;
        if (R() < dt/9000){                              // terangkat musuh -> TILT
          this.pitT = (R() < .5 ? -1 : 1) * (18 + R() * 9);
          this.tiltT = 500;
        }
        if (this.pushT <= 0){
          this.pushT = 1200 + R()*2600; this.enemyT = 1200 + R()*3200;
          this.dir *= -1; this.pitT = 0; set('search');
        }
        break;
      }
      case 'edge':{
        this.st = 5; m(-profile.reflexPwm, -profile.reflexPwm);
        if (this.phT > profile.edgeBackoffMs){ this.em = 0; set('dodge'); }
        break;
      }
      case 'dodge':{
        this.st = 1; m(-profile.dodgePwm * this.dir, profile.dodgePwm * this.dir);
        if (this.phT > 380) set('search');
        break;
      }
      default: this.st = 0; m(0, 0);
    }

    // Trigger EDGE acak saat menyerang / mendorong
    if ((this.phase === 'attack' || this.phase === 'dash' || this.phase === 'push') &&
        R() < dt/7000){
      this.edgeBit = 1 << ((R() * 4) | 0);
      this.em = this.edgeBit; this.pitT = 0; set('edge');
    }
    if (this.tiltT > 0){ this.tiltT -= dt; this.st = 7; m(-60, -60); }

    // Haluskan nilai ToF & IMU
    for (let i = 0; i < 6; i++){
      const tg = this.tgt ? this.tgt[i] : 1150;
      this.tof[i] += (tg - this.tof[i]) * Math.min(1, dt/120);
      this.tof[i] = Math.round(clamp(this.tof[i] + (R()*2-1)*14, 30, 1200));
    }
    this.pit += (this.pitT - this.pit) * Math.min(1, dt/100);
    this.rol *= (1 - Math.min(1, dt/200));
  }
};

/* ============================================================
   13. TAB, HEADER, LOOP UTAMA
   ============================================================ */
function switchTab(id){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('.tabpage').forEach(p => p.classList.toggle('active', p.id === id));
  if (id === 'tab-preview') requestAnimationFrame(() => replayPanel.viz.fit());
  if (id === 'tab-dashboard') livePanel.viz.fit();
}

function bindHeader(){
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.tab);
  });
  $('#btnBle').addEventListener('click', () => {
    link.mode === 'ble' ? (link.bleDev && link.bleDev.gatt.disconnect()) : bleConnect();
  });
  $('#btnSerial').addEventListener('click', () => {
    link.mode === 'serial' ? serialDisconnect() : serialConnect();
  });
  $('#btnSim').addEventListener('click', () => sim.toggle());

  $('#btnQuickStart').addEventListener('click', () => {
    sendCmd({ cmd:'combat_start' });
    if (!loggingActive) startLogging();   // quick start = mulai match + rekam sinkron
  });
  $('#btnQuickStop').addEventListener('click', () => {
    sendCmd({ cmd:'combat_stop' });
    if (loggingActive) stopLogging(false);
  });
  $('#btnEstop').addEventListener('click', () => {
    sendCmd({ cmd:'estop' });
    if (link.mode === 'sim'){ sim.running = false; sim.st = 0; sim.pl = 0; sim.pr = 0; }
    stopLogging(true);
    document.body.classList.remove('estop-flash');
    void document.body.offsetWidth;       // restart animasi
    document.body.classList.add('estop-flash');
    toast('EMERGENCY STOP', 'err');
  });
}

let lastT = performance.now();
function loop(now){
  const dt = Math.min(100, now - lastT);
  lastT = now;

  livePanel.viz.render(now);
  if ($('#tab-preview').classList.contains('active')){
    replayPanel.viz.render(now);
    replayTick(dt);
  }
  sim.step(dt);

  // Meter link
  if (now - hzLast > 500){
    $('#statHz').textContent = (pktWindow * 1000 / (now - hzLast)).toFixed(1) + ' Hz';
    pktWindow = 0; hzLast = now;
  }
  $('#statPk').textContent = pktCount + ' pkt';
  const age = lastPktAt ? now - lastPktAt : null;
  const ageEl = $('#statAge');
  if (age == null){ ageEl.textContent = '—'; ageEl.classList.remove('ok'); }
  else if (age < 500){ ageEl.textContent = 'LIVE'; ageEl.classList.add('ok'); }
  else { ageEl.textContent = 'idle ' + Math.round(age/1000) + 's'; ageEl.classList.remove('ok'); }

  // Refresh counter buffer (throttled)
  if (cntDirty && now - lastCnt > 300){
    lastCnt = now; cntDirty = false;
    refreshCounters();
  }
  requestAnimationFrame(loop);
}

/* ---------------- BOOT ---------------- */
bindTuning();
bindCam();
bindBlackbox();
bindReplay();
bindHeader();
updateRecUI();
rpRefreshInfo();
requestAnimationFrame(loop);