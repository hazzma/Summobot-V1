#include "imu_task.h"
#include <Arduino.h>
#include <Wire.h>
#include <cmath>
#include "shared_state.h"
#include "feature_flags.h"

#define SDA1_PIN 18
#define SCL1_PIN 19

#if HAS_IMU
static uint8_t mpuAddr = 0x68;
static bool mpuConnected = false;

static bool writeMPUReg(uint8_t addr, uint8_t reg, uint8_t data) {
  if (g_wire1Mutex) xSemaphoreTake(g_wire1Mutex, portMAX_DELAY);
  Wire1.beginTransmission(addr);
  Wire1.write(reg);
  Wire1.write(data);
  bool ok = (Wire1.endTransmission() == 0);
  if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
  return ok;
}

static bool checkAndInitMPU() {
  if (g_wire1Mutex) xSemaphoreTake(g_wire1Mutex, portMAX_DELAY);
  // Cek address 0x68 (AD0 GND) dan 0x69 (AD0 VCC)
  uint8_t addrs[2] = {0x68, 0x69};
  for (int a = 0; a < 2; a++) {
    uint8_t testAddr = addrs[a];
    Wire1.beginTransmission(testAddr);
    Wire1.write(0x75); // WHO_AM_I register
    if (Wire1.endTransmission(false) == 0) {
      if (Wire1.requestFrom(testAddr, (uint8_t)1) == 1) {
        uint8_t who = Wire1.read();
        // MPU6050 biasanya mengembalikan 0x68 (atau varian 0x70/0x72)
        if (who != 0x00 && who != 0xFF) {
          mpuAddr = testAddr;
          if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
          // Bangunkan MPU6050 dari sleep mode (PWR_MGMT_1 = 0)
          writeMPUReg(mpuAddr, 0x6B, 0x00);
          delay(10);
          // Set Gyro full scale range +/- 250 deg/s (FS_SEL = 0)
          writeMPUReg(mpuAddr, 0x1B, 0x00);
          // Set Accel full scale range +/- 2g (AFS_SEL = 0)
          writeMPUReg(mpuAddr, 0x1C, 0x00);
          mpuConnected = true;
          Serial.printf("[OK]   MPU6050 terdeteksi & aktif di I2C1 (SDA:18, SCL:19, Address: 0x%02X, WHO_AM_I: 0x%02X)\n",
                        mpuAddr, who);
          return true;
        }
      }
    }
  }
  if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
  mpuConnected = false;
  return false;
}

static bool readMPURaw(int16_t &ax, int16_t &ay, int16_t &az,
                       int16_t &gx, int16_t &gy, int16_t &gz) {
  if (g_wire1Mutex && xSemaphoreTake(g_wire1Mutex, pdMS_TO_TICKS(15)) != pdTRUE) {
    return false;
  }

  Wire1.beginTransmission(mpuAddr);
  Wire1.write(0x3B); // ACCEL_XOUT_H
  if (Wire1.endTransmission(false) != 0) {
    if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
    return false;
  }

  if (Wire1.requestFrom(mpuAddr, (uint8_t)14) != 14) {
    if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
    return false;
  }

  ax = (Wire1.read() << 8) | Wire1.read();
  ay = (Wire1.read() << 8) | Wire1.read();
  az = (Wire1.read() << 8) | Wire1.read();
  Wire1.read(); Wire1.read(); // Temperature
  gx = (Wire1.read() << 8) | Wire1.read();
  gy = (Wire1.read() << 8) | Wire1.read();
  gz = (Wire1.read() << 8) | Wire1.read();

  if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
  return true;
}

static volatile bool s_calibrateReq = false;
static float s_gzOffset = 0.0f;
static float s_pitchOffset = 0.0f;
static float s_rollOffset = 0.0f;
static bool s_isCalibrated = false;

void calibrateIMU() {
  s_calibrateReq = true;
}

bool isIMUCalibrated() {
  return s_isCalibrated;
}
#else
void calibrateIMU() {}
bool isIMUCalibrated() { return false; }
#endif

void imuTask(void* pv) {
#if HAS_IMU
  // Beri jeda 150ms agar tofTask menyelesaikan booting XSHUT dan penomoran alamat VL53L1X di I2C1
  delay(150);

  if (!checkAndInitMPU()) {
    Serial.println("[WARN] MPU6050 tidak merespon saat boot di I2C1 (GPIO 18 SDA, GPIO 19 SCL)!");
  }

  unsigned long lastSampleTime = millis();
  unsigned long lastPrintTime = 0;
  unsigned long lastWarnTime = 0;
  float integratedHeading = 0.0f;

  for (;;) {
    bool logging = g_state.logIMU;
    unsigned long now = millis();
    float dt = (now - lastSampleTime) / 1000.0f;
    lastSampleTime = now;

    if (!mpuConnected) {
      // Coba inisialisasi ulang berkala
      if (now - lastWarnTime >= 1500) {
        lastWarnTime = now;
        if (!checkAndInitMPU() && logging) {
          Serial.println("[WARNING] Gyro MPU6050 TIDAK TERBACA di I2C1!");
          Serial.println("          -> Periksa kabel SDA (GPIO 18) & SCL (GPIO 19)");
          Serial.println("          -> Periksa VCC (3.3V/5V) & GND modul MPU6050");
          Serial.println("          -> Pastikan modul terpasang di bus I2C1 (bukan I2C0)");
        }
      }
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    // Permintaan Kalibrasi Statis Gyro (Zero Drift & Leveling)
    if (s_calibrateReq) {
      s_calibrateReq = false;
      Serial.println("[IMU] Memulai kalibrasi Gyro & Leveling... (Robot harap diam di tempat)");
      float sumGz = 0.0f, sumPitch = 0.0f, sumRoll = 0.0f;
      int validSamples = 0;

      for (int k = 0; k < 50; k++) {
        int16_t ax, ay, az, gx, gy, gz;
        if (readMPURaw(ax, ay, az, gx, gy, gz)) {
          float axG = ax / 16384.0f;
          float ayG = ay / 16384.0f;
          float azG = az / 16384.0f;
          float gzVal = gz / 131.0f;
          float p = atan2(axG, sqrt(ayG * ayG + azG * azG)) * 57.2957795f;
          float r = atan2(ayG, azG) * 57.2957795f;
          sumGz += gzVal;
          sumPitch += p;
          sumRoll += r;
          validSamples++;
        }
        vTaskDelay(pdMS_TO_TICKS(10));
      }

      if (validSamples > 15) {
        s_gzOffset = sumGz / validSamples;
        s_pitchOffset = sumPitch / validSamples;
        s_rollOffset = sumRoll / validSamples;
        integratedHeading = 0.0f;
        s_isCalibrated = true;
        Serial.printf("[IMU] Kalibrasi Selesai! Offset Gz: %.2f dps, Pitch: %.1f deg, Roll: %.1f deg\n",
                      s_gzOffset, s_pitchOffset, s_rollOffset);
      }
    }

    int16_t rawAx, rawAy, rawAz, rawGx, rawGy, rawGz;
    if (readMPURaw(rawAx, rawAy, rawAz, rawGx, rawGy, rawGz)) {
      // Sensitivitas +/- 2g (16384 LSB/g) dan +/- 250 deg/s (131 LSB/(deg/s))
      // Catatan: Karena modul terpasang 180°, sumbu maju/mundur fisik robot adalah -axG
      float axG = rawAx / 16384.0f;
      float ayG = rawAy / 16384.0f;
      float azG = rawAz / 16384.0f;
      float gzDps = (rawGz / 131.0f) - s_gzOffset;

      // Hidung terangkat -> axG positif (dikompensasi offset kalibrasi)
      float rawPitch = atan2(axG, sqrt(ayG * ayG + azG * azG)) * 57.2957795f;
      float rawRoll  = atan2(ayG, azG) * 57.2957795f;
      float pitch = rawPitch - s_pitchOffset;
      float roll  = rawRoll - s_rollOffset;
      float accelMag = sqrt(axG * axG + ayG * ayG + azG * azG);

      // Estimasi gravitasi statis (Low-pass filter ~0.5 Hz) untuk tare kemiringan meja
      static float gravAx = 0.0f, gravAy = 0.0f;
      static bool gravInit = false;
      if (!gravInit) {
        gravAx = axG;
        gravAy = ayG;
        gravInit = true;
      } else {
        gravAx = 0.97f * gravAx + 0.03f * axG;
        gravAy = 0.97f * gravAy + 0.03f * ayG;
      }

      // Akselerasi dinamis murni (sentakan / dorongan linier tanpa offset gravitasi statis)
      float linAx = axG - gravAx;
      float linAy = ayG - gravAy;

      // Latch sentakan selama 600ms agar sempat terbaca jelas di Serial Monitor
      static unsigned long latchUntil = 0;
      static const char* latchedPushTag = "                    ";

      if (fabs(pitch) < 20.0f && fabs(roll) < 20.0f) {
        // Threshold 0.12G cukup sensitif untuk dorongan tangan di meja
        if (linAx > 0.12f) {
          latchedPushTag = "[>> SENTAK / MAJU (+X)]";
          latchUntil = now + 600;
        } else if (linAx < -0.12f) {
          latchedPushTag = "[<< SENTAK / MUNDUR(-X)]";
          latchUntil = now + 600;
        } else if (linAy > 0.15f) {
          latchedPushTag = "[TABRAK KANAN (+Y) -> ]";
          latchUntil = now + 600;
        } else if (linAy < -0.15f) {
          latchedPushTag = "[ <- TABRAK KIRI (-Y) ]";
          latchUntil = now + 600;
        }
      }

      if (now > latchUntil) {
        latchedPushTag = "                    ";
      }

      // Integrasi heading sumbu Z (yaw)
      if (fabs(gzDps) > 1.2f) { // Deadband noise filter
        integratedHeading += gzDps * dt;
      }

      portENTER_CRITICAL(&g_stateMux);
      g_state.gyroZ = gzDps;
      g_state.heading = integratedHeading;
      g_state.pitch = pitch;
      g_state.roll = roll;
      g_state.accelMag = accelMag;
      g_state.accelX = linAx;
      portEXIT_CRITICAL(&g_stateMux);

      if (logging && (now - lastPrintTime >= 90)) {
        lastPrintTime = now;

        // 1. Deteksi Rotasi (Gyroscope Z)
        const char* turnTag = "               ";
        if (gzDps > 15.0f)       turnTag = "[<< PUTAR KIRI ]";
        else if (gzDps < -15.0f) turnTag = "[ PUTAR KANAN>>]";

        // 2. Deteksi Kemiringan (Tilt Pitch & Roll)
        const char* tiltTag = "              ";
        if (pitch > 15.0f)        tiltTag = "[ANGKAT DEPAN!]";
        else if (pitch < -15.0f)  tiltTag = "[NUNDUK DEPAN ]";
        else if (roll > 15.0f)    tiltTag = "[MIRING KANAN ]";
        else if (roll < -15.0f)   tiltTag = "[MIRING KIRI  ]";
        else                      tiltTag = "[DATAR / OK   ]";

        Serial.printf("dAx=%+4.2f dAy=%+4.2f | %s %s %s\n",
                      linAx, linAy, turnTag, tiltTag, latchedPushTag);
      }
    } else {
      mpuConnected = false; // Koneksi terputus saat runtime
      if (logging) {
        Serial.println("[ERROR] I2C read error: Komunikasi dengan MPU6050 terputus!");
      }
    }

    vTaskDelay(pdMS_TO_TICKS(20)); // ~50 Hz loop (Beri ruang idle I2C1 untuk ToF ML, MR, RR)
  }
#else
  unsigned long lastWarn = 0;
  for (;;) {
    if (g_state.logIMU) {
      unsigned long now = millis();
      if (now - lastWarn >= 1500) {
        lastWarn = now;
        Serial.println("[WARNING] Sensor MPU6050 dinonaktifkan di firmware (HAS_IMU = 0 di include/feature_flags.h)!");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
#endif
}
