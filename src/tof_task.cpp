#include "tof_task.h"
#include <Arduino.h>
#include <Wire.h>
#include <VL53L1X.h>
#include "shared_state.h"
#include "feature_flags.h"
#include "driver/gpio.h"

// Mapping Pin XSHUT Fisik ESP32 (Shared I2C0 & I2C1):
// - GPIO 25: Front-Left (I2C0) & Rear / Belakang (I2C1)
// - GPIO 33: Front-Center (I2C0) & Mid-Right / Kanan (I2C1)
// - GPIO 32: Front-Right (I2C0) & Mid-Left / Kiri (I2C1)
#define PIN_XSHUT_FL_RR GPIO_NUM_25
#define PIN_XSHUT_FC_MR GPIO_NUM_33
#define PIN_XSHUT_FR_ML GPIO_NUM_32

static VL53L1X sensors[6];
static bool sensorReady[6] = { false, false, false, false, false, false };

static const char* tofNames[6] = {
  "Serong-Kiri ", "Depan-Tengah", "Serong-Kanan", "Kiri        ", "Kanan       ", "Belakang    "
};

bool isTofReady(int idx) {
  if (idx >= 0 && idx < 6) return sensorReady[idx];
  return false;
}

static void initSensorPair(int idxFront, int idxExtra, gpio_num_t pin, uint8_t addr) {
#if HAS_EXTRA_TOF
  // Amankan bus I2C1 sebelum pin XSHUT dinyalakan agar MPU6050 di task lain tidak mengganggu bootloader VL53L1X di 0x29
  if (g_wire1Mutex) xSemaphoreTake(g_wire1Mutex, portMAX_DELAY);
#endif

  // Lepas pin XSHUT ke level HIGH (menyalakan kedua sensor di I2C0 & I2C1 secara simultan)
  gpio_set_direction(pin, GPIO_MODE_OUTPUT);
  gpio_set_level(pin, 1);
  delay(25); // Waktu boot VL53L1X dari shutdown

  // 1. Inisialisasi Sensor Depan di I2C0 (Wire)
  sensors[idxFront].setBus(&Wire);
  sensors[idxFront].setTimeout(500);
  if (sensors[idxFront].init()) {
    sensors[idxFront].setAddress(addr);
    sensors[idxFront].setDistanceMode(VL53L1X::Short);
    
    // Timing Budget 20ms (20000us)
    sensors[idxFront].setMeasurementTimingBudget(20000);
    
    // Gunakan SPAD optical center simetris (SPAD 199) agar tidak terpotong (clip) di sisi samping
    sensors[idxFront].setROISize(16, 16);
    sensors[idxFront].setROICenter(199);
    
    // Sesuai ST Datasheet UM2356: Inter-measurement period wajib >= TimingBudget + 4ms.
    // Diberi 28ms agar internal calibration & DSP selesai sempurna tanpa interupsi
    sensors[idxFront].startContinuous(28);
    
    sensorReady[idxFront] = true;
    Serial.printf("[OK]   ToF %d-%s (I2C0, GPIO %d) aktif di 0x%02X\n", idxFront + 1, tofNames[idxFront], (int)pin, addr);
  } else {
    Serial.printf("[WARN] ToF %d-%s (I2C0, GPIO %d) gagal init di 0x29!\n", idxFront + 1, tofNames[idxFront], (int)pin);
    sensorReady[idxFront] = false;
  }

#if HAS_EXTRA_TOF
  // 2. Inisialisasi Sensor Ekstensi di I2C1 (Wire1)
  sensors[idxExtra].setBus(&Wire1);
  sensors[idxExtra].setTimeout(500);
  if (sensors[idxExtra].init()) {
    sensors[idxExtra].setAddress(addr);
    sensors[idxExtra].setDistanceMode(VL53L1X::Short);
    sensors[idxExtra].setMeasurementTimingBudget(20000);
    sensors[idxExtra].setROISize(16, 16);
    sensors[idxExtra].setROICenter(199);
    sensors[idxExtra].startContinuous(28);
    sensorReady[idxExtra] = true;
    Serial.printf("[OK]   ToF %d-%s (I2C1, GPIO %d) aktif di 0x%02X\n", idxExtra + 1, tofNames[idxExtra], (int)pin, addr);
  } else {
    Serial.printf("[WARN] ToF %d-%s (I2C1, GPIO %d) gagal init di 0x29!\n", idxExtra + 1, tofNames[idxExtra], (int)pin);
    sensorReady[idxExtra] = false;
  }
  if (g_wire1Mutex) xSemaphoreGive(g_wire1Mutex);
#endif
}

void tofTask(void* pv) {
  Wire.begin(21, 22, 400000); // SDA0 (21), SCL0 (22), 400 kHz Fast Mode
  Wire.setTimeOut(50);
#if HAS_EXTRA_TOF
  // Wire1 telah di-begin di setup() main.cpp. Gunakan timeout standar 50ms untuk clock-stretching.
  Wire1.setTimeOut(50);
#endif

  // Tahan semua pin XSHUT pada level LOW (semua sensor di-reset)
  const gpio_num_t allPins[3] = { PIN_XSHUT_FL_RR, PIN_XSHUT_FC_MR, PIN_XSHUT_FR_ML };
  for (auto p : allPins) {
    gpio_set_direction(p, GPIO_MODE_OUTPUT);
    gpio_set_level(p, 0);
  }
  delay(25);

  Serial.println("[INFO] Menginisialisasi 6x sensor ToF VL53L1X (Shared XSHUT)...");

  // Tahap 1: Pin 25 -> Front-Left (0x2A di I2C0) & Rear/Belakang (0x2A di I2C1)
  initSensorPair(TOF_FL, TOF_RR, PIN_XSHUT_FL_RR, 0x2A);

  // Tahap 2: Pin 33 -> Front-Center (0x2B di I2C0) & Mid-Right/Kanan (0x2B di I2C1)
  initSensorPair(TOF_FC, TOF_MR, PIN_XSHUT_FC_MR, 0x2B);

  // Tahap 3: Pin 32 -> Front-Right (0x2C di I2C0) & Mid-Left/Kiri (0x2C di I2C1)
  initSensorPair(TOF_FR, TOF_ML, PIN_XSHUT_FR_ML, 0x2C);

  // Buffer filter kestabilan nilai sensor
  static uint16_t stableDist[6] = { 0, 0, 0, 0, 0, 0 };
  static uint8_t noTargetCount[6] = { 0, 0, 0, 0, 0, 0 };

  for (;;) {
    bool logging = g_state.logToF;
    uint8_t logMask = g_state.logTofMask;
    int activeCount = HAS_EXTRA_TOF ? 6 : 3;

    for (int i = 0; i < activeCount; i++) {
      if (!sensorReady[i]) {
        portENTER_CRITICAL(&g_stateMux);
        g_state.tofDist[i] = 0;
        portEXIT_CRITICAL(&g_stateMux);
        if (logging && (logMask & (1 << i))) {
          Serial.printf("%s:[OFFLINE] | ", tofNames[i]);
        }
        continue;
      }

      bool isReady = false;
      uint16_t raw_d = 0;
      bool timeout = false;
      VL53L1X::RangeStatus status = VL53L1X::None;

      // Sesuai ST Datasheet UM2356 Section 2.4:
      // Hanya baca data register JIKA dataReady() bernilai true!
      // Jika belum siap, pertahankan data terakhir agar nilai tidak drop/lompat ke nol
      if (i < 3) {
        // Sensor Depan (I2C0 - Wire)
        isReady = sensors[i].dataReady();
        if (isReady) {
          raw_d = sensors[i].read(false);
          timeout = sensors[i].timeoutOccurred();
          status = sensors[i].ranging_data.range_status;
        }
      } else {
        // Sensor Samping & Belakang (I2C1 - Wire1) dengan proteksi Mutex terhadap IMU MPU6050
        if (g_wire1Mutex && xSemaphoreTake(g_wire1Mutex, pdMS_TO_TICKS(40)) == pdTRUE) {
          isReady = sensors[i].dataReady();
          if (isReady) {
            raw_d = sensors[i].read(false);
            timeout = sensors[i].timeoutOccurred();
            status = sensors[i].ranging_data.range_status;
          }
          xSemaphoreGive(g_wire1Mutex);
        }
      }

      if (isReady) {
        // Validasi status pengukuran sesuai Datasheet ST VL53L1X:
        // Status 0: RangeValid, Status 3: RangeValidMinRangeClipped
        // Status 1 (SigmaFail), 2 (SignalFail), 4 (OutOfBounds) adalah noise/pantulan lemah
        bool isValid = (!timeout) &&
                       (status == VL53L1X::RangeValid || status == VL53L1X::RangeValidMinRangeClipped) &&
                       (raw_d >= 1 && raw_d <= 400);

        if (isValid) {
          noTargetCount[i] = 0;
          // Exponential moving average filter ringan (alpha = 0.7 baru + 0.3 lama) untuk kestabilan milimeter
          if (stableDist[i] == 0) {
            stableDist[i] = raw_d;
          } else {
            stableDist[i] = (uint16_t)((raw_d * 7 + stableDist[i] * 3) / 10);
          }
        } else {
          // Debounce 2 frame sebelum menyatakan objek benar-benar hilang (cegah flicker 1-frame dropout)
          noTargetCount[i]++;
          if (noTargetCount[i] >= 2) {
            stableDist[i] = 0;
          }
        }
      }

      portENTER_CRITICAL(&g_stateMux);
      g_state.tofDist[i] = stableDist[i];
      portEXIT_CRITICAL(&g_stateMux);

      if (logging && (logMask & (1 << i))) {
        if (stableDist[i] > 0) {
          Serial.printf("%s:%4u mm | ", tofNames[i], stableDist[i]);
        } else {
          Serial.printf("%s:   -   mm | ", tofNames[i]);
        }
      }
    }

    // Tandai 1 sweep pembacaan ToF selesai (indikasi new frame untuk FSM)
    portENTER_CRITICAL(&g_stateMux);
    g_state.tofSeq++;
    portEXIT_CRITICAL(&g_stateMux);

    if (logging && logMask != 0) {
      Serial.println();
    }

    // Polling setiap 10ms agar responsif membaca sensor yang selesai tanpa jitter
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}
