#pragma once

#include <cstdint>

namespace motorhw {
  void init();
  void setLeft(int16_t speed);   // Sets target speed with accel ramp (-255..255)
  void setRight(int16_t speed);  // Sets target speed with accel ramp (-255..255)
  void setTarget(int16_t left, int16_t right);
  void setImmediate(int16_t left, int16_t right); // Bypasses ramp for emergency edge reflex
  void stopAll(bool immediate = false);
  void updateRamp();             // Periodic ramp calculation (called every ~5ms)
  int16_t getCurrentLeft();
  int16_t getCurrentRight();
  int16_t getTargetLeft();
  int16_t getTargetRight();
}

void motorTask(void* pv);
