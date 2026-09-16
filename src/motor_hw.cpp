#include "motor_hw.h"
#include <Arduino.h>
#include "driver/ledc.h"

#define PIN_INM11 16  // Left, IN1
#define PIN_INM12 17  // Left, IN2
#define PIN_INM21 27  // Right, IN1
#define PIN_INM22 26  // Right, IN2

#define INVERT_LEFT_MOTOR  false  // Dibalik agar maju/mundur sesuai fisik robot
#define INVERT_RIGHT_MOTOR true   // Disesuaikan dengan arah kiri

#define LEDC_FREQ_HZ   20000            // 20 kHz ultrasonic (senyap)
#define LEDC_RES       LEDC_TIMER_8_BIT // Resolusi 8-bit (0-255 duty cycle)
#define LEDC_TIMER     LEDC_TIMER_0
#define LEDC_MODE      LEDC_LOW_SPEED_MODE

static void configChannel(ledc_channel_t ch, int gpio) {
  ledc_channel_config_t cfg = {
    .gpio_num   = gpio,
    .speed_mode = LEDC_MODE,
    .channel    = ch,
    .intr_type  = LEDC_INTR_DISABLE,
    .timer_sel  = LEDC_TIMER,
    .duty       = 0,
    .hpoint     = 0
  };
  ledc_channel_config(&cfg);
}

void motorhw::init() {
  ledc_timer_config_t timer = {
    .speed_mode      = LEDC_MODE,
    .duty_resolution = LEDC_RES,
    .timer_num       = LEDC_TIMER,
    .freq_hz         = LEDC_FREQ_HZ,
    .clk_cfg         = LEDC_AUTO_CLK
  };
  ledc_timer_config(&timer);

  configChannel(LEDC_CHANNEL_0, PIN_INM11);
  configChannel(LEDC_CHANNEL_1, PIN_INM12);
  configChannel(LEDC_CHANNEL_2, PIN_INM21);
  configChannel(LEDC_CHANNEL_3, PIN_INM22);

  stopAll();
}

static void setChannelDuty(ledc_channel_t ch, uint32_t duty) {
  ledc_set_duty(LEDC_MODE, ch, duty);
  ledc_update_duty(LEDC_MODE, ch);
}

void motorhw::setLeft(int16_t speed) {
  speed = constrain(speed, -255, 255);
  if (INVERT_LEFT_MOTOR) speed = -speed;
  if (speed > 0) {
    setChannelDuty(LEDC_CHANNEL_0, (uint32_t)speed);
    setChannelDuty(LEDC_CHANNEL_1, 0);
  } else if (speed < 0) {
    setChannelDuty(LEDC_CHANNEL_0, 0);
    setChannelDuty(LEDC_CHANNEL_1, (uint32_t)(-speed));
  } else {
    setChannelDuty(LEDC_CHANNEL_0, 0);
    setChannelDuty(LEDC_CHANNEL_1, 0);
  }
}

void motorhw::setRight(int16_t speed) {
  speed = constrain(speed, -255, 255);
  if (INVERT_RIGHT_MOTOR) speed = -speed;
  if (speed > 0) {
    setChannelDuty(LEDC_CHANNEL_2, (uint32_t)speed);
    setChannelDuty(LEDC_CHANNEL_3, 0);
  } else if (speed < 0) {
    setChannelDuty(LEDC_CHANNEL_2, 0);
    setChannelDuty(LEDC_CHANNEL_3, (uint32_t)(-speed));
  } else {
    setChannelDuty(LEDC_CHANNEL_2, 0);
    setChannelDuty(LEDC_CHANNEL_3, 0);
  }
}

void motorhw::stopAll() {
  setChannelDuty(LEDC_CHANNEL_0, 0);
  setChannelDuty(LEDC_CHANNEL_1, 0);
  setChannelDuty(LEDC_CHANNEL_2, 0);
  setChannelDuty(LEDC_CHANNEL_3, 0);
}
