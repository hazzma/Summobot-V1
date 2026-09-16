#pragma once

#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/queue.h>
#include <cstdint>
#include "feature_flags.h"

// Indeks Sensor ToF
#define TOF_FL 0  // Front-Left (Aktif - Terpasang)
#define TOF_FC 1  // Front-Center (Aktif - Terpasang)
#define TOF_FR 2  // Front-Right (Aktif - Terpasang)
#define TOF_ML 3  // Mid-Left (Reserved - Belum dipasang)
#define TOF_MR 4  // Mid-Right (Reserved - Belum dipasang)
#define TOF_RR 5  // Rear (Reserved - Belum dipasang)

struct SharedState {
  volatile uint8_t edgeMask;        // bit0=FL, bit1=FR, bit2=BL, bit3=BR (hanya jika HAS_LINE_IR)
  volatile bool edgeAny;
  volatile uint16_t tofDist[6];     // mm, indeks TOF_* di atas. [3..5] bernilai 9999 sampai HAS_EXTRA_TOF=1
  volatile uint32_t tofSeq;         // Sequence counter, di-increment oleh tofTask setiap sweep selesai
  volatile float gyroZ;             // deg/s (hanya jika HAS_IMU)
  volatile float heading;           // derajat relatif (hanya jika HAS_IMU)
  volatile float pitch;             // derajat (hanya jika HAS_IMU)
  volatile float roll;              // derajat (hanya jika HAS_IMU)
  volatile float accelMag;          // magnitudo percepatan gabungan (hanya jika HAS_IMU)
  volatile float accelX;            // sumbu maju-mundur robot, buat pushback detection (hanya jika HAS_IMU)
  volatile uint16_t motorCurrentMa; // arus motor (hanya jika HAS_CUR_SENSE)

  // Status logging real-time CLI (bebas race condition antrean)
  volatile bool logToF;
  volatile uint8_t logTofMask;
  volatile bool logIR;
  volatile bool logIMU;
};

extern SharedState g_state;
extern portMUX_TYPE g_stateMux; // Spinlock untuk critical section mikrodetik

enum class CmdType : uint8_t {
  MOTOR_FWD,
  MOTOR_REV,
  MOTOR_STOP,
  TOF_LOG_START,
  IR_LOG_START,
  IMU_LOG_START,
  LOG_STOP
};

struct SysCmd {
  CmdType type;
  int motorId = 0;
  int speed = 0;
  uint8_t tofMask = 0;
};

extern QueueHandle_t cliCommandQueue;
extern SemaphoreHandle_t g_wire1Mutex;
