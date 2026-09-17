#include "ble_task.h"
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include "shared_state.h"
#include "speed_config.h"
#include "motor_hw.h"
#include "nvm.h"
#include "fsm_task.h"
#include "data_logger.h"
#include "imu_task.h"

// Nordic UART Service (NUS) UUIDs
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

static NimBLEServer* s_pServer = nullptr;
static NimBLECharacteristic* s_pTxCharacteristic = nullptr;
static bool s_deviceConnected = false;
static bool s_oldDeviceConnected = false;

// Opsi logging telemetri aktif
static bool s_liveTelemetryEnabled = true;
static bool s_streamIR = true;
static bool s_streamToF = true;
static bool s_streamIMU = true;
static bool s_streamState = true;
static uint32_t s_streamIntervalMs = 100; // 10 Hz

static bool s_serialClientActive = false;

void sendTxResponse(const String& payload) {
  if (s_deviceConnected && s_pTxCharacteristic) {
    String p = payload;
    if (!p.endsWith("\n")) {
      p += "\n";
    }

    // Amankan pengiriman dengan chunking 60-byte BLE ATT MTU
    const uint8_t* data = (const uint8_t*)p.c_str();
    size_t len = p.length();
    size_t offset = 0;
    while (offset < len) {
      size_t chunk = (len - offset > 60) ? 60 : (len - offset);
      s_pTxCharacteristic->setValue(data + offset, chunk);
      s_pTxCharacteristic->notify();
      offset += chunk;
      vTaskDelay(pdMS_TO_TICKS(2));
    }
  }

  // Jika Web Serial client aktif atau Serial terhubung, outputkan JSON baris ke Serial
  if (s_serialClientActive || Serial) {
    Serial.println(payload);
  }
}


static void sendFullConfig() {
  bool isCombat = (nvm::loadMode() == OpMode::SUMO);
  const char* spdModeStr = (getSpeedMode() == SpeedMode::COMPETITION) ? "COMPETITION" : "TEST";

  // 1. Profil TEST
  {
    JsonDocument doc;
    doc["t"] = "profile";
    doc["mode"] = "TEST";
    doc["opMode"] = isCombat ? "COMBAT" : "DATA";
    doc["activeSpdMode"] = spdModeStr;
    doc["gyroEn"] = nvm::isGyroEnabled();

    const SpeedProfile& p = getSpeedProfileWritable(SpeedMode::TEST);
    doc["attackFull"]   = p.attackFull;
    doc["attackOuter"]  = p.attackOuter;
    doc["attackInner"]  = p.attackInner;
    doc["turnInPlace"]  = p.turnInPlace;
    doc["searchSpin"]   = p.searchSpin;
    doc["dodgeOuter"]   = p.dodgeOuter;
    doc["dodgeInner"]   = p.dodgeInner;
    doc["edgeBackup"]   = p.edgeBackup;
    doc["edgeEvade"]    = p.edgeEvade;
    doc["tiltEscape"]   = p.tiltEscape;
    doc["rearThreat"]   = p.rearThreat;
    doc["sideEvade"]    = p.sideEvade;
    doc["pushbackJink"] = p.pushbackJink;
    doc["accelRate"]    = p.accelRate;

    String out;
    serializeJson(doc, out);
    sendTxResponse(out);
  }

  // 2. Profil COMPETITION
  {
    JsonDocument doc;
    doc["t"] = "profile";
    doc["mode"] = "COMPETITION";
    doc["opMode"] = isCombat ? "COMBAT" : "DATA";
    doc["activeSpdMode"] = spdModeStr;
    doc["gyroEn"] = nvm::isGyroEnabled();

    const SpeedProfile& p = getSpeedProfileWritable(SpeedMode::COMPETITION);
    doc["attackFull"]   = p.attackFull;
    doc["attackOuter"]  = p.attackOuter;
    doc["attackInner"]  = p.attackInner;
    doc["turnInPlace"]  = p.turnInPlace;
    doc["searchSpin"]   = p.searchSpin;
    doc["dodgeOuter"]   = p.dodgeOuter;
    doc["dodgeInner"]   = p.dodgeInner;
    doc["edgeBackup"]   = p.edgeBackup;
    doc["edgeEvade"]    = p.edgeEvade;
    doc["tiltEscape"]   = p.tiltEscape;
    doc["rearThreat"]   = p.rearThreat;
    doc["sideEvade"]    = p.sideEvade;
    doc["pushbackJink"] = p.pushbackJink;
    doc["accelRate"]    = p.accelRate;

    String out;
    serializeJson(doc, out);
    sendTxResponse(out);
  }
}

void handleIncomingJson(const char* jsonStr) {
  s_serialClientActive = true; // Tandai bahwa Web Client aktif mengirim JSON

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, jsonStr);
  if (err) return;

  const char* cmd = doc["cmd"] | "";

  if (strcmp(cmd, "get_cfg") == 0 || strcmp(cmd, "get_profile") == 0) {
    sendFullConfig();
  }
  else if (strcmp(cmd, "set_op_mode") == 0) {
    const char* m = doc["mode"] | "DATA";
    if (strcmp(m, "COMBAT") == 0 || strcmp(m, "SUMO") == 0) {
      nvm::saveMode(OpMode::SUMO);
      triggerCombatStop(); // Masuk ke mode SUMO tapi tetap standby di WAIT_START
    } else {
      nvm::saveMode(OpMode::TEST);
      triggerCombatStop(); // Motor mati total di mode Ambil Data
    }
    sendFullConfig();
  }
  else if (strcmp(cmd, "set_spd_mode") == 0 || strcmp(cmd, "set_speed_mode") == 0 || strcmp(cmd, "set_mode") == 0) {
    const char* m = doc["mode"] | "TEST";
    if (strcmp(m, "COMPETITION") == 0) {
      setSpeedMode(SpeedMode::COMPETITION);
      nvm::saveSpeedMode(SpeedMode::COMPETITION);
    } else {
      setSpeedMode(SpeedMode::TEST);
      nvm::saveSpeedMode(SpeedMode::TEST);
    }
    sendFullConfig();
  }
  else if (strcmp(cmd, "combat_start") == 0) {
    triggerCombatStart();
    JsonDocument res;
    res["t"] = "combat_status";
    res["state"] = "STARTED";
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "combat_stop") == 0) {
    triggerCombatStop();
    JsonDocument res;
    res["t"] = "combat_status";
    res["state"] = "STOPPED";
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "start_countdown") == 0) {
    startManualCountdown();
    JsonDocument res;
    res["t"] = "combat_status";
    res["state"] = "COUNTDOWN";
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "set_gyro") == 0 || strcmp(cmd, "set_gyro_logic") == 0) {
    bool en = false;
    if (doc["enabled"].is<bool>()) {
      en = doc["enabled"].as<bool>();
    } else if (doc["en"].is<bool>()) {
      en = doc["en"].as<bool>();
    } else {
      en = !nvm::isGyroEnabled();
    }
    nvm::setGyroEnabled(en);
    Serial.printf("[NVM] Logika Gyro IMU diubah via Web Studio: %s\n", en ? "AKTIF" : "NONAKTIF (DIABAIKAN)");
    sendFullConfig();
  }
  else if (strcmp(cmd, "cal_gyro") == 0 || strcmp(cmd, "calibrate_gyro") == 0) {
    calibrateIMU();
    JsonDocument res;
    res["t"] = "cal_gyro_ok";
    res["status"] = "CALIBRATING";
    res["msg"] = "Proses kalibrasi zero-drift & leveling dimulai (robot harap diam)";
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "save_profile") == 0 || strcmp(cmd, "set_profile") == 0) {
    const char* targetModeStr = doc["mode"] | "TEST";
    SpeedMode sm = (strcmp(targetModeStr, "COMPETITION") == 0) ? SpeedMode::COMPETITION : SpeedMode::TEST;
    SpeedProfile prof = getSpeedProfileWritable(sm);

    if (doc["attackFull"].is<int16_t>())   prof.attackFull   = doc["attackFull"];
    if (doc["attackOuter"].is<int16_t>())  prof.attackOuter  = doc["attackOuter"];
    if (doc["attackInner"].is<int16_t>())  prof.attackInner  = doc["attackInner"];
    if (doc["turnInPlace"].is<int16_t>())  prof.turnInPlace  = doc["turnInPlace"];
    if (doc["searchSpin"].is<int16_t>())   prof.searchSpin   = doc["searchSpin"];
    if (doc["dodgeOuter"].is<int16_t>())   prof.dodgeOuter   = doc["dodgeOuter"];
    if (doc["dodgeInner"].is<int16_t>())   prof.dodgeInner   = doc["dodgeInner"];
    if (doc["edgeBackup"].is<int16_t>())   prof.edgeBackup   = doc["edgeBackup"];
    if (doc["edgeEvade"].is<int16_t>())    prof.edgeEvade    = doc["edgeEvade"];
    if (doc["tiltEscape"].is<int16_t>())   prof.tiltEscape   = doc["tiltEscape"];
    if (doc["rearThreat"].is<int16_t>())   prof.rearThreat   = doc["rearThreat"];
    if (doc["sideEvade"].is<int16_t>())    prof.sideEvade    = doc["sideEvade"];
    if (doc["pushbackJink"].is<int16_t>()) prof.pushbackJink = doc["pushbackJink"];
    if (doc["accelRate"].is<int16_t>())    prof.accelRate    = doc["accelRate"];

    updateSpeedProfile(sm, prof);
    nvm::saveProfileToNVM(sm, prof);
    sendFullConfig();
  }
  else if (strcmp(cmd, "stream") == 0 || strcmp(cmd, "set_log") == 0) {
    if (doc["live"].is<bool>())  s_liveTelemetryEnabled = doc["live"];
    if (doc["ir"].is<bool>())    s_streamIR  = doc["ir"];
    if (doc["tof"].is<bool>())   s_streamToF = doc["tof"];
    if (doc["imu"].is<bool>())   s_streamIMU = doc["imu"];
    if (doc["state"].is<bool>()) s_streamState = doc["state"];
    if (doc["hz"].is<int>()) {
      int hz = doc["hz"];
      if (hz >= 1 && hz <= 50) {
        s_streamIntervalMs = 1000 / hz;
      }
    }
  }
  else if (strcmp(cmd, "estop") == 0 || strcmp(cmd, "stop") == 0) {
    triggerEmergencyStop();
    JsonDocument res;
    res["t"] = "estop_ok";
    res["status"] = "STOPPED";
    res["totalBytes"] = (uint32_t)dataLogger::getTotalBytes();
    res["usedBytes"] = (uint32_t)dataLogger::getUsedBytes();
    res["freeBytes"] = (uint32_t)dataLogger::getFreeBytes();
    res["fileSize"] = (uint32_t)dataLogger::getFileSize();
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "log_start") == 0) {
    dataLogger::start();
    JsonDocument res;
    res["t"] = "log_status";
    res["recording"] = true;
    res["count"] = 0;
    res["totalBytes"] = (uint32_t)dataLogger::getTotalBytes();
    res["usedBytes"] = (uint32_t)dataLogger::getUsedBytes();
    res["freeBytes"] = (uint32_t)dataLogger::getFreeBytes();
    res["fileSize"] = (uint32_t)dataLogger::getFileSize();
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "log_stop") == 0) {
    dataLogger::stop();
    JsonDocument res;
    res["t"] = "log_status";
    res["recording"] = false;
    res["count"] = dataLogger::getCount();
    res["saved"] = true;
    res["hasFlash"] = dataLogger::hasFlashData();
    res["totalBytes"] = (uint32_t)dataLogger::getTotalBytes();
    res["usedBytes"] = (uint32_t)dataLogger::getUsedBytes();
    res["freeBytes"] = (uint32_t)dataLogger::getFreeBytes();
    res["fileSize"] = (uint32_t)dataLogger::getFileSize();
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "log_status") == 0 || strcmp(cmd, "flash_status") == 0) {
    JsonDocument res;
    res["t"] = "log_status";
    res["recording"] = dataLogger::isLogging();
    res["count"] = dataLogger::getCount();
    res["hasFlash"] = dataLogger::hasFlashData();
    res["totalBytes"] = (uint32_t)dataLogger::getTotalBytes();
    res["usedBytes"] = (uint32_t)dataLogger::getUsedBytes();
    res["freeBytes"] = (uint32_t)dataLogger::getFreeBytes();
    res["fileSize"] = (uint32_t)dataLogger::getFileSize();
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "log_clear") == 0) {
    dataLogger::clear();
    JsonDocument res;
    res["t"] = "log_status";
    res["recording"] = false;
    res["count"] = 0;
    res["cleared"] = true;
    res["hasFlash"] = false;
    res["totalBytes"] = (uint32_t)dataLogger::getTotalBytes();
    res["usedBytes"] = (uint32_t)dataLogger::getUsedBytes();
    res["freeBytes"] = (uint32_t)dataLogger::getFreeBytes();
    res["fileSize"] = 0;
    String out;
    serializeJson(res, out);
    sendTxResponse(out);
  }
  else if (strcmp(cmd, "log_fetch") == 0 || strcmp(cmd, "log_get") == 0) {
    if (dataLogger::isLogging()) {
      dataLogger::stop();
    }
    if (dataLogger::getCount() == 0 && dataLogger::hasFlashData()) {
      dataLogger::loadFromFlash();
    }
    uint16_t total = dataLogger::getCount();
    {
      JsonDocument startDoc;
      startDoc["t"] = "log_start";
      startDoc["total"] = total;
      startDoc["fileSize"] = (uint32_t)dataLogger::getFileSize();
      String out;
      serializeJson(startDoc, out);
      sendTxResponse(out);
    }
    vTaskDelay(pdMS_TO_TICKS(20));

    // Kirim per batch 5 sampel untuk kestabilan paket BLE & Serial
    for (uint16_t i = 0; i < total; i += 5) {
      if (!s_deviceConnected && !s_serialClientActive && !Serial) break;
      JsonDocument bdoc;
      bdoc["t"] = "log_data";
      bdoc["idx"] = i;
      JsonArray rows = bdoc["rows"].to<JsonArray>();
      for (uint16_t j = i; j < i + 5 && j < total; j++) {
        LogSample s;
        if (dataLogger::getSample(j, s)) {
          JsonArray r = rows.add<JsonArray>();
          r.add(s.tMs);
          r.add(s.stateId);
          r.add(s.pwmL);
          r.add(s.pwmR);
          r.add(s.edgeMask);
          for (int k = 0; k < 6; k++) r.add(s.tof[k]);
          r.add(s.pitch);
          r.add(s.roll);
          r.add(s.accel);
        }
      }
      String out;
      serializeJson(bdoc, out);
      sendTxResponse(out);
      vTaskDelay(pdMS_TO_TICKS(15));
    }

    {
      JsonDocument endDoc;
      endDoc["t"] = "log_end";
      endDoc["total"] = total;
      String endOut;
      serializeJson(endDoc, endOut);
      sendTxResponse(endOut);
    }
  }
}

class ServerCallbacks: public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* pServer) override {
    s_deviceConnected = true;
    Serial.println("[BLE] Client terhubung via Web Bluetooth!");
  }

  void onDisconnect(NimBLEServer* pServer) override {
    s_deviceConnected = false;
    Serial.println("[BLE] Client terputus.");
  }
};

static String s_incomingRxBuffer = "";

class RxCallbacks: public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pCharacteristic) override {
    std::string rxVal = pCharacteristic->getValue();
    for (char c : rxVal) {
      if (c == '\n' || c == '\r') {
        if (s_incomingRxBuffer.length() > 0) {
          handleIncomingJson(s_incomingRxBuffer.c_str());
          s_incomingRxBuffer = "";
        }
      } else {
        s_incomingRxBuffer += c;
        if (s_incomingRxBuffer.length() > 512) {
          s_incomingRxBuffer = ""; // Cegah buffer overflow
        }
      }
    }
  }
};

void bleTask(void* pv) {
  // Inisialisasi NimBLE Device
  NimBLEDevice::init("Summobot-V1");
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(256);

  s_pServer = NimBLEDevice::createServer();
  s_pServer->setCallbacks(new ServerCallbacks());

  // Nordic UART Service
  NimBLEService* pService = s_pServer->createService(SERVICE_UUID);

  s_pTxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_TX,
    NIMBLE_PROPERTY::NOTIFY
  );

  NimBLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID_RX,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new RxCallbacks());

  pService->start();

  NimBLEAdvertising* pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->start();

  Serial.println("[BLE] Siap! Nama Bluetooth: 'Summobot-V1'");

  unsigned long lastTelemetryTime = 0;

  for (;;) {
    // Handle disconnection restart advertising
    if (!s_deviceConnected && s_oldDeviceConnected) {
      delay(20);
      s_pServer->startAdvertising();
      s_oldDeviceConnected = s_deviceConnected;
    }
    if (s_deviceConnected && !s_oldDeviceConnected) {
      s_oldDeviceConnected = s_deviceConnected;
      vTaskDelay(pdMS_TO_TICKS(350));
      sendFullConfig();
    }

    // Kirim telemetri periodik ke Web Dashboard (BLE ataupun Web Serial)
    unsigned long now = millis();
    if ((s_deviceConnected || s_serialClientActive) && s_liveTelemetryEnabled && (now - lastTelemetryTime >= s_streamIntervalMs)) {
      lastTelemetryTime = now;

      uint8_t edgeMask;
      uint16_t tofs[6];
      float p, r, az;
      portENTER_CRITICAL(&g_stateMux);
      edgeMask = g_state.edgeMask;
      for (int i = 0; i < 6; i++) tofs[i] = g_state.tofDist[i];
      p = g_state.pitch;
      r = g_state.roll;
      az = g_state.accelMag;
      portEXIT_CRITICAL(&g_stateMux);

      JsonDocument doc;
      doc["t"] = "telem";
      doc["op"] = (nvm::loadMode() == OpMode::SUMO) ? "COMBAT" : "DATA";
      doc["spd"] = (getSpeedMode() == SpeedMode::COMPETITION) ? "COMPETITION" : "TEST";
      doc["gyroEn"] = nvm::isGyroEnabled();
      doc["logRec"] = dataLogger::isLogging();
      doc["logCnt"] = dataLogger::getCount();
      doc["logFlash"] = dataLogger::hasFlashData();

      if (s_streamIR) {
        JsonArray irArr = doc["ir"].to<JsonArray>();
        irArr.add((edgeMask & (1 << 0)) ? 1 : 0); // FL (1=putih, 0=hitam)
        irArr.add((edgeMask & (1 << 1)) ? 1 : 0); // FR
        irArr.add((edgeMask & (1 << 2)) ? 1 : 0); // BL
        irArr.add((edgeMask & (1 << 3)) ? 1 : 0); // BR
      }

      if (s_streamToF) {
        JsonArray tofArr = doc["tof"].to<JsonArray>();
        for (int i = 0; i < 6; i++) {
          tofArr.add(tofs[i]);
        }
      }

      if (s_streamIMU) {
        JsonObject imuObj = doc["imu"].to<JsonObject>();
        imuObj["p"] = (int)(p * 10) / 10.0f;
        imuObj["r"] = (int)(r * 10) / 10.0f;
        imuObj["az"] = (int)(az * 100) / 100.0f;
      }

      if (s_streamState) {
        doc["fsm"] = getFsmStateName();
        JsonArray motArr = doc["m"].to<JsonArray>();
        motArr.add(motorhw::getCurrentLeft());
        motArr.add(motorhw::getCurrentRight());
      }

      String out;
      serializeJson(doc, out);
      sendTxResponse(out);
    }

    vTaskDelay(pdMS_TO_TICKS(15));
  }
}
