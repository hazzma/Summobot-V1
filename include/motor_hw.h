#pragma once

#include <cstdint>

namespace motorhw {
  void init();
  void setLeft(int16_t speed);   // -255..255 (negatif = mundur, positif = maju)
  void setRight(int16_t speed);  // -255..255
  void stopAll();
}

void motorTask(void* pv);
