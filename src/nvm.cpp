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

bool nvm::loadProfileFromNVM(SpeedMode mode, SpeedProfile& out) {
  const char* pfx = (mode == SpeedMode::COMPETITION) ? "c_" : "t_";
  char key[16];

  snprintf(key, sizeof(key), "%satkF", pfx);
  if (!prefs.isKey(key)) return false; // Belum pernah disimpan di NVM

  out.attackFull   = prefs.getShort(key, out.attackFull);
  snprintf(key, sizeof(key), "%satkO", pfx); out.attackOuter  = prefs.getShort(key, out.attackOuter);
  snprintf(key, sizeof(key), "%satkI", pfx); out.attackInner  = prefs.getShort(key, out.attackInner);
  snprintf(key, sizeof(key), "%sturn", pfx); out.turnInPlace  = prefs.getShort(key, out.turnInPlace);
  snprintf(key, sizeof(key), "%ssrch", pfx); out.searchSpin   = prefs.getShort(key, out.searchSpin);
  snprintf(key, sizeof(key), "%sdodO", pfx); out.dodgeOuter   = prefs.getShort(key, out.dodgeOuter);
  snprintf(key, sizeof(key), "%sdodI", pfx); out.dodgeInner   = prefs.getShort(key, out.dodgeInner);
  snprintf(key, sizeof(key), "%sedgB", pfx); out.edgeBackup   = prefs.getShort(key, out.edgeBackup);
  snprintf(key, sizeof(key), "%sedgE", pfx); out.edgeEvade    = prefs.getShort(key, out.edgeEvade);
  snprintf(key, sizeof(key), "%stilt", pfx); out.tiltEscape   = prefs.getShort(key, out.tiltEscape);
  snprintf(key, sizeof(key), "%srear", pfx); out.rearThreat   = prefs.getShort(key, out.rearThreat);
  snprintf(key, sizeof(key), "%sside", pfx); out.sideEvade    = prefs.getShort(key, out.sideEvade);
  snprintf(key, sizeof(key), "%spush", pfx); out.pushbackJink = prefs.getShort(key, out.pushbackJink);
  snprintf(key, sizeof(key), "%saccel", pfx); out.accelRate    = prefs.getShort(key, out.accelRate);
  return true;
}

void nvm::saveProfileToNVM(SpeedMode mode, const SpeedProfile& in) {
  const char* pfx = (mode == SpeedMode::COMPETITION) ? "c_" : "t_";
  char key[16];

  snprintf(key, sizeof(key), "%satkF", pfx); prefs.putShort(key, in.attackFull);
  snprintf(key, sizeof(key), "%satkO", pfx); prefs.putShort(key, in.attackOuter);
  snprintf(key, sizeof(key), "%satkI", pfx); prefs.putShort(key, in.attackInner);
  snprintf(key, sizeof(key), "%sturn", pfx); prefs.putShort(key, in.turnInPlace);
  snprintf(key, sizeof(key), "%ssrch", pfx); prefs.putShort(key, in.searchSpin);
  snprintf(key, sizeof(key), "%sdodO", pfx); prefs.putShort(key, in.dodgeOuter);
  snprintf(key, sizeof(key), "%sdodI", pfx); prefs.putShort(key, in.dodgeInner);
  snprintf(key, sizeof(key), "%sedgB", pfx); prefs.putShort(key, in.edgeBackup);
  snprintf(key, sizeof(key), "%sedgE", pfx); prefs.putShort(key, in.edgeEvade);
  snprintf(key, sizeof(key), "%stilt", pfx); prefs.putShort(key, in.tiltEscape);
  snprintf(key, sizeof(key), "%srear", pfx); prefs.putShort(key, in.rearThreat);
  snprintf(key, sizeof(key), "%sside", pfx); prefs.putShort(key, in.sideEvade);
  snprintf(key, sizeof(key), "%spush", pfx); prefs.putShort(key, in.pushbackJink);
  snprintf(key, sizeof(key), "%saccel", pfx); prefs.putShort(key, in.accelRate);
}

