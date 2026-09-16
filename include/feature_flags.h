#pragma once

// =============================================================================
// HARDWARE FEATURE FLAGS
// Ubah nilai ke 1 jika modul perangkat keras fisik sudah terpasang.
// Kode dirancang agar tetap dapat dikompilasi secara aman baik saat flag 0 maupun 1.
// =============================================================================

#define HAS_IMU        1  // MPU6050 di I2C1 (SDA:18, SCL:19, 0x68) — tilt detection & gyro heading dodge
#define HAS_EXTRA_TOF  1  // 6x ToF lengkap (3x depan di I2C0 + 3x samping/belakang di I2C1)
#define HAS_LINE_IR    1  // 4x sensor garis IR di GPIO 34, 23, 14, 13
#define HAS_CUR_SENSE  0  // Deteksi arus motor untuk deteksi stalemate/stall
