#include <Arduino.h>
#include <Wire.h>
#include "shared_state.h"
#include "motor_hw.h"
#include "edge_task.h"
#include "fsm_task.h"
#include "tof_task.h"
#include "imu_task.h"
#include "cli.h"

void setup() {
  // Inisialisasi Serial UART0 untuk debug dan interaktif CLI non-blocking
  Serial.begin(115200);

  // Buat antrean perintah sistem/CLI dan mutex I2C1
  cliCommandQueue = xQueueCreate(16, sizeof(SysCmd));
  g_wire1Mutex = xSemaphoreCreateMutex();
  Wire1.begin(18, 19, 400000); // SDA1: GPIO 18, SCL1: GPIO 19 (Shared MPU6050 & Extra ToF)

  Serial.println("\n[SYSTEM] Menginisialisasi FreeRTOS Tasks...");

  // ---------------------------------------------------------------------------
  // Core 0: Jalur Kontrol Waktu-Kritis (Reflex Edge, Motor Output, FSM Engine)
  // ---------------------------------------------------------------------------
  xTaskCreatePinnedToCore(edgeTask,  "edge",  2048, nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(motorTask, "motor", 2048, nullptr, 4, nullptr, 0);
  xTaskCreatePinnedToCore(fsmTask,   "fsm",   4096, nullptr, 3, nullptr, 0);

  // ---------------------------------------------------------------------------
  // Core 1: Jalur Sensor I2C (ToF I2C0 & IMU I2C1) & Antarmuka Serial CLI
  // ---------------------------------------------------------------------------
  xTaskCreatePinnedToCore(tofTask,   "tof",   4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(imuTask,   "imu",   2048, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(cliTask,   "cli",   4096, nullptr, 1, nullptr, 1);

  Serial.println("[SYSTEM] Semua task berhasil disematkan ke Core 0 & Core 1.");
}

void loop() {
  // Loop bawaan Arduino tidak digunakan — hapus task ini untuk membebaskan memori
  vTaskDelete(nullptr);
}