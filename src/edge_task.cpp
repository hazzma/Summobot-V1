#include "edge_task.h"
#include <Arduino.h>
#include "shared_state.h"
#include "feature_flags.h"
#include "driver/gpio.h"

#if HAS_LINE_IR
#define IR_FL GPIO_NUM_34
#define IR_FR GPIO_NUM_35
#define IR_BL GPIO_NUM_36
#define IR_BR GPIO_NUM_39

#define EDGE_FL (1 << 0)
#define EDGE_FR (1 << 1)
#define EDGE_BL (1 << 2)
#define EDGE_BR (1 << 3)
#endif

void edgeTask(void* pv) {
#if HAS_LINE_IR
  const gpio_num_t pins[4] = {IR_FL, IR_FR, IR_BL, IR_BR};
  for (int i = 0; i < 4; i++) {
    gpio_set_direction(pins[i], GPIO_MODE_INPUT);
  }

  for (;;) {
    bool logging = g_state.logIR;

    uint8_t mask = 0;
    for (int i = 0; i < 4; i++) {
      // Active-LOW: Sinyal 0 menandakan garis putih terdeteksi
      if (gpio_get_level(pins[i]) == 0) {
        mask |= (1 << i);
      }
    }

    portENTER_CRITICAL(&g_stateMux);
    g_state.edgeMask = mask;
    g_state.edgeAny = (mask != 0);
    portEXIT_CRITICAL(&g_stateMux);

    if (logging) {
      Serial.printf("EDGE: FL=%d FR=%d BL=%d BR=%d (mask=0x%02X)\n",
                    (mask & EDGE_FL) ? 1 : 0,
                    (mask & EDGE_FR) ? 1 : 0,
                    (mask & EDGE_BL) ? 1 : 0,
                    (mask & EDGE_BR) ? 1 : 0,
                    mask);
    }

    vTaskDelay(pdMS_TO_TICKS(1)); // ~1ms polling loop
  }
#else
  unsigned long lastWarn = 0;
  for (;;) {
    if (g_state.logIR) {
      unsigned long now = millis();
      if (now - lastWarn >= 1500) {
        lastWarn = now;
        Serial.println("[INFO] Sensor garis IR belum terpasang (HAS_LINE_IR = 0 di include/feature_flags.h).");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
#endif
}
