#include "speed_config.h"
#include "nvm.h"

static SpeedMode s_currentSpeedMode = SpeedMode::TEST;
static bool s_initialized = false;

static void ensureInitialized() {
  if (!s_initialized) {
    s_currentSpeedMode = nvm::loadSpeedMode();
    s_initialized = true;
  }
}

void setSpeedMode(SpeedMode mode) {
  s_currentSpeedMode = mode;
  s_initialized = true;
  nvm::saveSpeedMode(mode);
}

SpeedMode getSpeedMode() {
  ensureInitialized();
  return s_currentSpeedMode;
}

const SpeedProfile& getSpeedProfile() {
  ensureInitialized();
  if (s_currentSpeedMode == SpeedMode::COMPETITION) {
    return PROFILE_COMPETITION;
  }
  return PROFILE_TEST;
}
