#include "cli.h"
#include <Arduino.h>
#include <cstring>
#include <cstdlib>
#include "nvm.h"
#include "shared_state.h"
#include "tof_task.h"
#include "speed_config.h"
#include "data_logger.h"
#include "fsm_task.h"
#include "ble_task.h"

enum class CliScreen {
  HOME,
  TEST_MENU,
  TOF_SELECT,
  TOF_LOG,
  IR_LOG,
  IMU_LOG,
  MOTOR_MENU,
  MOTOR_CONTROL
};

static CliScreen screen = CliScreen::HOME;
static int activeMotor = -1;
static char lineBuf[64];
static uint8_t lineLen = 0;

static void printHome() {
  OpMode m = nvm::loadMode();
  bool cytronEn = nvm::isCytronEnabled();
  bool gyroEn = nvm::isGyroEnabled();
  const auto& spd = getSpeedProfile();
  size_t totalB = dataLogger::getTotalBytes();
  size_t usedB  = dataLogger::getUsedBytes();
  size_t freeB  = dataLogger::getFreeBytes();
  size_t fileB  = dataLogger::getFileSize();

  Serial.println();
  Serial.println("============================================");
  Serial.println("         SUMOBOT 500g — CLI CONTROL         ");
  Serial.println("============================================");
  Serial.printf("Mode Operasi Saat Ini : %s\n", (m == OpMode::SUMO) ? "SUMO (Otonom)" : "TEST (Standby)");
  Serial.printf("Profil Kecepatan      : %s\n", spd.name);
  Serial.printf("Fitur Algoritma Gyro  : %s\n", gyroEn ? "ENABLED (Dodge 45 deg + Tilt Protect)" : "DISABLED (Murni 6x ToF Tracking)");
  Serial.printf("Cytron IR Start Modul : %s\n", cytronEn ? "ENABLED (GPIO 4 Active-LOW)" : "DISABLED (Menunggu Start Eksplisit)");
  Serial.printf("Blackbox Data Logger  : %s (%d sampel)\n", dataLogger::isLogging() ? "SEDANG REKAM [MERAH]" : "STANDBY", dataLogger::getCount());
  Serial.printf("Kapasitas SPIFFS Flash: Terpakai %u KB / %u KB (Sisa %u KB) | File: %u B\n",
                (unsigned)(usedB / 1024), (unsigned)(totalB / 1024), (unsigned)(freeB / 1024), (unsigned)fileB);
  Serial.println("--------------------------------------------");
  Serial.println("[1] Aktifkan SUMO Mode");
  Serial.println("[2] Masuk ke TEST Mode (Sensor & Motor Test)");
  Serial.println("[3] Toggle Status Cytron Start (ON/OFF)");
  Serial.println("[4] Ganti Profil Kecepatan (TEST <-> COMPETITION)");
  Serial.println("[5] Lihat Detail Parameter Tuning Kecepatan");
  Serial.println("[6] Toggle Fitur Algoritma Gyro (ON/OFF)");
  Serial.println("[7] Mulai / Berhenti Rekam Blackbox (Flash)");
  Serial.println("[8] Tarik / Dump Log CSV ke Serial Monitor");
  Serial.println("[9] Hapus Log Flash (/blackbox.csv) & Cek Sisa");
  Serial.println("[c] Mulai Hitung Mundur 5 Detik (Manual Start)");
  Serial.println("[e] EMERGENCY STOP (Hentikan Motor Seketika)");
  Serial.print("> ");
}

static void printTestMenu() {
  Serial.println();
  Serial.println("== MENU TEST ==");
  Serial.println("[1] Log Sensor ToF VL53L1X");
  Serial.println("[2] Log Sensor Garis IR");
  Serial.println("[3] Uji Coba Motor Driver");
  Serial.println("[4] Log Gyro / IMU (MPU6050)");
  Serial.println("[b] Kembali ke Menu Utama");
  Serial.print("> ");
}

static void printMotorMenu() {
  Serial.println();
  Serial.println("== PENGUJIAN MOTOR ==");
  Serial.println("[1] Motor 1 (Kiri)");
  Serial.println("[2] Motor 2 (Kanan)");
  Serial.println("[3] Motor 1 & 2 (Kiri + Kanan Bersamaan)");
  Serial.println("[b] Kembali");
  Serial.print("> ");
}

static void printMotorControl(int m) {
  const char* name = (m == 1) ? "Kiri" : ((m == 2) ? "Kanan" : "Kiri + Kanan");
  Serial.printf("\n[Motor %d (%s) Terpilih]\n", m, name);
  Serial.println("Rentang Speed: 0 s/d 255 (255 = 100%)");
  Serial.println("Perintah:  f<speed> (Maju, misal f50 = ~20%, f80 = ~31%)");
  Serial.println("           r<speed> (Mundur, misal r50 = ~20%)");
  Serial.println("           *Ketik 'f' atau 'r' tanpa angka untuk kecepatan santai (default speed 50 = ~20%)*");
  Serial.println("           s        (Stop)");
  Serial.println("           b        (Kembali)");
  Serial.print("> ");
}

static void handleLine(const char* line) {
  // 1. Dukungan Penuh Web Serial (JSON Commands dari Browser Studio)
  if (line[0] == '{') {
    handleIncomingJson(line);
    return;
  }

  switch (screen) {
    case CliScreen::HOME:
      if (line[0] == '1') {
        nvm::saveMode(OpMode::SUMO);
        Serial.println("\n[OK] Mode SUMO diaktifkan & disimpan ke NVS!");
        if (nvm::isCytronEnabled()) {
          Serial.println("[INFO] Robot menunggu sinyal remote Cytron di GPIO 4...");
        } else {
          Serial.println("[INFO] Cytron nonaktif. Tekan 'c' untuk mulai hitung mundur 5 detik.");
        }
      } else if (line[0] == '2') {
        triggerCombatStop();
        nvm::saveMode(OpMode::TEST);
        Serial.println("\n[OK] Mode TEST diaktifkan & disimpan ke NVS.");
        screen = CliScreen::TEST_MENU;
        printTestMenu();
        return;
      } else if (line[0] == '3') {
        bool current = nvm::isCytronEnabled();
        bool newState = !current;
        nvm::setCytronEnabled(newState);
        Serial.printf("\n[NVS] Cytron IR Start diubah menjadi: %s\n",
                      newState ? "ENABLED (Menunggu sinyal remote)" : "DISABLED (Manual 'c' / Web Start)");
      } else if (line[0] == '4') {
        SpeedMode cur = getSpeedMode();
        SpeedMode next = (cur == SpeedMode::TEST) ? SpeedMode::COMPETITION : SpeedMode::TEST;
        setSpeedMode(next);
        const auto& spd = getSpeedProfile();
        Serial.printf("\n[NVS] Profil Kecepatan aktif diubah ke: %s\n", spd.name);
      } else if (line[0] == '5') {
        const auto& spd = getSpeedProfile();
        Serial.println();
        Serial.println("================ DETAIL SPEED TUNING ================");
        Serial.printf("Profil Aktif: %s\n", spd.name);
        Serial.println("--- FSM Engage / Serang ---");
        Serial.printf("  Attack Full (Lurus)       : %d (%d%% PWM)\n", spd.attackFull, (spd.attackFull * 100) / 255);
        Serial.printf("  Attack Outer (Belok Luar) : %d (%d%% PWM)\n", spd.attackOuter, (spd.attackOuter * 100) / 255);
        Serial.printf("  Attack Inner (Belok Dalam): %d (%d%% PWM)\n", spd.attackInner, (spd.attackInner * 100) / 255);
        Serial.printf("  Turn In Place (Samping)   : %d (%d%% PWM)\n", spd.turnInPlace, (spd.turnInPlace * 100) / 255);
        Serial.printf("  Search Patrol (Maju Lurus): %d (%d%% PWM)\n", spd.searchSpin, (spd.searchSpin * 100) / 255);
        Serial.println("--- Start Dodge ---");
        Serial.printf("  Dodge Outer               : %d (%d%% PWM)\n", spd.dodgeOuter, (spd.dodgeOuter * 100) / 255);
        Serial.printf("  Dodge Inner               : %d (%d%% PWM)\n", spd.dodgeInner, (spd.dodgeInner * 100) / 255);
        Serial.println("--- Reflex & Keamanan ---");
        Serial.printf("  Edge Backup (Garis Putih) : %d (%d%% PWM)\n", spd.edgeBackup, (spd.edgeBackup * 100) / 255);
        Serial.printf("  Edge Evade (Sudut Garis)  : %d (%d%% PWM)\n", spd.edgeEvade, (spd.edgeEvade * 100) / 255);
        Serial.printf("  Tilt Escape (Terangkat)   : %d (%d%% PWM)\n", spd.tiltEscape, (spd.tiltEscape * 100) / 255);
        Serial.printf("  Rear Threat (Sergap Bokong: %d (%d%% PWM)\n", spd.rearThreat, (spd.rearThreat * 100) / 255);
        Serial.printf("  Side Evade (Sergap Samping: %d (%d%% PWM)\n", spd.sideEvade, (spd.sideEvade * 100) / 255);
        Serial.printf("  Pushback Jink (Adu Dorong): %d (%d%% PWM)\n", spd.pushbackJink, (spd.pushbackJink * 100) / 255);
        Serial.println("=====================================================");
        Serial.println("*Untuk tuning angka, buka file: include/speed_config.h*");
      } else if (line[0] == '6') {
        bool current = nvm::isGyroEnabled();
        bool newState = !current;
        nvm::setGyroEnabled(newState);
        Serial.printf("\n[NVS] Fitur Algoritma Gyro diubah menjadi: %s\n",
                      newState ? "ENABLED (Dodge 45 deg + Tilt Protect Aktif)" : "DISABLED (Murni 6x ToF & Line IR Tracking)");
      } else if (line[0] == '7') {
        if (dataLogger::isLogging()) {
          dataLogger::stop();
          Serial.printf("\n[LOG] Perekaman dihentikan & disimpan ke Flash. Total: %d sampel.\n", dataLogger::getCount());
        } else {
          dataLogger::start();
          Serial.println("\n[LOG] Perekaman Blackbox DIMULAI.");
        }
      } else if (line[0] == '8') {
        if (dataLogger::isLogging()) dataLogger::stop();
        if (dataLogger::getCount() == 0 && dataLogger::hasFlashData()) dataLogger::loadFromFlash();
        uint16_t cnt = dataLogger::getCount();
        Serial.printf("\n=== DUMP BLACKBOX LOG (%u sampel) ===\n", cnt);
        Serial.println("ms,state,pwmL,pwmR,edge,fl,fc,fr,ml,mr,rr,pitch,roll,accel");
        for (uint16_t i = 0; i < cnt; i++) {
          LogSample s;
          if (dataLogger::getSample(i, s)) {
            Serial.printf("%lu,%u,%d,%d,%u,%u,%u,%u,%u,%u,%u,%d,%d,%d\n",
                          (unsigned long)s.tMs, s.stateId, s.pwmL, s.pwmR, s.edgeMask,
                          s.tof[0], s.tof[1], s.tof[2], s.tof[3], s.tof[4], s.tof[5],
                          s.pitch, s.roll, s.accel);
          }
        }
        Serial.println("=== AKHIR DUMP LOG ===");
      } else if (line[0] == '9') {
        dataLogger::clear();
        Serial.println("\n[LOG] Seluruh log di Flash (/blackbox.csv) telah dihapus!");
        Serial.printf("      Status Memori Flash: Sisa Free %u KB (Total %u KB), File: %u B (BERSIH)\n",
                      (unsigned)(dataLogger::getFreeBytes() / 1024),
                      (unsigned)(dataLogger::getTotalBytes() / 1024),
                      (unsigned)dataLogger::getFileSize());
      } else if (line[0] == 'c' || line[0] == 'C') {
        startManualCountdown();
      } else if (line[0] == 'e' || line[0] == 'E') {
        triggerEmergencyStop();
      }
      printHome();
      break;

    case CliScreen::TEST_MENU:
      if (line[0] == '1') {
        screen = CliScreen::TOF_SELECT;
        Serial.println();
        Serial.println("== STATUS DETEKSI HARDWARE 6x ToF (VL53L1X) ==");
        Serial.println("[I2C0 - Depan (SDA:21, SCL:22)]");
        Serial.printf("  ToF 1 (Serong Kiri  | 0x2A | XSHUT GPIO 25): %s\n", isTofReady(0) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.printf("  ToF 2 (Depan Tengah | 0x2B | XSHUT GPIO 33): %s\n", isTofReady(1) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.printf("  ToF 3 (Serong Kanan | 0x2C | XSHUT GPIO 32): %s\n", isTofReady(2) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.println("[I2C1 - Samping & Belakang (SDA:18, SCL:19)]");
        Serial.printf("  ToF 4 (Kiri         | 0x2C | XSHUT GPIO 32): %s\n", isTofReady(3) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.printf("  ToF 5 (Kanan        | 0x2B | XSHUT GPIO 33): %s\n", isTofReady(4) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.printf("  ToF 6 (Belakang     | 0x2A | XSHUT GPIO 25): %s\n", isTofReady(5) ? "[OK - READY]" : "[GAGAL / OFFLINE]");
        Serial.println("--------------------------------------------------");
        Serial.println("Pilih channel (1-6, contoh: 1,2,3 atau 4,5,6), 'a'=semua, 'b'=kembali:");
        Serial.print("> ");
      } else if (line[0] == '2') {
        screen = CliScreen::IR_LOG;
        portENTER_CRITICAL(&g_stateMux);
        g_state.logIR = true;
        portEXIT_CRITICAL(&g_stateMux);
        Serial.println("\nMemulai log sensor garis IR. Tekan tombol apa saja untuk stop.\n");
      } else if (line[0] == '3') {
        screen = CliScreen::MOTOR_MENU;
        printMotorMenu();
      } else if (line[0] == '4') {
        screen = CliScreen::IMU_LOG;
        portENTER_CRITICAL(&g_stateMux);
        g_state.logIMU = true;
        portEXIT_CRITICAL(&g_stateMux);
        Serial.println("\nMemulai log Gyro / IMU (MPU6050). Tekan tombol apa saja untuk stop.\n");
      } else if (line[0] == 'b' || line[0] == 'B') {
        screen = CliScreen::HOME;
        printHome();
      } else {
        printTestMenu();
      }
      break;

    case CliScreen::TOF_SELECT: {
      if (line[0] == 'b' || line[0] == 'B') {
        screen = CliScreen::TEST_MENU;
        printTestMenu();
        break;
      }

      uint8_t mask = 0;
      if (line[0] == 'a' || line[0] == 'A' || line[0] == '\0') {
        mask = 0b111111; // semua 6 sensor (3 depan + 3 ekspansi)
      } else {
        char buf[64];
        strncpy(buf, line, sizeof(buf) - 1);
        buf[sizeof(buf) - 1] = '\0';
        char* tok = strtok(buf, ", ");
        while (tok) {
          int idx = atoi(tok) - 1;
          if (idx >= 0 && idx < 6) {
            mask |= (1 << idx);
          }
          tok = strtok(nullptr, ", ");
        }
      }

      if (mask == 0) mask = 0b111111;

      portENTER_CRITICAL(&g_stateMux);
      g_state.logToF = true;
      g_state.logTofMask = mask;
      portEXIT_CRITICAL(&g_stateMux);

      screen = CliScreen::TOF_LOG;
      Serial.println("\nLogging ToF aktif. Tekan tombol apa saja untuk stop.\n");
      break;
    }

    case CliScreen::IR_LOG:
      break;

    case CliScreen::MOTOR_MENU:
      if (line[0] == '1' || line[0] == '2' || line[0] == '3') {
        activeMotor = line[0] - '0';
        screen = CliScreen::MOTOR_CONTROL;
        printMotorControl(activeMotor);
      } else if (line[0] == 'b' || line[0] == 'B') {
        screen = CliScreen::TEST_MENU;
        printTestMenu();
      } else {
        printMotorMenu();
      }
      break;

    case CliScreen::MOTOR_CONTROL: {
      SysCmd cmd{};
      cmd.motorId = activeMotor;

      if (line[0] == 'f' || line[0] == 'F') {
        cmd.type = CmdType::MOTOR_FWD;
        cmd.speed = atoi(line + 1);
        if (cmd.speed <= 0) cmd.speed = 50; // Default santai ~20%
        if (cmd.speed > 255) cmd.speed = 255;
        if (cliCommandQueue) xQueueSend(cliCommandQueue, &cmd, 0);
        Serial.printf("[MOTOR %d] Maju speed = %d (sekitar %d%%)\n", activeMotor, cmd.speed, (cmd.speed * 100) / 255);
      } else if (line[0] == 'r' || line[0] == 'R') {
        cmd.type = CmdType::MOTOR_REV;
        cmd.speed = atoi(line + 1);
        if (cmd.speed <= 0) cmd.speed = 50; // Default santai ~20%
        if (cmd.speed > 255) cmd.speed = 255;
        if (cliCommandQueue) xQueueSend(cliCommandQueue, &cmd, 0);
        Serial.printf("[MOTOR %d] Mundur speed = %d (sekitar %d%%)\n", activeMotor, cmd.speed, (cmd.speed * 100) / 255);
      } else if (line[0] == 's' || line[0] == 'S') {
        cmd.type = CmdType::MOTOR_STOP;
        if (cliCommandQueue) xQueueSend(cliCommandQueue, &cmd, 0);
        Serial.printf("[MOTOR %d] STOP\n", activeMotor);
      } else if (line[0] == 'b' || line[0] == 'B') {
        cmd.type = CmdType::MOTOR_STOP;
        if (cliCommandQueue) xQueueSend(cliCommandQueue, &cmd, 0);
        screen = CliScreen::MOTOR_MENU;
        printMotorMenu();
        break;
      }
      Serial.print("> ");
      break;
    }
  }
}

void cliTask(void* pv) {
  nvm::begin();
  vTaskDelay(pdMS_TO_TICKS(100)); // Beri waktu serial terhubung
  printHome();

  for (;;) {
    // Pembacaan non-blocking per-karakter
    while (Serial.available() > 0) {
      char c = (char)Serial.read();

      // Jika sedang berada dalam mode continuous logging, tombol apa saja akan menghentikannya
      if (screen == CliScreen::IR_LOG || screen == CliScreen::TOF_LOG || screen == CliScreen::IMU_LOG) {
        portENTER_CRITICAL(&g_stateMux);
        g_state.logToF = false;
        g_state.logIR = false;
        g_state.logIMU = false;
        portEXIT_CRITICAL(&g_stateMux);

        screen = CliScreen::TEST_MENU;
        Serial.println("\n[LOG DIHENTIKAN]");
        printTestMenu();
        lineLen = 0;
        break;
      }

      if (c == '\r') continue;
      if (c == '\n') {
        lineBuf[lineLen] = '\0';
        if (lineLen > 0) {
          handleLine(lineBuf);
        }
        lineLen = 0;
      } else if (lineLen < sizeof(lineBuf) - 1) {
        lineBuf[lineLen++] = c;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10)); // Yield cooperative FreeRTOS
  }
}
