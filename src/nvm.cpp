#include "nvm.h"
#include <Preferences.h>

static Preferences prefs;

void nvm::begin() {
  prefs.begin("sumobot", false); // RW namespace
}

OpMode nvm::loadMode() {
  // Default pertama kali boot adalah TEST mode demi keselamatan
  uint8_t v = prefs.getUChar("mode", (uint8_t)OpMode::TEST);
  return (OpMode)v;
}

void nvm::saveMode(OpMode mode) {
  prefs.putUChar("mode", (uint8_t)mode);
}

bool nvm::isCytronEnabled() {
  // Default Cytron start adalah ENABLED (true)
  return prefs.getBool("cytron_en", true);
}

void nvm::setCytronEnabled(bool enabled) {
  prefs.putBool("cytron_en", enabled);
}

SpeedMode nvm::loadSpeedMode() {
  // Default awal boot adalah TEST (Aman)
  uint8_t v = prefs.getUChar("spd_mode", (uint8_t)SpeedMode::TEST);
  return (SpeedMode)v;
}

void nvm::saveSpeedMode(SpeedMode mode) {
  prefs.putUChar("spd_mode", (uint8_t)mode);
}

bool nvm::isGyroEnabled() {
  // Default gyro pada algoritma adalah DISABLED demi kepastian tracking ToF murni
  return prefs.getBool("gyro_en", false);
}

void nvm::setGyroEnabled(bool enabled) {
  prefs.putBool("gyro_en", enabled);
}

