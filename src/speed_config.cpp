#include "speed_config.h"
#include "nvm.h"

static SpeedMode s_currentSpeedMode = SpeedMode::TEST;
static bool s_initialized = false;

static SpeedProfile s_activeProfileTest = PROFILE_TEST;
static SpeedProfile s_activeProfileComp = PROFILE_COMPETITION;

void initSpeedProfilesFromNVM() {
  nvm::begin();
  nvm::loadProfileFromNVM(SpeedMode::TEST, s_activeProfileTest);
  nvm::loadProfileFromNVM(SpeedMode::COMPETITION, s_activeProfileComp);
}

static void ensureInitialized() {
  if (!s_initialized) {
    initSpeedProfilesFromNVM();
    s_currentSpeedMode = nvm::loadSpeedMode();
    s_initialized = true;
  }
}

void setSpeedMode(SpeedMode mode) {
  ensureInitialized();
  s_currentSpeedMode = mode;
  nvm::saveSpeedMode(mode);
}

SpeedMode getSpeedMode() {
  ensureInitialized();
  return s_currentSpeedMode;
}

const SpeedProfile& getSpeedProfile() {
  ensureInitialized();
  if (s_currentSpeedMode == SpeedMode::COMPETITION) {
    return s_activeProfileComp;
  }
  return s_activeProfileTest;
}

SpeedProfile& getSpeedProfileWritable(SpeedMode mode) {
  ensureInitialized();
  if (mode == SpeedMode::COMPETITION) {
    return s_activeProfileComp;
  }
  return s_activeProfileTest;
}

void updateSpeedProfile(SpeedMode mode, const SpeedProfile& prof) {
  ensureInitialized();
  if (mode == SpeedMode::COMPETITION) {
    s_activeProfileComp = prof;
    s_activeProfileComp.name = "COMPETITION (Lomba / Full Power)";
  } else {
    s_activeProfileTest = prof;
    s_activeProfileTest.name = "TEST (Aman / Meja)";
  }
  nvm::saveProfileToNVM(mode, prof);
}
