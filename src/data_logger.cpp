#include "data_logger.h"
#include <SPIFFS.h>
#include "shared_state.h"
#include "motor_hw.h"

#define MAX_LOG_SAMPLES 1500
#define LOG_FILE_PATH   "/blackbox.csv"

static LogSample s_samples[MAX_LOG_SAMPLES];
static uint16_t s_sampleCount = 0;
static bool s_isLogging = false;
static uint32_t s_startTimeMs = 0;
static portMUX_TYPE s_loggerMux = portMUX_INITIALIZER_UNLOCKED;

namespace dataLogger {

void init() {
  if (!SPIFFS.begin(true)) {
    Serial.println("[LOG] Gagal me-mount SPIFFS untuk Data Logger!");
  } else {
    Serial.println("[LOG] SPIFFS Blackbox Data Logger siap.");
    if (SPIFFS.exists(LOG_FILE_PATH)) {
      File f = SPIFFS.open(LOG_FILE_PATH, "r");
      if (f) {
        Serial.printf("[LOG] Ditemukan file log flash (%d bytes).\n", (int)f.size());
        f.close();
      }
    }
  }
}

bool isLogging() {
  return s_isLogging;
}

void start() {
  portENTER_CRITICAL(&s_loggerMux);
  s_sampleCount = 0;
  s_startTimeMs = millis();
  s_isLogging = true;
  portEXIT_CRITICAL(&s_loggerMux);
  Serial.println("[LOG] Perekaman Blackbox DIMULAI (Lokal RAM/Flash)!");
}

void stop() {
  if (!s_isLogging) return;
  portENTER_CRITICAL(&s_loggerMux);
  s_isLogging = false;
  portEXIT_CRITICAL(&s_loggerMux);
  Serial.printf("[LOG] Perekaman Blackbox BERHENTI. Total sampel: %d\n", s_sampleCount);
  saveToFlash();
}

void clear() {
  portENTER_CRITICAL(&s_loggerMux);
  s_sampleCount = 0;
  s_isLogging = false;
  portEXIT_CRITICAL(&s_loggerMux);

  if (SPIFFS.exists(LOG_FILE_PATH)) {
    SPIFFS.remove(LOG_FILE_PATH);
    Serial.println("[LOG] File /blackbox.csv di Flash telah dihapus.");
  }
}

void recordSample(LogStateId stateId) {
  if (!s_isLogging) return;

  uint32_t now = millis();
  uint32_t relMs = now - s_startTimeMs;

  uint8_t edgeMask;
  uint16_t tofs[6];
  float p, r, az;

  portENTER_CRITICAL(&g_stateMux);
  edgeMask = g_state.edgeMask;
  for (int i = 0; i < 6; i++) {
    tofs[i] = g_state.tofDist[i];
  }
  p = g_state.pitch;
  r = g_state.roll;
  az = g_state.accelMag;
  portEXIT_CRITICAL(&g_stateMux);

  int16_t pwmL = motorhw::getCurrentLeft();
  int16_t pwmR = motorhw::getCurrentRight();

  portENTER_CRITICAL(&s_loggerMux);
  if (s_sampleCount < MAX_LOG_SAMPLES) {
    LogSample& s = s_samples[s_sampleCount];
    s.tMs = relMs;
    s.pwmL = (int8_t)constrain(pwmL, -100, 100);
    s.pwmR = (int8_t)constrain(pwmR, -100, 100);
    s.stateId = (uint8_t)stateId;
    s.edgeMask = edgeMask;
    for (int i = 0; i < 6; i++) {
      s.tof[i] = tofs[i];
    }
    s.pitch = (int16_t)(p * 10);
    s.roll  = (int16_t)(r * 10);
    s.accel = (int16_t)(az * 100);

    s_sampleCount++;
  } else {
    // Buffer penuh -> otomatis stop & save
    s_isLogging = false;
    portEXIT_CRITICAL(&s_loggerMux);
    saveToFlash();
    return;
  }
  portEXIT_CRITICAL(&s_loggerMux);
}

uint16_t getCount() {
  uint16_t cnt;
  portENTER_CRITICAL(&s_loggerMux);
  cnt = s_sampleCount;
  portEXIT_CRITICAL(&s_loggerMux);
  return cnt;
}

bool getSample(uint16_t idx, LogSample& outSample) {
  bool ok = false;
  portENTER_CRITICAL(&s_loggerMux);
  if (idx < s_sampleCount) {
    outSample = s_samples[idx];
    ok = true;
  }
  portEXIT_CRITICAL(&s_loggerMux);
  return ok;
}

bool saveToFlash() {
  if (s_sampleCount == 0) return false;

  File f = SPIFFS.open(LOG_FILE_PATH, "w");
  if (!f) {
    Serial.println("[LOG] Gagal membuka /blackbox.csv untuk penulisan!");
    return false;
  }

  // Tulis Header CSV
  f.println("ms,state,pwmL,pwmR,edge,fl,fc,fr,ml,mr,rr,pitch,roll,accel");

  char lineBuf[128];
  for (uint16_t i = 0; i < s_sampleCount; i++) {
    const LogSample& s = s_samples[i];
    snprintf(lineBuf, sizeof(lineBuf),
             "%lu,%u,%d,%d,%u,%u,%u,%u,%u,%u,%u,%d,%d,%d",
             (unsigned long)s.tMs,
             s.stateId,
             s.pwmL,
             s.pwmR,
             s.edgeMask,
             s.tof[0], s.tof[1], s.tof[2], s.tof[3], s.tof[4], s.tof[5],
             s.pitch, s.roll, s.accel);
    f.println(lineBuf);
  }

  f.close();
  Serial.printf("[LOG] Berhasil menyimpan %u data ke SPIFFS Flash (%s).\n", s_sampleCount, LOG_FILE_PATH);
  return true;
}

bool loadFromFlash() {
  if (!SPIFFS.exists(LOG_FILE_PATH)) return false;

  File f = SPIFFS.open(LOG_FILE_PATH, "r");
  if (!f) return false;

  // Baca baris pertama (header)
  String header = f.readStringUntil('\n');

  portENTER_CRITICAL(&s_loggerMux);
  s_sampleCount = 0;

  while (f.available() && s_sampleCount < MAX_LOG_SAMPLES) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    unsigned long ms;
    unsigned int stateId, edge;
    int pwmL, pwmR;
    unsigned int fl, fc, fr, ml, mr, rr;
    int p, r, az;

    int matched = sscanf(line.c_str(),
                         "%lu,%u,%d,%d,%u,%u,%u,%u,%u,%u,%u,%d,%d,%d",
                         &ms, &stateId, &pwmL, &pwmR, &edge,
                         &fl, &fc, &fr, &ml, &mr, &rr,
                         &p, &r, &az);

    if (matched >= 14) {
      LogSample& s = s_samples[s_sampleCount++];
      s.tMs = (uint32_t)ms;
      s.stateId = (uint8_t)stateId;
      s.pwmL = (int8_t)pwmL;
      s.pwmR = (int8_t)pwmR;
      s.edgeMask = (uint8_t)edge;
      s.tof[0] = (uint16_t)fl;
      s.tof[1] = (uint16_t)fc;
      s.tof[2] = (uint16_t)fr;
      s.tof[3] = (uint16_t)ml;
      s.tof[4] = (uint16_t)mr;
      s.tof[5] = (uint16_t)rr;
      s.pitch = (int16_t)p;
      s.roll = (int16_t)r;
      s.accel = (int16_t)az;
    }
  }

  portEXIT_CRITICAL(&s_loggerMux);
  f.close();
  Serial.printf("[LOG] Berhasil memuat %u data dari Flash ke memori.\n", s_sampleCount);
  return true;
}

bool hasFlashData() {
  return SPIFFS.exists(LOG_FILE_PATH);
}

const char* getStateName(uint8_t stateId) {
  switch (stateId) {
    case LOG_STATE_WAIT:   return "WAIT_START";
    case LOG_STATE_DODGE:  return "DODGE";
    case LOG_STATE_SEARCH: return "SEARCH";
    case LOG_STATE_TRACK:  return "TRACK";
    case LOG_STATE_ATTACK: return "ATTACK";
    case LOG_STATE_EDGE:   return "EDGE_EVADE";
    case LOG_STATE_PUSH:   return "PUSHBACK";
    case LOG_STATE_TILT:   return "TILT_ESCAPE";
    case LOG_STATE_TEST:   return "DATA_STANDBY";
    default:               return "UNKNOWN";
  }
}

} // namespace dataLogger
