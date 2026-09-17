#pragma once

#include <Arduino.h>

enum LogStateId : uint8_t {
  LOG_STATE_WAIT = 0,
  LOG_STATE_DODGE = 1,
  LOG_STATE_SEARCH = 2,
  LOG_STATE_TRACK = 3,
  LOG_STATE_ATTACK = 4,
  LOG_STATE_EDGE = 5,
  LOG_STATE_PUSH = 6,
  LOG_STATE_TILT = 7,
  LOG_STATE_TEST = 8
};

struct LogSample {
  uint32_t tMs;       // Waktu (ms) relatif dari awal start rekaman
  int8_t   pwmL;      // PWM Motor Kiri (-100 s.d. +100)
  int8_t   pwmR;      // PWM Motor Kanan (-100 s.d. +100)
  uint8_t  stateId;   // ID State (LogStateId)
  uint8_t  edgeMask;  // Bitmask sensor garis: bit0=FL, bit1=FR, bit2=BL, bit3=BR
  uint16_t tof[6];    // 6x ToF dalam mm: [FL, FC, FR, ML, MR, RR]
  int16_t  pitch;     // Pitch kemiringan (* 10)
  int16_t  roll;      // Roll kemiringan (* 10)
  int16_t  accel;     // Besaran akselerasi (* 100)
};

namespace dataLogger {

void init();
bool isLogging();
void start();
void stop();
void clear();

void recordSample(LogStateId stateId);

uint16_t getCount();
bool getSample(uint16_t idx, LogSample& outSample);

bool saveToFlash();
bool loadFromFlash();
bool hasFlashData();
size_t getTotalBytes();
size_t getUsedBytes();
size_t getFreeBytes();
size_t getFileSize();

const char* getStateName(uint8_t stateId);

} // namespace dataLogger
