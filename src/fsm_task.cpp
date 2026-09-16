#include "fsm_task.h"
#include <Arduino.h>
#include <cmath>
#include "shared_state.h"
#include "motor_hw.h"
#include "cytron_start.h"
#include "nvm.h"
#include "feature_flags.h"
#include "speed_config.h"

enum class SumoState {
  WAIT_START,
  INITIAL_DODGE,
  ENGAGE
};

static SumoState sumoState = SumoState::WAIT_START;
static bool s_countdownActive = false;

const char* getFsmStateName() {
  if (nvm::loadMode() == OpMode::TEST) {
    return "DATA_LOG (STANDBY)";
  }
  switch (sumoState) {
    case SumoState::WAIT_START:    return "WAIT_START";
    case SumoState::INITIAL_DODGE: return "DODGE";
    case SumoState::ENGAGE:        return "ENGAGE";
    default:                       return "IDLE";
  }
}

void triggerCombatStart() {
  nvm::saveMode(OpMode::SUMO);
  sumoState = SumoState::INITIAL_DODGE;
  s_countdownActive = false;
  Serial.println("[FSM] Combat Start dipicu via Web Studio!");
}

void triggerCombatStop() {
  motorhw::stopAll(true);
  sumoState = SumoState::WAIT_START;
  s_countdownActive = false;
  Serial.println("[FSM] Combat Stop dipicu via Web Studio!");
}

// ---- Parameter Tuning (Sesuai FSD & Hasil Uji) ----
#define ENEMY_MIN_MM          1
#define ENEMY_MAX_MM          400    // 40 cm: Jangkauan deteksi musuh di arena
#define TILT_WARN_DEG         15.0f
#define STALL_CURRENT_MA      1400
#define PUSHBACK_ACCEL_THRESHOLD 0.30f // G (hanya jika Gyro ENABLED)

static inline bool inRange(uint16_t d) {
  return (d >= ENEMY_MIN_MM && d <= ENEMY_MAX_MM);
}

// ---- Edge / Corner Avoidance (§7 FSD - Reflex Prioritas 1 Mutlak) ----
static bool handleEdge() {
#if HAS_LINE_IR
  uint8_t mask;
  portENTER_CRITICAL(&g_stateMux);
  mask = g_state.edgeMask;
  portEXIT_CRITICAL(&g_stateMux);

  if (mask == 0) return false;

  const auto& spd = getSpeedProfile();

  switch (mask) {
    case 0b0011: // Depan L & R terdeteksi (mundur penuh menjauhi garis)
      motorhw::setImmediate(-spd.edgeBackup, -spd.edgeBackup);
      vTaskDelay(pdMS_TO_TICKS(90));
      break;
    case 0b0101: // Sisi kiri (FL + BL) terdeteksi -> pivot kanan menjauh
      motorhw::setImmediate(spd.edgeEvade, -spd.edgeEvade * 2 / 3);
      vTaskDelay(pdMS_TO_TICKS(90));
      break;
    case 0b0110: // Sisi kanan (FR + BR) terdeteksi -> pivot kiri menjauh
      motorhw::setImmediate(-spd.edgeEvade * 2 / 3, spd.edgeEvade);
      vTaskDelay(pdMS_TO_TICKS(90));
      break;
    case 0b0001: // Hanya depan-kiri -> mundur serong kanan
      motorhw::setImmediate(-spd.edgeBackup, -spd.edgeBackup / 2);
      vTaskDelay(pdMS_TO_TICKS(80));
      break;
    case 0b0010: // Hanya depan-kanan -> mundur serong kiri
      motorhw::setImmediate(-spd.edgeBackup / 2, -spd.edgeBackup);
      vTaskDelay(pdMS_TO_TICKS(80));
      break;
    case 0b0100: // Hanya belakang-kiri -> maju serong kanan
      motorhw::setImmediate(spd.edgeEvade, spd.edgeEvade / 2);
      vTaskDelay(pdMS_TO_TICKS(80));
      break;
    case 0b1000: // Hanya belakang-kanan -> maju serong kiri
      motorhw::setImmediate(spd.edgeEvade / 2, spd.edgeEvade);
      vTaskDelay(pdMS_TO_TICKS(80));
      break;
    default:
      motorhw::setImmediate(-spd.edgeBackup, -spd.edgeBackup);
      vTaskDelay(pdMS_TO_TICKS(80));
      break;
  }
  return true; // Siklus berikutnya saat garis lepas (mask==0), FSM langsung kembali ke ToF tracking
#else
  return false;
#endif
}

// ---- Tilt / Self-Preservation (Hanya jika Gyro ENABLED) ----
static bool handleTilt() {
#if HAS_IMU
  if (!nvm::isGyroEnabled()) return false;
  float pitch, roll;
  portENTER_CRITICAL(&g_stateMux);
  pitch = g_state.pitch;
  roll = g_state.roll;
  portEXIT_CRITICAL(&g_stateMux);

  if (fabs(pitch) < TILT_WARN_DEG && fabs(roll) < TILT_WARN_DEG) return false;

  const auto& spd = getSpeedProfile();
  motorhw::setLeft(-spd.tiltEscape);
  motorhw::setRight(-spd.tiltEscape);
  return true;
#else
  return false;
#endif
}

// ---- Deteksi Pushback Lawan (Hanya jika Gyro ENABLED) ----
static bool handlePushback() {
#if HAS_IMU
  if (!nvm::isGyroEnabled()) return false;
  float ax;
  portENTER_CRITICAL(&g_stateMux);
  ax = g_state.accelX;
  portEXIT_CRITICAL(&g_stateMux);

  // Jika terdorong mundur kuat secara drastis saat adu dorong:
  if (ax < -PUSHBACK_ACCEL_THRESHOLD) {
    const auto& spd = getSpeedProfile();
    motorhw::setLeft(spd.pushbackJink);
    motorhw::setRight(-spd.pushbackJink * 2 / 3);
    vTaskDelay(pdMS_TO_TICKS(150));
    return true;
  }
#endif
  return false;
}

// ---- Algoritma Pelacakan Target Terpadu ToF ----
// Menggunakan truth table teruji: belok kurva halus (kedua roda maju positif) saat target terdeteksi condong ke kiri/kanan,
// putar di tempat saat hanya sensor samping/serong yang melihat, dan berhenti saat tidak ada musuh.
static void executeTargetTracking(uint16_t distFL, uint16_t distFC, uint16_t distFR,
                                  uint16_t distML, uint16_t distMR, uint16_t distRR,
                                  int& lastTurnDir) {
  const auto& spd = getSpeedProfile();

  bool seeFL = inRange(distFL);
  bool seeFC = inRange(distFC);
  bool seeFR = inRange(distFR);

  // 1. Prioritas Utama: Evaluasi 3 Sensor Depan (Smooth Pursuit Curve)
  if (seeFC && seeFL && seeFR) {
    // Semua sensor depan mendeteksi -> Maju lurus serang penuh!
    motorhw::setLeft(spd.attackFull);
    motorhw::setRight(spd.attackFull);
    return;
  }
  if (seeFC && !seeFL && !seeFR) {
    // Hanya sensor tengah -> Maju lurus serang penuh!
    motorhw::setLeft(spd.attackFull);
    motorhw::setRight(spd.attackFull);
    return;
  }
  if (seeFC && seeFL && !seeFR) {
    // Tengah + Kiri -> Belok serong kiri halus (kedua roda maju: kiri=inner, kanan=outer)
    motorhw::setLeft(spd.attackInner);
    motorhw::setRight(spd.attackOuter);
    lastTurnDir = -1;
    return;
  }
  if (seeFC && !seeFL && seeFR) {
    // Tengah + Kanan -> Belok serong kanan halus (kedua roda maju: kiri=outer, kanan=inner)
    motorhw::setLeft(spd.attackOuter);
    motorhw::setRight(spd.attackInner);
    lastTurnDir = 1;
    return;
  }
  if (seeFL && seeFR && !seeFC) {
    // Kiri & Kanan (simetris) -> Maju lurus serang penuh!
    motorhw::setLeft(spd.attackFull);
    motorhw::setRight(spd.attackFull);
    return;
  }
  if (seeFL && !seeFC && !seeFR) {
    // Hanya sensor kiri -> Putar kiri di tempat
    motorhw::setLeft(-spd.turnInPlace);
    motorhw::setRight(spd.turnInPlace);
    lastTurnDir = -1;
    return;
  }
  if (seeFR && !seeFC && !seeFL) {
    // Hanya sensor kanan -> Putar kanan di tempat
    motorhw::setLeft(spd.turnInPlace);
    motorhw::setRight(-spd.turnInPlace);
    lastTurnDir = 1;
    return;
  }

#if HAS_EXTRA_TOF
  // 2. Jika 3 sensor depan tidak melihat apapun, evaluasi sensor samping & belakang (jika dipasang)
  bool seeML = inRange(distML);
  bool seeMR = inRange(distMR);
  bool seeRR = inRange(distRR);

  if (seeML || seeMR || seeRR) {
    uint16_t minDist = 9999;
    int targetZone = 0; // 4=ML, 5=MR, 6=RR
    if (seeML && distML < minDist) { minDist = distML; targetZone = 4; }
    if (seeMR && distMR < minDist) { minDist = distMR; targetZone = 5; }
    if (seeRR && distRR < minDist) { minDist = distRR; targetZone = 6; }

    switch (targetZone) {
      case 4: // Samping Kiri (ML) -> Putar kiri di tempat
        motorhw::setLeft(-spd.turnInPlace);
        motorhw::setRight(spd.turnInPlace);
        lastTurnDir = -1;
        return;
      case 5: // Samping Kanan (MR) -> Putar kanan di tempat
        motorhw::setLeft(spd.turnInPlace);
        motorhw::setRight(-spd.turnInPlace);
        lastTurnDir = 1;
        return;
      case 6: // Belakang (RR) -> Putar balik
        if (lastTurnDir <= 0) {
          motorhw::setLeft(-spd.turnInPlace);
          motorhw::setRight(spd.turnInPlace);
        } else {
          motorhw::setLeft(spd.turnInPlace);
          motorhw::setRight(-spd.turnInPlace);
        }
        return;
    }
  }
#endif

  // 3. Default: Tidak ada musuh terdeteksi di range 1-400mm -> DIAM (stopMotors)
  motorhw::stopAll();
}


void fsmTask(void* pv) {
  cytronStartInit();

  static unsigned long dodgeTimedStart = 0;
#if HAS_IMU
  static float dodgeStartHeading = 0;
  static bool dodgeInit = false;
#endif

  static int lastTurnDir = -1; // -1 = kiri, 1 = kanan

  static unsigned long countdownStart = 0;
  static int lastCountSecond = -1;

  for (;;) {
    // Pastikan robot berada dalam mode SUMO
    static bool wasSumo = false;
    bool isSumo = (nvm::loadMode() == OpMode::SUMO);
    if (!isSumo) {
      if (wasSumo) {
        motorhw::stopAll();
        wasSumo = false;
      }
      sumoState = SumoState::WAIT_START;
      s_countdownActive = false;
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    wasSumo = true;

    // 1. Reflex sensor garis (Prioritas 1 Mutlak - berlaku di semua state)
    if (handleEdge()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

    // Ambil data ToF dengan proteksi spinlock
    uint16_t distL, distC, distR;
#if HAS_EXTRA_TOF
    uint16_t distML, distMR, distRR;
#endif
    portENTER_CRITICAL(&g_stateMux);
    distL = g_state.tofDist[TOF_FL];
    distC = g_state.tofDist[TOF_FC];
    distR = g_state.tofDist[TOF_FR];
#if HAS_EXTRA_TOF
    distML = g_state.tofDist[TOF_ML];
    distMR = g_state.tofDist[TOF_MR];
    distRR = g_state.tofDist[TOF_RR];
#endif
    portEXIT_CRITICAL(&g_stateMux);

    switch (sumoState) {
      case SumoState::WAIT_START: {
        motorhw::stopAll();

        bool cytronEn = nvm::isCytronEnabled();
        if (cytronEn) {
          // Cytron Aktif: Menunggu sinyal remote start di GPIO 4
          if (cytronStartReceived()) {
            Serial.println("[START] Sinyal Cytron IR diterima! Meluncur...");
            sumoState = SumoState::INITIAL_DODGE;
            dodgeTimedStart = millis();
#if HAS_IMU
            dodgeInit = false;
#endif
          }
        } else {
          // Cytron Dinonaktifkan: Hitung mundur aman 5 detik
          if (!s_countdownActive) {
            s_countdownActive = true;
            countdownStart = millis();
            lastCountSecond = -1;
            Serial.println("\n[START] Cytron DISABLED. Memulai hitung mundur 5 detik...");
          }

          unsigned long elapsed = millis() - countdownStart;
          int remaining = 5 - (int)(elapsed / 1000);

          if (remaining != lastCountSecond && remaining >= 0) {
            lastCountSecond = remaining;
            if (remaining > 0) {
              Serial.printf("[COUNTDOWN] %d...\n", remaining);
            } else {
              Serial.println("[COUNTDOWN] 0 -> GO!");
            }
          }

          if (elapsed >= 5000) {
            s_countdownActive = false;
            sumoState = SumoState::INITIAL_DODGE;
            dodgeTimedStart = millis();
#if HAS_IMU
            dodgeInit = false;
#endif
          }
        }
        break;
      }

      case SumoState::INITIAL_DODGE: {
        // Jika musuh langsung terdeteksi di awal, batalkan dodge dan langsung kejar!
#if HAS_EXTRA_TOF
        if (inRange(distC) || inRange(distL) || inRange(distR) || inRange(distML) || inRange(distMR) || inRange(distRR)) {
#else
        if (inRange(distC) || inRange(distL) || inRange(distR)) {
#endif
          sumoState = SumoState::ENGAGE;
#if HAS_IMU
          dodgeInit = false;
#endif
          Serial.println("[FSM] Musuh terdeteksi saat start -> Early-exit langsung ke ENGAGE!");
          break;
        }

        // Jika Gyro diaktifkan di menu CLI, lakukan dodge berbasis Gyro (45 deg)
        // Jika Gyro dinonaktifkan, lakukan dodge singkat 200ms
        bool gyroEn = nvm::isGyroEnabled();
#if HAS_IMU
        if (gyroEn) {
          if (!dodgeInit) {
            dodgeStartHeading = g_state.heading;
            dodgeInit = true;
          }
          float turned = g_state.heading - dodgeStartHeading;
          if (std::abs(turned) < 45.0f) {
            const auto& spd = getSpeedProfile();
            motorhw::setLeft(spd.dodgeOuter);
            motorhw::setRight(spd.dodgeInner);
            break;
          }
        } else {
          if (millis() - dodgeTimedStart < 200) {
            const auto& spd = getSpeedProfile();
            motorhw::setLeft(spd.dodgeOuter);
            motorhw::setRight(spd.dodgeInner);
            break;
          }
        }
#else
        if (millis() - dodgeTimedStart < 200) {
          const auto& spd = getSpeedProfile();
          motorhw::setLeft(spd.dodgeOuter);
          motorhw::setRight(spd.dodgeInner);
          break;
        }
#endif
        sumoState = SumoState::ENGAGE;
#if HAS_IMU
        dodgeInit = false;
#endif
        Serial.println("[FSM] Dodge selesai. Masuk ke ENGAGE.");
        break;
      }

      case SumoState::ENGAGE: {
        // Proteksi kemiringan (hanya jika Gyro ENABLED)
        if (handleTilt()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

        // Proteksi pushback adu dorong (hanya jika Gyro ENABLED)
        if (handlePushback()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

        // Eksekusi pelacakan target multi-sensor cerdas
#if HAS_EXTRA_TOF
        executeTargetTracking(distL, distC, distR, distML, distMR, distRR, lastTurnDir);
#else
        executeTargetTracking(distL, distC, distR, 9999, 9999, 9999, lastTurnDir);
#endif
        break;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(2)); // Loop rate ~500 Hz
  }
}
