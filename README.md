# Summobot V1 — Autonomous 500g Sumo Robot

Firmware otonom robot **Sumo 500g (Summobot V1)** berbasis mikrokontroler **ESP32 WROOM-U** (Dual-Core FreeRTOS) dengan arsitektur sensor multi-arah: 6x sensor jarak Time-of-Flight (**VL53L1X**), sensor garis arena IR, sensor remote start (**Cytron IR Start Module**), dan IMU (**MPU6050**).

---

## 📌 Pinout Lengkap Hardware

> **PENTING:** Seluruh pin sensor IR (Sensor Garis Dohyo & Cytron Start Module) diletakkan di urutan paling atas sesuai spesifikasi wiring robot.

### 1. Sensor IR (Garis Tepi Dohyo & Remote Start) — PALING ATAS

| Modul / Sensor | Sinyal | GPIO ESP32 | Sifat Pin | Logika / Keterangan |
|---|:---:|:---:|:---:|---|
| **Cytron IR Start Module** | `IR_START` | **GPIO 4** | Digital In (Pull-up) | **Active-LOW** (Debounced 20ms). Menunggu trigger remote wasit / start tombol. |
| **Line IR Depan-Kiri (FL)** | `LINE_FL` | **GPIO 34** | Input Only (GPI) | **Active-LOW** (0 = garis putih terdeteksi). Sudut sasis depan-kiri. |
| **Line IR Depan-Kanan (FR)** | `LINE_FR` | **GPIO 35** | Input Only (GPI) | **Active-LOW** (0 = garis putih terdeteksi). Sudut sasis depan-kanan. |
| **Line IR Belakang-Kiri (BL)** | `LINE_BL` | **GPIO 36** | Input Only (GPI) | **Active-LOW** (0 = garis putih terdeteksi). Sudut sasis belakang-kiri. |
| **Line IR Belakang-Kanan (BR)**| `LINE_BR` | **GPIO 39** | Input Only (GPI) | **Active-LOW** (0 = garis putih terdeteksi). Sudut sasis belakang-kanan. |

> *Catatan Sensor Garis (GPIO 34, 35, 36, 39):* Merupakan pin *Input-Only* pada ESP32 (tidak memiliki internal pull-up). Gunakan modul sensor garis dengan output komparator digital yang aktif menarik sinyal ke LOW/HIGH.

---

### 2. Motor Driver (DRV8833 Dual H-Bridge)

Menggunakan modulasi hardware **LEDC direct** pada frekuensi ultrasonik **20 kHz** (resolusi 8-bit, 0–255 duty cycle, senyap dan bebas dengung).

| Motor & Sinyal | Pin DRV8833 | GPIO ESP32 | LEDC Channel | Konfigurasi Arah |
|---|:---:|:---:|:---:|---|
| **Motor Kiri (IN1)** | `INM11` | **GPIO 16** | LEDC Channel 0 | Forward (`INVERT_LEFT_MOTOR = false`) |
| **Motor Kiri (IN2)** | `INM12` | **GPIO 17** | LEDC Channel 1 | Reverse |
| **Motor Kanan (IN1)** | `INM21` | **GPIO 27** | LEDC Channel 2 | Forward |
| **Motor Kanan (IN2)** | `INM22` | **GPIO 26** | LEDC Channel 3 | Reverse (`INVERT_RIGHT_MOTOR = true`, disesuaikan mounting fisik) |

---

### 3. Sensor Jarak Lawan (6x ToF VL53L1X — Deteksi 360°)

Menggunakan arsitektur cerdas **Dual I2C Bus** + **Shared XSHUT** sehingga 6 sensor dapat dihidupkan tanpa tabrakan alamat default (`0x29`).

| Sensor ToF | Indeks | Bus I2C (SDA / SCL) | Pin XSHUT | Alamat Runtime | Posisi & Arah Hadap |
|---|:---:|:---:|:---:|:---:|---|
| **Front-Left** | `0` | **I2C0** (GPIO 21 / 22) | **GPIO 25** | `0x2A` | Depan Kiri serong 30° |
| **Front-Center**| `1` | **I2C0** (GPIO 21 / 22) | **GPIO 33** | `0x2B` | Depan Tengah lurus 0° |
| **Front-Right** | `2` | **I2C0** (GPIO 21 / 22) | **GPIO 32** | `0x2C` | Depan Kanan serong 30° |
| **Mid-Left**    | `3` | **I2C1** (GPIO 18 / 19) | **GPIO 32** *(shared)* | `0x2C` | Samping Kiri 90° |
| **Mid-Right**   | `4` | **I2C1** (GPIO 18 / 19) | **GPIO 33** *(shared)* | `0x2B` | Samping Kanan 90° |
| **Mid-Back**    | `5` | **I2C1** (GPIO 18 / 19) | **GPIO 25** *(shared)* | `0x2A` | Belakang 180° |

* **Konfigurasi Optik VL53L1X:**
  * Distance Mode: `Short` (kebal ambient light arena).
  * Timing Budget: `20 ms` (20.000 µs), Continuous interval `20 ms`.
  * Region of Interest (ROI): Ukuran `16x8` SPAD, Center `60` (membalik bayangan optik agar sensor membatasi pandangan hanya ke area atas dan menghindari pantulan lantai dohyo).

---

### 4. IMU / Gyroscope (MPU6050)

* **Bus:** I2C1 (Shared bersama ToF samping & belakang)
* **SDA1:** GPIO 18
* **SCL1:** GPIO 19
* **Alamat I2C:** `0x68` (Akses bus diamankan dengan FreeRTOS Mutex `g_wire1Mutex`)
* **Fungsi:** Proteksi kemiringan / terangkat (*Tilt Escape*), belok awal berbasis Gyro (45° *dodge*), dan deteksi *pushback* saat adu dorong (`accelX < -0.30G`).

---

### 5. Komunikasi Serial / CLI & Pin Terlarang

* **UART0 (USB-Serial Monitor):** `GPIO 1` (TX) & `GPIO 3` (RX) — Baud rate: `115200`.
* **SPI Flash Internal (JANGAN DIGUNAKAN):** `GPIO 6, 7, 8, 9, 10, 11` (terhubung langsung ke memori flash internal).
* **Strapping Pins (Dihindari):** `GPIO 0, 2, 12, 15`.

---

## 🧠 Arsitektur FreeRTOS Dual-Core

Firmware memisahkan tugas kontrol waktu-kritis dan pembacaan sensor pada core yang berbeda:

```
+------------------------------------+   +------------------------------------+
|               CORE 0               |   |               CORE 1               |
|  (Kontrol Waktu-Kritis & Refleks)  |   |     (I2C Sensor & Antarmuka)       |
+------------------------------------+   +------------------------------------+
| • edgeTask   (Prio 5, ~1 kHz)      |   | • tofTask   (Prio 3, ~35-40 Hz)    |
|   Refleks sensor garis putih       |   |   Sweep 6x VL53L1X (I2C0 & I2C1)   |
| • motorTask  (Prio 4, Event-driven)|   | • imuTask   (Prio 3, ~100-200 Hz)  |
|   Eksekusi PWM saat mode manual    |   |   MPU6050 tilt & pushback filter   |
| • fsmTask    (Prio 3, ~500 Hz)     |   | • cliTask   (Prio 1, 100 Hz poll)  |
|   Otak keputusan otonom (SUMO)     |   |   Menu Serial interaktif non-block |
+------------------------------------+   +------------------------------------+
                   \                               /
                    \                             /
                     +---------------------------+
                     |  SharedState (g_state)    |
                     |  Spinlock portMUX_TYPE    |
                     |  Latensi < 1 mikrodetik   |
                     +---------------------------+
```

---

## 🎯 Logika FSM (Finite State Machine)

1. **Prioritas 1 Mutlak — Refleks Garis Putih (`handleEdge`)**:
   Jika sensor IR mendeteksi tepi putih dohyo, robot seketika membatalkan penyerangan dan melakukan manuver mundur/pivot menghindar.
2. **Prioritas 2 — Proteksi Kemiringan (`handleTilt`)**:
   Jika robot terangkat oleh lawan (`pitch/roll > 15°`), robot seketika mundur penuh untuk melepaskan diri.
3. **Prioritas 3 — Pushback Jink (`handlePushback`)**:
   Saat adu banteng dan robot terdorong mundur (`accelX < -0.30G`), robot bermanuver slip-out serong untuk melepaskan dorongan frontal lawan.
4. **Smooth Pursuit Curve (Pelacakan Target Frontal)**:
   * Lawan di Depan-Tengah: Maju lurus serang penuh (`attackFull`).
   * Lawan condong ke Kiri (`FC + FL`): **Kedua roda tetap berputar MAJU positif** (Kiri: `attackInner`, Kanan: `attackOuter`), menghasilkan belokan kurva halus yang agresif tanpa roda tersendat mundur (*chattering-free*).
   * Lawan condong ke Kanan (`FC + FR`): Kedua roda maju positif (Kiri: `attackOuter`, Kanan: `attackInner`).
   * Lawan di samping/belakang (`ML/MR/RR`): Robot melakukan *turn-in-place* hingga lawan tertangkap oleh sensor depan.
   * Tidak ada lawan (1–400 mm): Robot langsung **DIAM** (`stopAll()`) agar tenang dan aman di meja pengujian.

---

## ⚡ Profil Kecepatan (Speed Profiles)

Tersimpan secara permanen di EEPROM / NVM ESP32 (`Preferences`):
* **`PROFILE_TEST` (Aman / Meja Pengujian):**
  * `attackFull`: 55 (~21% PWM)
  * `attackOuter`: 50 (~19% PWM)
  * `attackInner`: 45 (~18% PWM)
  * `turnInPlace`: 90 (~35% PWM)
* **`PROFILE_COMPETITION` (Arena Lomba Resmi):**
  * `attackFull`: 255 (100% PWM Full Power)
  * `attackOuter`: 230 (~90% PWM)
  * `attackInner`: 160 (~63% PWM)
  * `turnInPlace`: 180 (~70% PWM)

---

## 💻 Menu CLI Serial Monitor (Non-Blocking)

Buka Serial Monitor pada baud rate **115200**.

```text
============================================
         SUMOBOT 500g — CLI CONTROL         
============================================
Mode Operasi Saat Ini : TEST
Profil Kecepatan      : TEST (Aman / Meja)
Fitur Algoritma Gyro  : DISABLED (Murni 6x ToF Tracking)
Cytron IR Start Modul : ENABLED (GPIO 4 Active-LOW)
--------------------------------------------
[1] Aktifkan SUMO Mode
[2] Masuk ke TEST Mode (Sensor & Motor Test)
[3] Toggle Status Cytron Start (ON/OFF)
[4] Ganti Profil Kecepatan (TEST <-> COMPETITION)
[5] Lihat Detail Parameter Tuning Kecepatan
[6] Toggle Fitur Algoritma Gyro (ON/OFF)
> 
```

---

## 🚀 Kompilasi & Upload Firmware

Proyek ini menggunakan **PlatformIO**:

```bash
# Kompilasi firmware
pio run

# Upload ke ESP32
pio run --target upload

# Buka Serial Monitor
pio device monitor -b 115200
```
