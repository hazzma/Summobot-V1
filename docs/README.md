# Dokumentasi Project Sumobot Autonomous 500g

Selamat datang di repositori firmware dan dokumentasi robot **Autonomous Sumobot 500g** berbasis **ESP32 WROOM-U** (Dual-Core FreeRTOS) dan sensor ToF (Time-of-Flight) **ST VL53L1X**.

## Daftar Dokumen:

1. **[Dokumentasi Pinout & Hardware Specification](pinout.md)**  
   Menjelaskan pemetaan pin aktif (motor, I2C0, XSHUT, Cytron IR start) dan reserved (I2C1, 4x Line IR), batasan GPIO ESP32, diagram pengkabelan, dan alokasi task FreeRTOS.

2. **[Functional Specification Document (FSD)](../fsd.md)**  
   Dokumen acuan arsitektur firmware lengkap: arsitektur dual-core FreeRTOS, non-blocking Serial CLI, NVM Preferences (Sumo vs Test mode), direct LEDC motor driver, feature flags (`HAS_IMU`, `HAS_EXTRA_TOF`, `HAS_LINE_IR`), serta logika prioritas FSM (edge avoidance, head-on nudge, search spin).

---

## Ringkasan Pinout Aktif Cepat (Quick Active Pinout)

- **Motor Kiri (DRV8833 Ch A/B):** GPIO 16 (IN1) & GPIO 17 (IN2)
- **Motor Kanan (DRV8833 Ch A/B):** GPIO 27 (IN1) & GPIO 26 (IN2 - Software Inverted)
- **I2C Bus 0 (Shared ToF Depan + IMU):** GPIO 21 (SDA) & GPIO 22 (SCL)
- **XSHUT Pins (Front ToF):**
  - GPIO 25 -> Sensor Kiri (`0x2A`)
  - GPIO 33 -> Sensor Depan-Tengah (`0x2B`)
  - GPIO 32 -> Sensor Kanan (`0x2C`)
- **Cytron IR Start Module:** GPIO 4 (Active-LOW)
