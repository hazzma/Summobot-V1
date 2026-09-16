# Documentation Pinout & Hardware Specification (Updated FSD)
## Autonomous Sumobot 500g — ESP32 WROOM-U & VL53L1X

Dokumen ini merupakan spesifikasi perangkat keras dan pemetaan pin (*pinout*) resmi yang telah diperbarui sesuai **FSD (Functional Specification Document) terbaru**. Robot ini berbasis **ESP32 WROOM-U** (Classic ESP32 Dual-Core) dengan arsitektur **FreeRTOS** dan akses register langsung (*bare-metal style*).

---

## 1. Ringkasan Perangkat Keras & Arsitektur

- **Mikrokontroler:** ESP32 WROOM-U Dual-Core (Xtensa LX6, 240 MHz).
- **Core Allocation FreeRTOS:**
  - **Core 0 (Critical Control Loop):** `edgeTask` (1 kHz, Prio 5), `motorTask` (500 Hz, Prio 4), `fsmTask` (500 Hz, Prio 3).
  - **Core 1 (Sensors & CLI):** `imuTask` (200 Hz, Prio 3), `tofTask` (30–40 Hz, Prio 3), `cliTask` (100 Hz, Prio 1).
- **Driver Motor:** DRV8833 Dual H-Bridge via driver LEDC langsung (`driver/ledc.h`, 20 kHz ultrasonic, 8-bit resolution).
- **Sensor Jarak Utama:** 3x ST VL53L1X Time-of-Flight (ToF) pada I2C0 (400 kHz Fast Mode).
- **Start Module:** Cytron IR Start Module (Active-LOW, GPIO 4).
- **Inter-Task State:** Menggunakan spinlock `portMUX_TYPE` pada `SharedState` untuk latensi mikrodetik.

---

## 2. Tabel Pemetaan Pin Lengkap (Pin Map)

### 2.1. Pin Aktif (Active — Terpasang Saat Ini)

| Kategori / Modul | Sinyal | GPIO ESP32 | Tipe / Channel | Keterangan & Konfigurasi |
| :--- | :---: | :---: | :---: | :--- |
| **Motor Kiri** (DRV8833 Ch A) | `INM11` | **GPIO 16** | LEDC Ch 0 | PWM Forward (`INVERT_LEFT_MOTOR = false`) |
| **Motor Kiri** (DRV8833 Ch B) | `INM12` | **GPIO 17** | LEDC Ch 1 | PWM Reverse (20 kHz, 8-bit) |
| **Motor Kanan** (DRV8833 Ch A) | `INM21` | **GPIO 27** | LEDC Ch 2 | PWM Forward (20 kHz, 8-bit) |
| **Motor Kanan** (DRV8833 Ch B) | `INM22` | **GPIO 26** | LEDC Ch 3 | PWM Reverse (`INVERT_RIGHT_MOTOR = true`) |
| **I2C Bus 0** (Front ToF) | `SDA0` | **GPIO 21** | I2C Data | 400 kHz Fast Mode (Shared 3x ToF depan) |
| **I2C Bus 0** (Front ToF) | `SCL0` | **GPIO 22** | I2C Clock | 400 kHz Fast Mode (Shared 3x ToF depan) |
| **I2C Bus 1** (IMU & Extra ToF) | `SDA1` | **GPIO 18** | I2C Data | 400 kHz Fast Mode (MPU6050 + 3x ToF samping/belakang) |
| **I2C Bus 1** (IMU & Extra ToF) | `SCL1` | **GPIO 19** | I2C Clock | 400 kHz Fast Mode (MPU6050 + 3x ToF samping/belakang) |
| **XSHUT ToF Kiri** | `XSHUT_L` | **GPIO 25** | Digital Out/In | Default `0x29` → Runtime **`0x2A`** (Shared I2C0 & I2C1) |
| **XSHUT ToF Tengah** | `XSHUT_C` | **GPIO 33** | Digital Out/In | Default `0x29` → Runtime **`0x2B`** (Shared I2C0 & I2C1) |
| **XSHUT ToF Kanan** | `XSHUT_R` | **GPIO 32** | Digital Out/In | Default `0x29` → Runtime **`0x2C`** (Shared I2C0 & I2C1) |
| **Cytron IR Start Module** | `IR_START` | **GPIO 4** | Digital Input | Dipindah dari GPIO 16 (Active-LOW, debounced) |

> **Arsitektur Bus I2C Ganda (Dual I2C Bus):**  
> - **I2C0 (`GPIO 21 & 22`):** Khusus untuk 3 sensor ToF Depan (`0x2A`, `0x2B`, `0x2C`).
> - **I2C1 (`GPIO 18 & 19`):** Khusus untuk IMU MPU6050 (`0x68`) digabung bersama 3 sensor ToF ekspansi samping & belakang (`0x2A`, `0x2B`, `0x2C`). Karena alamat MPU6050 berbeda dengan VL53L1X, keduanya bekerja harmonis di bus yang sama.

---

### 2.2. Pin Dicadangkan (Reserved — Sensor Garis IR)

Pin berikut dialokasikan khusus untuk sensor garis arena (Line IR) yang terhubung ke pin input-only (GPI):

| Kategori / Modul | Sinyal | GPIO ESP32 | Sifat Pin | Status / Keterangan |
| :--- | :---: | :---: | :---: | :--- |
| **Line IR Depan-Kiri** | `LINE_FL` | **GPIO 34** | Input Only | Tidak ada pull-up internal; butuh external pull-up |
| **Line IR Depan-Kanan** | `LINE_FR` | **GPIO 23** | Digital In | GPIO standar, internal pull-up didukung (dipindah dari GPIO 35) |
| **Line IR Belakang-Kiri**| `LINE_BL` | **GPIO 14** | Digital In | GPIO standar, internal pull-up didukung (dipindah dari GPIO 36) |
| **Line IR Belakang-Kanan**| `LINE_BR`| **GPIO 13** | Digital In | GPIO standar, internal pull-up didukung (dipindah dari GPIO 39) |

> **Arsitektur Shared-XSHUT (§1.2 & §6.1 FSD):**  
> Saat 3 sensor ToF tambahan dipasang pada **I2C1**, pin **GPIO 25, 33, dan 32** masing-masing akan mengontrol **2 sensor sekaligus** secara paralel (1 di I2C0 dan 1 di I2C1). Karena bus I2C terpisah secara elektrik, tidak akan ada tabrakan alamat `0x29`. Tidak diperlukan GPIO XSHUT baru.

---

## 3. Batasan Pin Hardware ESP32 WROOM-U

Saat merancang pengkabelan dan PCB, perhatikan batasan perangkat keras ESP32:
1. **SPI Flash Internal (DILARANG DIPAKAI):**  
   **GPIO 6, 7, 8, 9, 10, 11** terhubung langsung ke chip SPI flash terintegrasi.
2. **Strapping Pins (Hati-hati terhadap level tegangan saat boot):**  
   **GPIO 0, 2, 12, 15** mempengaruhi bootloader ESP32. Pin-pin ini sengaja dihindari dari sinyal kritis.
3. **Input-Only Pins (GPI):**  
   **GPIO 34** tidak memiliki sirkuit output dan tidak memiliki resistor pull-up/pull-down internal software.
4. **UART0:**  
   **GPIO 1 (TX0)** dan **GPIO 3 (RX0)** dicadangkan untuk USB-Serial Monitor / CLI non-blocking.

---

## 4. Diagram Pengkabelan (Wiring Block Diagram)

```
                                  +-----------------------+
                                  |   ESP32 WROOM-U       |
                                  +-----------------------+
                                     |  |  |  |  |  |  |
               +---------------------+  |  |  |  |  |  +---------------------+
               |                        |  |  |  |  |                        |
               v                        v  v  v  v  v                        v
        +---------------+        +---------------+                    +---------------+
        | VL53L1X FRONT |        | VL53L1X FRONT |                    | VL53L1X FRONT |
        |     LEFT      |        |    CENTER     |                    |     RIGHT     |
        | SDA -> GPIO 21|        | SDA -> GPIO 21|                    | SDA -> GPIO 21|
        | SCL -> GPIO 22|        | SCL -> GPIO 22|                    | SCL -> GPIO 22|
        | XSHUT-> GPIO25|        | XSHUT-> GPIO33|                    | XSHUT-> GPIO32|
        +---------------+        +---------------+                    +---------------+
         (Addr: 0x2A)             (Addr: 0x2B)                         (Addr: 0x2C)

               |                                                             |
         [Shared XSHUT]                                                [Shared XSHUT]
               |                                                             |
               v                                                             v
        (Future: Side L                                               (Future: Side R
           via I2C1)                                                     via I2C1)

               +-----------------------+             +-----------------------+
               | Cytron IR Start Modul |             | DRV8833 Motor Driver  |
               | - OUT -> GPIO 4       |             | - IN1 (M1) <- GPIO 16 |
               | - GND -> GND          |             | - IN2 (M1) <- GPIO 17 |
               | - VCC -> 5V / 3V3     |             | - IN1 (M2) <- GPIO 27 |
               +-----------------------+             | - IN2 (M2) <- GPIO 26 |
                                                     +-----------------------+
                                                              |     |
                                                        +-----+     +-----+
                                                        v                 v
                                                 +------------+    +------------+
                                                 | Motor Kiri |    | Motor Kanan|
                                                 +------------+    +------------+
```

---

## 5. Ringkasan Arsitektur Firmware & Feature Flags

Firmware mengimplementasikan arsitektur *feature flags* (`feature_flags.h`) sehingga dapat dikompilasi dengan aman baik saat sensor ekspansi sudah terpasang maupun belum:

```cpp
#define HAS_IMU        0  // 1 jika MPU6050 dipasang di I2C0 (0x68)
#define HAS_EXTRA_TOF  0  // 1 jika 3 ToF samping/belakang dipasang di I2C1
#define HAS_LINE_IR    0  // 1 jika 4 sensor garis IR dipasang di GPIO 34, 23, 14, 13
#define HAS_CUR_SENSE  0  // 1 jika ada modul current sensing untuk deteksi stall
```

### Prioritas Pengambilan Keputusan (FSM State Machine)
1. **`handleEdge()`** (Priority 1): Menghindari garis putih batas arena (*suicide ring-out reflex*).
2. **`handleTilt()`** (Priority 2): Mencegah robot terjungkal / terbalik.
3. **`handleRearThreat()` / `handleSideThreat()`** (Priority 3): Manuver menghindar dari sergapan samping dan belakang.
4. **`handleStalemate()`** (Priority 4): Melepaskan dorongan saat kedua robot terkunci adu banteng.
5. **`applyHeadOnNudge()`** (Priority 5): Jika musuh menyerang lurus secara simetris, berikan sedikit belokan manuver menyamping agar tidak benturan mati.
6. **`engageDecisionTable()`** (Priority 6): Logika tabel kebenaran deteksi 3 sensor depan (L/C/R).
7. **Spin-Search Mode**: Jika tidak ada musuh lebih dari 600 ms (`IDLE_TO_SEARCH_MS`), robot berputar perlahan (`+70/-70`) untuk melacak posisi lawan.
