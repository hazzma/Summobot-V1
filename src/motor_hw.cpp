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

#include "speed_config.h"
#include <algorithm>

static volatile int16_t s_targetLeft = 0;
static volatile int16_t s_targetRight = 0;
static int16_t s_currentLeft = 0;
static int16_t s_currentRight = 0;

static void applyHardwareDutyLeft(int16_t speed) {
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

static void applyHardwareDutyRight(int16_t speed) {
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

void motorhw::setLeft(int16_t speed) {
  s_targetLeft = constrain(speed, -255, 255);
}

void motorhw::setRight(int16_t speed) {
  s_targetRight = constrain(speed, -255, 255);
}

void motorhw::setTarget(int16_t left, int16_t right) {
  s_targetLeft = constrain(left, -255, 255);
  s_targetRight = constrain(right, -255, 255);
}

void motorhw::setImmediate(int16_t left, int16_t right) {
  s_targetLeft = s_currentLeft = constrain(left, -255, 255);
  s_targetRight = s_currentRight = constrain(right, -255, 255);
  applyHardwareDutyLeft(s_currentLeft);
  applyHardwareDutyRight(s_currentRight);
}

void motorhw::stopAll(bool immediate) {
  s_targetLeft = 0;
  s_targetRight = 0;
  if (immediate) {
    s_currentLeft = 0;
    s_currentRight = 0;
    applyHardwareDutyLeft(0);
    applyHardwareDutyRight(0);
  }
}

void motorhw::updateRamp() {
  int16_t rate = getSpeedProfile().accelRate;

  if (rate <= 0 || rate >= 255) {
    // Respon instan tanpa kurva ramp
    s_currentLeft = s_targetLeft;
    s_currentRight = s_targetRight;
  } else {
    // Kurva Akselerasi (Slew Rate Limiter - Anti Jengat / Wheelie)
    if (s_currentLeft < s_targetLeft) {
      s_currentLeft = std::min((int16_t)(s_currentLeft + rate), (int16_t)s_targetLeft);
    } else if (s_currentLeft > s_targetLeft) {
      s_currentLeft = std::max((int16_t)(s_currentLeft - rate), (int16_t)s_targetLeft);
    }

    if (s_currentRight < s_targetRight) {
      s_currentRight = std::min((int16_t)(s_currentRight + rate), (int16_t)s_targetRight);
    } else if (s_currentRight > s_targetRight) {
      s_currentRight = std::max((int16_t)(s_currentRight - rate), (int16_t)s_targetRight);
    }
  }

  applyHardwareDutyLeft(s_currentLeft);
  applyHardwareDutyRight(s_currentRight);
}

int16_t motorhw::getCurrentLeft()  { return s_currentLeft; }
int16_t motorhw::getCurrentRight() { return s_currentRight; }
int16_t motorhw::getTargetLeft()   { return s_targetLeft; }
int16_t motorhw::getTargetRight()  { return s_targetRight; }
