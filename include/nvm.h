#pragma once

#include <cstdint>
#include "speed_config.h"

enum class OpMode : uint8_t {
  SUMO = 1,
  TEST = 2
};

namespace nvm {
  void begin();
  OpMode loadMode();
  void saveMode(OpMode mode);
  bool isCytronEnabled();
  void setCytronEnabled(bool enabled);
  SpeedMode loadSpeedMode();
  void saveSpeedMode(SpeedMode mode);
  bool isGyroEnabled();
  void setGyroEnabled(bool enabled);
  bool loadProfileFromNVM(SpeedMode mode, SpeedProfile& out);
  void saveProfileToNVM(SpeedMode mode, const SpeedProfile& in);
}
