#include "cytron_start.h"
#include <Arduino.h>
#include "driver/gpio.h"

#define IR_START GPIO_NUM_4

void cytronStartInit() {
  gpio_set_direction(IR_START, GPIO_MODE_INPUT);
  gpio_pullup_en(IR_START); // Aktifkan pullup internal untuk pin input active-LOW
}

static bool lastState = false;
static unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 20;

bool cytronStartReceived() {
  // Active-LOW: Sinyal low berarti remote trigger aktif
  bool rawReading = (gpio_get_level(IR_START) == 0);
  unsigned long now = millis();

  if (rawReading != lastState) {
    lastDebounceTime = now;
    lastState = rawReading;
  }

  // Jika kondisi low stabil melampaui waktu debounce
  if (rawReading && (now - lastDebounceTime > DEBOUNCE_DELAY_MS)) {
    return true;
  }

  return false;
}
