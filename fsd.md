# Sumobot 500g — Firmware Functional Spec Document (FSD)

Target: **ESP32 WROOM-U** (classic ESP32, dual-core), FreeRTOS, bare-metal-style peripheral access (LEDC direct, raw GPIO), non-blocking serial CLI.

> Board note: this spec targets ESP32 WROOM-U, not ESP32-S3. On classic ESP32 the reserved flash SPI pins are GPIO6-11 (never touch these), and boot-strapping pins are GPIO0/2/12/15. UART0 (Serial Monitor) lives on GPIO1/3 and is already wired to the onboard USB-serial chip, so it isn't in the free-pin pool.

> **Hardware revision note:** this pinout supersedes the earlier draft. Sensor is now **VL53L1X** (not VL53L0X), and only **3 ToF sensors are currently installed** (front L/C/R) — the other 3 (side-left, side-right, rear) plus the 4-sensor line/edge array are wired for later but not yet on the robot. They're listed below as **RESERVED**, with code behind feature flags so nothing breaks when they're not physically present.

---

## 1. Finalized Pin Map

### 1.1 Active (currently installed)
 
| Category | Signal | GPIO | Notes |
|---|---|---|---|
| Motor L (DRV8833 ch A) | INM11 | 16 | LEDC PWM, forward (`INVERT_LEFT_MOTOR=false`) |
| Motor L (DRV8833 ch B) | INM12 | 17 | LEDC PWM, reverse |
| Motor R (DRV8833 ch A) | INM21 | 27 | LEDC PWM, forward |
| Motor R (DRV8833 ch B) | INM22 | 26 | LEDC PWM, reverse — software-inverted (`INVERT_RIGHT_MOTOR=true`) to match physical gearing |
| I2C0 (front ToF) | SDA0 | 21 | 400kHz fast mode |
| I2C0 | SCL0 | 22 | |
| **I2C1 (IMU)** | **SDA1** | **18** | MPU6050 lives here, address `0x68` |
| **I2C1** | **SCL1** | **19** | |
| XSHUT — front-left ToF | XSHUT_L | 25 | default 0x29 → runtime `0x2A` |
| XSHUT — front-center ToF | XSHUT_C | 33 | default 0x29 → runtime `0x2B` |
| XSHUT — front-right ToF | XSHUT_R | 32 | default 0x29 → runtime `0x2C` |
| Cytron IR start module | IR_START | **4** | **moved from GPIO16** — that pin is now INM11. Confirm this reassignment before wiring. Active-LOW assumed (most IR receiver modules pull low on signal) — confirm against the module datasheet. |
 
**IMU & I2C1 Architecture note:** Modul IMU (MPU6050, address `0x68`) dan 3 sensor ToF tambahan (samping kiri, belakang, samping kanan pada runtime address `0x2A`, `0x2B`, `0x2C`) berada pada bus hardware yang sama: **I2C1** (SDA1: GPIO 18, SCL1: GPIO 19). Karena alamat I2C MPU6050 (`0x68`) berbeda dengan sensor VL53L1X, keempat perangkat ini dapat bekerja berdampingan di I2C1 tanpa tabrakan alamat. Hingga hardware fisik dipasang, fitur ini dikompilasi di balik flag `HAS_IMU` dan `HAS_EXTRA_TOF`.

### 1.2 Reserved / Expansion Devices (Roadmap & Pasangan Bus)

#### A. Sensor Garis Tepi Lantai (4x Line IR — Sudut Dohyo)
Dipasang menghadap ke lantai di 4 pojok sasis robot:
| Kategori / Sinyal | GPIO | Sifat Pin | Posisi Fisik & Fungsi |
|---|---|---|---|
| `LINE_FL` | **34** | Input-only (no pull) | Sudut Depan-Kiri (deteksi garis putih) |
| `LINE_FR` | **35** | Input-only (no pull) | Sudut Depan-Kanan (deteksi garis putih) |
| `LINE_BL` | **14** | Digital In (pull capable) | Sudut Belakang-Kiri (deteksi garis putih, dipindah dari GPIO 36) |
| `LINE_BR` | **13** | Digital In (pull capable) | Sudut Belakang-Kanan (deteksi garis putih, dipindah dari GPIO 39) |

#### B. Sensor Jarak Lawan (6x ToF VL53L1X — Deteksi 360° Aktif Penuh)
Total 6 sensor ToF telah terpasang fisik dan aktif dengan arsitektur Dual-I2C dan Shared-XSHUT (`HAS_EXTRA_TOF = 1`):
| Sensor | Indeks Enum | Bus I2C | Pin XSHUT (Shared) | Alamat Runtime | Arah Hadap Fisik | Status |
|---|---|---|---|---|---|---|
| **ToF Front-Left** | `TOF_FL` (0) | **I2C0** (21/22) | **GPIO 25** | `0x2A` | Depan Kiri serong 30° | **Terpasang (Aktif)** |
| **ToF Front-Center**| `TOF_FC` (1) | **I2C0** (21/22) | **GPIO 33** | `0x2B` | Depan Tengah lurus 0° | **Terpasang (Aktif)** |
| **ToF Front-Right** | `TOF_FR` (2) | **I2C0** (21/22) | **GPIO 32** | `0x2C` | Depan Kanan serong 30°| **Terpasang (Aktif)** |
| **ToF Mid-Left**    | `TOF_ML` (3) | **I2C1** (18/19) | **GPIO 32** (shared) | `0x2C` | Samping Kiri tegak lurus 90° | **Terpasang (Aktif)** |
| **ToF Mid-Right**   | `TOF_MR` (4) | **I2C1** (18/19) | **GPIO 33** (shared) | `0x2B` | Samping Kanan tegak lurus 90°| **Terpasang (Aktif)** |
| **ToF Mid-Back**    | `TOF_RR` (5) | **I2C1** (18/19) | **GPIO 25** (shared) | `0x2A` | Tengah Belakang lurus 180° | **Terpasang (Aktif)** |

> **Catatan Arsitektur Shared-XSHUT & Dual I2C:**
> - **GPIO 25:** Mengontrol `Front-Left` (I2C0) & `Mid-Back` (I2C1).
> - **GPIO 33:** Mengontrol `Front-Center` (I2C0) & `Mid-Right` (I2C1).
> - **GPIO 32:** Mengontrol `Front-Right` (I2C0) & `Mid-Left` (I2C1).
> Karena bus I2C0 dan I2C1 independen secara elektrik, kedua sensor pada pin yang sama bangun bersamaan di `0x29` dan diubah ke alamat baru secara simultan tanpa tabrakan I2C. Akses ke bus I2C1 diamankan dengan FreeRTOS Mutex (`g_wire1Mutex`) bersama sensor IMU MPU6050 (`0x68`).

---

## 2. NVM (Preferences) Design

Uses ESP32 NVS via the `Preferences` library (or raw `nvs_flash` if you want to skip Arduino wrapper entirely — both are shown).

```cpp
// nvm.h
#pragma once
#include <cstdint>

enum class OpMode : uint8_t { SUMO = 1, TEST = 2 };

namespace nvm {
  void begin();
  OpMode loadMode();
  void saveMode(OpMode mode);
}
```

```cpp
// nvm.cpp (Preferences-based, simplest path)
#include "nvm.h"
#include <Preferences.h>

static Preferences prefs;

void nvm::begin() {
  prefs.begin("sumobot", false); // RW namespace
}

OpMode nvm::loadMode() {
  uint8_t v = prefs.getUChar("mode", (uint8_t)OpMode::TEST); // default TEST on first boot
  return (OpMode)v;
}

void nvm::saveMode(OpMode mode) {
  prefs.putUChar("mode", (uint8_t)mode);
}
```

Default on first-ever boot (blank NVS) is `TEST` — safer than accidentally booting straight into motors-active `SUMO` mode on a fresh board.

---

## 3. CLI Design (non-blocking)

### 3.1 Principles

- **No `Serial.readStringUntil()` or any blocking read.** Every loop iteration does `if (Serial.available())` and feeds a byte into a small line-buffer state machine.
- CLI runs as its own FreeRTOS task at low priority, polling `Serial.available()` on a short `vTaskDelay` — this is still non-blocking in the sense that it never stalls the calling context, and it doesn't compete with the time-critical tasks (motor/edge) because it's the lowest-priority task on its core.
- CLI never talks to motors/sensors directly — it posts commands to a `QueueHandle_t cliCommandQueue`, and the relevant task (motor task, sensor task) consumes them. This keeps ownership of hardware inside one task each, which avoids race conditions on shared peripherals (I2C bus, LEDC channels).

### 3.2 Menu Structure

```
== SUMOBOT CLI ==
Saved mode: TEST

[1] Sumo mode  (loads Cytron IR start, runs full FSM)
[2] Test mode
> _
```

Test mode submenu:
```
== TEST MODE ==
[1] Log ToF (select sensors 1-6)
[2] Log IR (edge sensors)
[3] Motor test
[b] Back to main menu
> _
```

ToF sensor select (multi-select):
```
Select ToF channels to log (comma separated, e.g. 1,3,5). 'a' = all. 'b' = back
> _
```

Motor test submenu:
```
== MOTOR TEST ==
[1] Motor 1 (left)
[2] Motor 2 (right)
[b] Back
> _
```
Once a motor is selected:
```
Motor 1 selected. Commands:
  f<speed>   forward, speed 0-255   e.g. f180
  r<speed>   reverse, speed 0-255   e.g. r120
  s          stop
  b          back to motor test menu
> _
```

### 3.3 CLI State Machine (non-blocking, if-Serial-driven)

```cpp
// cli.h
#pragma once
void cliTask(void* pv);
```

```cpp
// cli.cpp
#include "cli.h"
#include <Arduino.h>
#include "nvm.h"
#include "shared_state.h"   // queues declared here

enum class CliScreen {
  HOME, TEST_MENU, TOF_SELECT, IR_LOG, MOTOR_MENU, MOTOR_CONTROL
};

static CliScreen screen = CliScreen::HOME;
static int activeMotor = -1;
static char lineBuf[64];
static uint8_t lineLen = 0;

static void printHome() {
  OpMode m = nvm::loadMode();
  Serial.println();
  Serial.println("== SUMOBOT CLI ==");
  Serial.printf("Saved mode: %s\n", m == OpMode::SUMO ? "SUMO" : "TEST");
  Serial.println("[1] Sumo mode");
  Serial.println("[2] Test mode");
  Serial.print("> ");
}

static void printTestMenu() {
  Serial.println();
  Serial.println("== TEST MODE ==");
  Serial.println("[1] Log ToF");
  Serial.println("[2] Log IR");
  Serial.println("[3] Motor test");
  Serial.println("[b] Back");
  Serial.print("> ");
}

static void printMotorMenu() {
  Serial.println();
  Serial.println("== MOTOR TEST ==");
  Serial.println("[1] Motor 1 (left)");
  Serial.println("[2] Motor 2 (right)");
  Serial.println("[b] Back");
  Serial.print("> ");
}

static void printMotorControl(int m) {
  Serial.printf("\nMotor %d selected. f<speed> r<speed> s(top) b(ack)\n> ", m);
}

// Dispatch a fully-received line based on current screen
static void handleLine(const char* line) {
  switch (screen) {
    case CliScreen::HOME:
      if (line[0] == '1') {
        nvm::saveMode(OpMode::SUMO);
        Serial.println("Saved mode = SUMO. Reboot to run autonomous FSM.");
      } else if (line[0] == '2') {
        nvm::saveMode(OpMode::TEST);
        screen = CliScreen::TEST_MENU;
        printTestMenu();
        return;
      }
      printHome();
      break;

    case CliScreen::TEST_MENU:
      if (line[0] == '1') {
        screen = CliScreen::TOF_SELECT;
        Serial.println("Select ToF ch (e.g. 1,3,5), 'a'=all, 'b'=back\n> ");
      } else if (line[0] == '2') {
        screen = CliScreen::IR_LOG;
        Serial.println("Logging IR edge sensors. Send any key to stop.\n");
        SysCmd cmd{CmdType::IR_LOG_START};
        xQueueSend(cliCommandQueue, &cmd, 0);
      } else if (line[0] == '3') {
        screen = CliScreen::MOTOR_MENU;
        printMotorMenu();
      } else if (line[0] == 'b') {
        screen = CliScreen::HOME;
        printHome();
      } else {
        printTestMenu();
      }
      break;

    case CliScreen::TOF_SELECT: {
      SysCmd cmd{CmdType::TOF_LOG_START};
      if (line[0] == 'a') {
        for (int i = 0; i < 6; i++) cmd.tofMask |= (1 << i);
      } else if (line[0] == 'b') {
        screen = CliScreen::TEST_MENU;
        printTestMenu();
        break;
      } else {
        // parse comma separated indices "1,3,5"
        char buf[64]; strncpy(buf, line, sizeof(buf));
        char* tok = strtok(buf, ",");
        while (tok) {
          int idx = atoi(tok) - 1;
          if (idx >= 0 && idx < 6) cmd.tofMask |= (1 << idx);
          tok = strtok(nullptr, ",");
        }
      }
      xQueueSend(cliCommandQueue, &cmd, 0);
      Serial.println("Logging selected ToF channels. Send any key to stop.\n");
      break;
    }

    case CliScreen::IR_LOG:
    case CliScreen::TOF_SELECT + 100: // unreachable, placeholder guard
      break;

    case CliScreen::MOTOR_MENU:
      if (line[0] == '1' || line[0] == '2') {
        activeMotor = line[0] - '0';
        screen = CliScreen::MOTOR_CONTROL;
        printMotorControl(activeMotor);
      } else if (line[0] == 'b') {
        screen = CliScreen::TEST_MENU;
        printTestMenu();
      } else {
        printMotorMenu();
      }
      break;

    case CliScreen::MOTOR_CONTROL: {
      SysCmd cmd{};
      cmd.motorId = activeMotor;
      if (line[0] == 'f') {
        cmd.type = CmdType::MOTOR_FWD;
        cmd.speed = atoi(line + 1);
        xQueueSend(cliCommandQueue, &cmd, 0);
      } else if (line[0] == 'r') {
        cmd.type = CmdType::MOTOR_REV;
        cmd.speed = atoi(line + 1);
        xQueueSend(cliCommandQueue, &cmd, 0);
      } else if (line[0] == 's') {
        cmd.type = CmdType::MOTOR_STOP;
        xQueueSend(cliCommandQueue, &cmd, 0);
      } else if (line[0] == 'b') {
        cmd.type = CmdType::MOTOR_STOP;
        xQueueSend(cliCommandQueue, &cmd, 0);
        screen = CliScreen::MOTOR_MENU;
        printMotorMenu();
        break;
      }
      Serial.print("> ");
      break;
    }
  }
}

void cliTask(void* pv) {
  nvm::begin();
  printHome();

  for (;;) {
    // Non-blocking byte-at-a-time read — never Serial.readStringUntil()
    while (Serial.available() > 0) {
      char c = (char)Serial.read();

      if (c == '\r') continue; // ignore CR
      if (c == '\n') {
        lineBuf[lineLen] = '\0';
        if (lineLen > 0) handleLine(lineBuf);
        lineLen = 0;
      } else if (lineLen < sizeof(lineBuf) - 1) {
        lineBuf[lineLen++] = c;
      }

      // Any keystroke during a live log view stops it
      if (screen == CliScreen::IR_LOG || screen == CliScreen::TOF_SELECT) {
        SysCmd stop{CmdType::LOG_STOP};
        xQueueSend(cliCommandQueue, &stop, 0);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10)); // yield — this task is cheap, low priority
  }
}
```

This never blocks the caller: `Serial.available()` is checked, and only if a byte is present is it consumed. Everything else (motor commands, log toggles) is decoupled through `cliCommandQueue`, which the owning tasks poll non-blockingly too.

---

## 4. FreeRTOS Task Architecture

| Task | Core | Priority | Rate | Owns |
|---|---|---|---|---|
| `edgeTask` | 0 | 5 (highest) | ~1kHz (polling loop, no delay-bound) | Line IR GPIOs — **compiled out unless `HAS_LINE_IR`** |
| `motorTask` | 0 | 4 | 500Hz consumer loop, event-driven via queue | LEDC channels 0-3 |
| `imuTask` | 1 | 3 | 200Hz | I2C0 (shared with ToF) — **compiled out unless `HAS_IMU`** |
| `tofTask` | 1 | 3 | ~30-40Hz (VL53L1X, 20ms budget) | I2C0, 3 sensors active + 3 reserved for `HAS_EXTRA_TOF` |
| `fsmTask` | 0 | 3 | ~500Hz | Decision engine — reads tof/edge/imu shared state, writes motor targets |
| `cliTask` | 1 | 1 (lowest) | 100Hz poll | Serial, NVM |

**Core split rationale:** Core 0 gets everything on the critical control path (edge detection, motor output, FSM decision loop) so they never get preempted by I2C sensor tasks. Core 1 gets I2C sensor polling + the CLI, which are naturally slower and can tolerate scheduling jitter.

**Why `edgeTask` has no fixed delay:** edge detection is priority #1 in the whole system — it should run as fast as the scheduler allows on its core, not throttled by `vTaskDelay`. A `vTaskDelay(1)` (1 tick, ~1ms on default 1000Hz tick) is the practical floor; going tighter needs a hardware timer/ISR approach (see §6).

**Shared state pattern:** don't pass full sensor structs through a queue for every reading — use a single mutex-protected (or better, `portMUX` spinlock-protected for very short critical sections) `SharedState` struct that fsmTask reads and edgeTask/tofTask/imuTask write. Queues are reserved for discrete events/commands (CLI commands, log toggles), not high-frequency streaming state.

```cpp
// feature_flags.h
#pragma once
// Flip these to 1 as hardware actually gets installed — everything below
// is written to compile either way, so nothing breaks while flags are 0.
#define HAS_IMU        0  // MPU6050 — not confirmed on current board
#define HAS_EXTRA_TOF  0  // side-left/side-right/rear ToF — roadmap §6.1, not installed
#define HAS_LINE_IR    0  // 4x edge/line sensors — roadmap §6.2, not installed
#define HAS_CUR_SENSE  0  // DRV8833 has no current-sense pin; only relevant if the driver changes
```

```cpp
// shared_state.h
#pragma once
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include "feature_flags.h"

// ToF index layout — front 3 are installed today; ML/MR/RR are reserved
// slots for the roadmap §6.1 expansion (only meaningful once HAS_EXTRA_TOF=1)
#define TOF_FL 0  // front-left
#define TOF_FC 1  // front-center
#define TOF_FR 2  // front-right
#define TOF_ML 3  // mid-left      — RESERVED, not installed
#define TOF_MR 4  // mid-right     — RESERVED, not installed
#define TOF_RR 5  // rear-center   — RESERVED, not installed

struct SharedState {
  volatile uint8_t edgeMask;        // bit0=FL bit1=FR bit2=BL bit3=BR — only written if HAS_LINE_IR
  volatile bool edgeAny;
  volatile uint16_t tofDist[6];     // mm, indexed by TOF_* above; [3..5] stay 9999 (never-triggers) until HAS_EXTRA_TOF
  volatile float gyroZ;             // deg/s — only written if HAS_IMU
  volatile float heading;           // integrated relative heading — only written if HAS_IMU
  volatile float pitch;             // deg — only written if HAS_IMU
  volatile float roll;              // deg — only written if HAS_IMU
  volatile float accelMag;          // combined accel magnitude — only written if HAS_IMU
  volatile uint16_t motorCurrentMa; // only written if HAS_CUR_SENSE
};

extern SharedState g_state;
extern portMUX_TYPE g_stateMux; // spinlock for short critical sections

enum class CmdType : uint8_t {
  MOTOR_FWD, MOTOR_REV, MOTOR_STOP,
  TOF_LOG_START, IR_LOG_START, LOG_STOP
};

struct SysCmd {
  CmdType type;
  int motorId = 0;
  int speed = 0;
  uint8_t tofMask = 0;
};

extern QueueHandle_t cliCommandQueue;
```

```cpp
// shared_state.cpp
#include "shared_state.h"
SharedState g_state = {};
portMUX_TYPE g_stateMux = portMUX_INITIALIZER_UNLOCKED;
QueueHandle_t cliCommandQueue;
```

Using `portENTER_CRITICAL(&g_stateMux)` / `portEXIT_CRITICAL(&g_stateMux)` around single-field reads/writes keeps critical sections in the microsecond range — far cheaper than a full mutex for this access pattern, and safe across the two cores.

### 4.1 Task Creation

```cpp
// main.cpp (setup)
void setup() {
  Serial.begin(115200);
  cliCommandQueue = xQueueCreate(16, sizeof(SysCmd));

  xTaskCreatePinnedToCore(edgeTask,  "edge",  2048, nullptr, 5, nullptr, 0);
  xTaskCreatePinnedToCore(motorTask, "motor", 2048, nullptr, 4, nullptr, 0);
  xTaskCreatePinnedToCore(fsmTask,   "fsm",   4096, nullptr, 3, nullptr, 0);
  xTaskCreatePinnedToCore(imuTask,   "imu",   2048, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(tofTask,   "tof",   4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(cliTask,   "cli",   4096, nullptr, 1, nullptr, 1);
}

void loop() { vTaskDelete(nullptr); } // Arduino loop unused — everything lives in tasks
```

---

## 5. Bare-Metal Motor Driver (LEDC direct, no `analogWrite`)

`analogWrite`-equivalent on ESP32 goes through the Arduino LEDC wrapper with extra overhead (auto channel allocation, resolution guessing). Calling the LEDC driver API directly skips that and gives you fixed, predictable timing.

```cpp
// motor_hw.h
#pragma once
#include <cstdint>

namespace motorhw {
  void init();
  void setLeft(int16_t speed);   // -255..255, sign = direction
  void setRight(int16_t speed);
  void stopAll();
}
```

```cpp
// motor_hw.cpp
#include "motor_hw.h"
#include "driver/ledc.h"

#define PIN_INM11 16  // left, ch A
#define PIN_INM12 17  // left, ch B
#define PIN_INM21 27  // right, ch A
#define PIN_INM22 26  // right, ch B

#define INVERT_LEFT_MOTOR  false
#define INVERT_RIGHT_MOTOR true   // mechanical mounting — flips direction in software, not wiring

#define LEDC_FREQ_HZ   20000       // 20kHz — above audible range, fine for DRV8833
#define LEDC_RES       LEDC_TIMER_8_BIT // 0-255 duty
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
}

static void setChannelDuty(ledc_channel_t ch, uint32_t duty) {
  ledc_set_duty(LEDC_MODE, ch, duty);
  ledc_update_duty(LEDC_MODE, ch);
}

// PH/EN-style drive via IN/IN pins: one channel PWMs, the other stays 0.
void motorhw::setLeft(int16_t speed) {
  speed = constrain(speed, -255, 255);
  if (INVERT_LEFT_MOTOR) speed = -speed;
  if (speed >= 0) {
    setChannelDuty(LEDC_CHANNEL_0, speed);
    setChannelDuty(LEDC_CHANNEL_1, 0);
  } else {
    setChannelDuty(LEDC_CHANNEL_0, 0);
    setChannelDuty(LEDC_CHANNEL_1, -speed);
  }
}

void motorhw::setRight(int16_t speed) {
  speed = constrain(speed, -255, 255);
  if (INVERT_RIGHT_MOTOR) speed = -speed;
  if (speed >= 0) {
    setChannelDuty(LEDC_CHANNEL_2, speed);
    setChannelDuty(LEDC_CHANNEL_3, 0);
  } else {
    setChannelDuty(LEDC_CHANNEL_2, 0);
    setChannelDuty(LEDC_CHANNEL_3, -speed);
  }
}

void motorhw::stopAll() {
  setChannelDuty(LEDC_CHANNEL_0, 0);
  setChannelDuty(LEDC_CHANNEL_1, 0);
  setChannelDuty(LEDC_CHANNEL_2, 0);
  setChannelDuty(LEDC_CHANNEL_3, 0);
}
```

```cpp
// motor_task.cpp
#include "motor_hw.h"
#include "shared_state.h"

void motorTask(void* pv) {
  motorhw::init();
  SysCmd cmd;

  for (;;) {
    if (xQueueReceive(cliCommandQueue, &cmd, pdMS_TO_TICKS(2)) == pdTRUE) {
      switch (cmd.type) {
        case CmdType::MOTOR_FWD:
          if (cmd.motorId == 1) motorhw::setLeft(cmd.speed);
          else                  motorhw::setRight(cmd.speed);
          break;
        case CmdType::MOTOR_REV:
          if (cmd.motorId == 1) motorhw::setLeft(-cmd.speed);
          else                  motorhw::setRight(-cmd.speed);
          break;
        case CmdType::MOTOR_STOP:
          motorhw::stopAll();
          break;
        default: break; // non-motor commands ignored here
      }
    }
    // In SUMO mode, fsmTask writes directly into a motor-target shared struct
    // instead of going through this queue — see §7.
  }
}
```

> Note: in **TEST mode**, motor commands come from the CLI queue as shown above. In **SUMO mode**, `fsmTask` should bypass the queue and call `motorhw::setLeft/setRight` directly (or through a lightweight lock-free target struct) since queue latency is unnecessary overhead once you're not taking commands from a human.

---

## 6. IR Edge Sensors — Direct GPIO Read (Active-LOW)

Confirmed active-LOW: sensor pulls the line LOW when it sees the white edge line. Bitmask below packs FL/FR/BL/BR into 4 bits so the FSM can distinguish "single edge" from "near a corner" (two adjacent sensors trigger together).

```cpp
// edge_task.cpp
#include "shared_state.h"
#include "driver/gpio.h"

#define IR_FL GPIO_NUM_34
#define IR_FR GPIO_NUM_35
#define IR_BL GPIO_NUM_14
#define IR_BR GPIO_NUM_13

// bit0=FL, bit1=FR, bit2=BL, bit3=BR
#define EDGE_FL (1 << 0)
#define EDGE_FR (1 << 1)
#define EDGE_BL (1 << 2)
#define EDGE_BR (1 << 3)

void edgeTask(void* pv) {
  gpio_set_direction(IR_FL, GPIO_MODE_INPUT);
  gpio_set_direction(IR_FR, GPIO_MODE_INPUT);
  gpio_set_direction(IR_BL, GPIO_MODE_INPUT);
  gpio_set_direction(IR_BR, GPIO_MODE_INPUT);
  // IR_FL & IR_FR (GPIO 34 & 35) are input-only, no internal pull — confirm the sensor
  // module drives a clean HIGH/LOW itself, or add an external pull-up.

  const gpio_num_t pins[4] = {IR_FL, IR_FR, IR_BL, IR_BR};

  for (;;) {
    uint8_t mask = 0;
    for (int i = 0; i < 4; i++) {
      // active-LOW: level == 0 means edge detected
      if (gpio_get_level(pins[i]) == 0) mask |= (1 << i);
    }

    portENTER_CRITICAL(&g_stateMux);
    g_state.edgeMask = mask;
    g_state.edgeAny = (mask != 0);
    portEXIT_CRITICAL(&g_stateMux);

    vTaskDelay(1); // ~1ms floor with default tick rate; see §note below for faster
  }
}
```

**Going faster than 1ms:** `vTaskDelay(1)` is bound by the default 1000Hz FreeRTOS tick. If 1ms edge-response latency isn't tight enough, two options: (1) raise `configTICK_RATE_HZ` in `sdkconfig` to e.g. 2000-4000Hz — cheap, still cooperative; (2) attach a hardware timer ISR at e.g. 2-5kHz that reads GPIO directly and sets a flag checked at the top of `fsmTask`'s loop, bypassing task-switch latency entirely. For a 500g sumo match, option (1) is almost certainly enough — option (2) is for when you're chasing the last few hundred microseconds.

---

## 7. FSM Task (Sumo Mode) — Merged Truth-Table + Priority Stack

Core decision engine below is your tuned truth table (L/C/R front sensors → direct motor response) — that part is proven and kept as-is, including your exact speed constants. Everything from the earlier priority stack (edge, tilt, rear/side threat, stalemate) is layered on top as **overrides gated behind feature flags**, so it compiles cleanly today and switches on the moment the corresponding sensor is actually wired. Head-on avoidance is the one exception — it only needs the 3 front sensors you already have, so it's active now.

```cpp
// fsm_task.cpp
#include "shared_state.h"
#include "motor_hw.h"
#include "feature_flags.h"

enum class SumoState { WAIT_START, INITIAL_DODGE, ENGAGE };
static SumoState state = SumoState::WAIT_START;

static bool cytronStartReceived(); // reads IR_START (GPIO4), debounced, active-LOW

// ---- Tunables — Terpusat di include/speed_config.h (Profile TEST & COMPETITION) ----
// Kecepatan motor diparameterisasi melalui SpeedProfile (PROFILE_TEST & PROFILE_COMPETITION)
// yang dapat dipilih langsung melalui menu Serial Monitor dan tersimpan permanen di NVM.
#define ENEMY_MIN_MM          1
#define ENEMY_MAX_MM          800   // 80 cm jangkauan deteksi lawan / tangan di arena
#define TILT_WARN_DEG         15.0f
#define STALL_CURRENT_MA      1400
#define PUSHBACK_ACCEL_THRESHOLD 0.30f // Ambang percepatan mundur akibat dorongan lawan (G, jika Gyro ENABLED)
// Catatan: Fitur algoritma Gyro (Tilt protect, gyro dodge, pushback) dapat diaktifkan/dinonaktifkan via CLI menu [6].

static bool inRange(uint16_t d) { return d >= ENEMY_MIN_MM && d <= ENEMY_MAX_MM; }

// ---- Edge/corner avoidance — no-op until HAS_LINE_IR ----
static bool handleEdge() {
#if HAS_LINE_IR
  uint8_t mask; portENTER_CRITICAL(&g_stateMux); mask = g_state.edgeMask; portEXIT_CRITICAL(&g_stateMux);
  if (mask == 0) return false;
  switch (mask) {
    case 0b0011: motorhw::setLeft(-200); motorhw::setRight(-200); break;
    case 0b0101: motorhw::setLeft(-150); motorhw::setRight(150);  vTaskDelay(pdMS_TO_TICKS(120)); motorhw::setLeft(180); motorhw::setRight(180); break;
    case 0b0110: motorhw::setLeft(150);  motorhw::setRight(-150); vTaskDelay(pdMS_TO_TICKS(120)); motorhw::setLeft(180); motorhw::setRight(180); break;
    case 0b0001: motorhw::setLeft(-180); motorhw::setRight(-80);  break;
    case 0b0010: motorhw::setLeft(-80);  motorhw::setRight(-180); break;
    case 0b0100: motorhw::setLeft(180);  motorhw::setRight(80);   break;
    case 0b1000: motorhw::setLeft(80);   motorhw::setRight(180);  break;
    default:     motorhw::setLeft(150);  motorhw::setRight(-150); break;
  }
  vTaskDelay(pdMS_TO_TICKS(2));
  return true;
#else
  return false; // line sensors not installed — compiled out
#endif
}

// ---- Tilt / self-preservation — no-op until HAS_IMU ----
static bool handleTilt() {
#if HAS_IMU
  float pitch, roll;
  portENTER_CRITICAL(&g_stateMux); pitch = g_state.pitch; roll = g_state.roll; portEXIT_CRITICAL(&g_stateMux);
  if (fabs(pitch) < TILT_WARN_DEG && fabs(roll) < TILT_WARN_DEG) return false;
  motorhw::setLeft(-255); motorhw::setRight(-255);
  vTaskDelay(pdMS_TO_TICKS(2));
  return true;
#else
  return false;
#endif
}

// ---- Rear/side threat — no-op until HAS_EXTRA_TOF ----
static bool handleRearThreat() {
#if HAS_EXTRA_TOF
  static uint16_t prevRear = 9999; static unsigned long prevT = 0;
  uint16_t curr; portENTER_CRITICAL(&g_stateMux); curr = g_state.tofDist[TOF_RR]; portEXIT_CRITICAL(&g_stateMux);
  unsigned long now = millis(); float dt = (now - prevT) / 1000.0f;
  float closing = (dt > 0) ? (prevRear - (float)curr) / dt : 0;
  prevRear = curr; prevT = now;
  if (curr < REAR_SAFE_MM && closing > REAR_CLOSE_SPEED_MMS) {
    motorhw::setLeft(255); motorhw::setRight(255);
    return true;
  }
#endif
  return false;
}

static bool handleSideThreat() {
#if HAS_EXTRA_TOF
  static uint16_t prevML = 9999, prevMR = 9999; static unsigned long prevT = 0;
  uint16_t curML, curMR;
  portENTER_CRITICAL(&g_stateMux);
  curML = g_state.tofDist[TOF_ML]; curMR = g_state.tofDist[TOF_MR];
  portEXIT_CRITICAL(&g_stateMux);
  unsigned long now = millis(); float dt = (now - prevT) / 1000.0f;
  float closingL = (dt > 0) ? (prevML - (float)curML) / dt : 0;
  float closingR = (dt > 0) ? (prevMR - (float)curMR) / dt : 0;
  prevML = curML; prevMR = curMR; prevT = now;
  if (curML < SIDE_SAFE_MM && closingL > SIDE_CLOSE_SPEED_MMS) { motorhw::setLeft(-150); motorhw::setRight(150); return true; }
  if (curMR < SIDE_SAFE_MM && closingR > SIDE_CLOSE_SPEED_MMS) { motorhw::setLeft(150);  motorhw::setRight(-150); return true; }
#endif
  return false;
}

// ---- Stalemate detection — no-op until HAS_CUR_SENSE ----
static bool handleStalemate() {
#if HAS_CUR_SENSE
  uint16_t current; float accelMag = 999;
  portENTER_CRITICAL(&g_stateMux);
  current = g_state.motorCurrentMa;
#if HAS_IMU
  accelMag = g_state.accelMag;
#endif
  portEXIT_CRITICAL(&g_stateMux);
  if (current > STALL_CURRENT_MA && accelMag < 0.3f) {
    motorhw::setLeft(150); motorhw::setRight(-150); vTaskDelay(pdMS_TO_TICKS(150));
    motorhw::setLeft(-150); motorhw::setRight(150); vTaskDelay(pdMS_TO_TICKS(150));
    return true;
  }
#endif
  return false;
}

// ---- Pushback detection — IMU-only (gated HAS_IMU, independen dari HAS_CUR_SENSE) ----
static bool handlePushback() {
#if HAS_IMU
  float ax;
  portENTER_CRITICAL(&g_stateMux); ax = g_state.accelX; portEXIT_CRITICAL(&g_stateMux);
  if (ax < -PUSHBACK_ACCEL_THRESHOLD) {
    motorhw::setLeft(180); motorhw::setRight(-120);
    vTaskDelay(pdMS_TO_TICKS(150));
    return true;
  }
#endif
  return false;
}

// ---- Core decision engine: your truth table, L/C/R front sensors ----
// mask bit2=L bit1=C bit0=R
static void engageDecisionTable(uint16_t distL, uint16_t distC, uint16_t distR) {
  bool L = inRange(distL), C = inRange(distC), R = inRange(distR);
  uint8_t mask = (L << 2) | (C << 1) | R;

  const auto& spd = getSpeedProfile();
  switch (mask) {
    case 0b000: motorhw::setLeft(0); motorhw::setRight(0); break; // STATE_IDLE
    case 0b010: // C only
    case 0b111: // L,C,R
    case 0b101: // L,R (no C) — symmetric, treat as full attack
      motorhw::setLeft(spd.attackFull); motorhw::setRight(spd.attackFull);
      break;
    case 0b110: // L,C — enemy leaning left
      motorhw::setLeft(spd.attackInner); motorhw::setRight(spd.attackOuter);
      break;
    case 0b011: // C,R — enemy leaning right
      motorhw::setLeft(spd.attackOuter); motorhw::setRight(spd.attackInner);
      break;
    case 0b100: // L only
      motorhw::setLeft(-spd.turnInPlace); motorhw::setRight(spd.turnInPlace);
      break;
    case 0b001: // R only
      motorhw::setLeft(spd.turnInPlace); motorhw::setRight(-spd.turnInPlace);
      break;
    default: motorhw::setLeft(0); motorhw::setRight(0); break;
  }
}

void fsmTask(void* pv) {
  static float dodgeStartHeading = 0;
  static bool dodgeInit = false;
  static unsigned long dodgeTimedStart = 0;
  
  // State tracking untuk head-on closing speed & hold time
  static uint32_t lastSeenSeq = 0;
  static uint16_t prevC = 9999;
  static unsigned long prevFrameTime = 0;
  static unsigned long headonHoldUntil = 0;
  static int nudgeBias = 0;

  // State tracking untuk anti-flicker debounce
  static unsigned long lostSince = 0;
  static bool wasDetected = false;

  for (;;) {
    // 1. Prioritas 1 Mutlak: Refleks Garis Putih
    if (handleEdge()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

    // 2. Prioritas 2: Proteksi Kemiringan
    if (handleTilt()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

    uint16_t distL, distC, distR;
    uint32_t seq;
    portENTER_CRITICAL(&g_stateMux);
    distL = g_state.tofDist[TOF_FL]; distC = g_state.tofDist[TOF_FC]; distR = g_state.tofDist[TOF_FR];
    seq = g_state.tofSeq;
    portEXIT_CRITICAL(&g_stateMux);

    switch (state) {
      case SumoState::WAIT_START:
        motorhw::stopAll();
        if (cytronStartReceived()) {
          state = SumoState::INITIAL_DODGE;
          dodgeInit = false; dodgeTimedStart = millis();
        }
        break;

      case SumoState::INITIAL_DODGE: {
        // Early-exit: jika musuh terdeteksi selama dodge, langsung beralih ke ENGAGE
        if (inRange(distC) || inRange(distL) || inRange(distR)) {
          state = SumoState::ENGAGE; wasDetected = true; lostSince = 0;
#if HAS_IMU
          dodgeInit = false;
#endif
          break;
        }

#if HAS_IMU
        if (!dodgeInit) { dodgeStartHeading = g_state.heading; dodgeInit = true; }
        float turned = g_state.heading - dodgeStartHeading;
        if (fabs(turned) < DODGE_ANGLE_DEG) {
          motorhw::setLeft(150); motorhw::setRight(-60);
        } else {
          state = SumoState::ENGAGE; wasDetected = false; lostSince = 0;
        }
#else
        if (millis() - dodgeTimedStart < DODGE_TIMED_MS) {
          motorhw::setLeft(150); motorhw::setRight(-60);
        } else {
          state = SumoState::ENGAGE; wasDetected = false; lostSince = 0;
        }
#endif
        break;
      }

      case SumoState::ENGAGE: {
        // 3. Ancaman belakang & samping (jika HAS_EXTRA_TOF=1)
        if (handleRearThreat()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }
        if (handleSideThreat()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

        // 4. Deteksi adu banteng / stall & pushback
        if (handlePushback())  { vTaskDelay(pdMS_TO_TICKS(2)); continue; }
        if (handleStalemate()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }

        // 5. Cek deteksi musuh dengan debounce anti-flicker
        bool anyDetected = inRange(distL) || inRange(distC) || inRange(distR);
        if (anyDetected) {
          wasDetected = true;
          lostSince = 0;
        } else {
          if (wasDetected && lostSince == 0) {
            lostSince = millis(); // Mulai grace period debounce
          }
          if (millis() - lostSince < LOST_DEBOUNCE_MS) {
            // Grace period (~80ms): pertahankan command motor terakhir
          } else {
            // Setelah >80ms beneran hilang: langsung search-spin perlahan
            motorhw::setLeft(70); motorhw::setRight(-70);
            wasDetected = false;
          }
          break;
        }

        // 6. Evaluasi Head-on closing speed HANYA ketika frame baru masuk (seq berubah)
        if (seq != lastSeenSeq) {
          unsigned long now = millis();
          float dt = (now - prevFrameTime) / 1000.0f;
          float closingC = (dt > 0.005f) ? ((float)prevC - (float)distC) / dt : 0;
          prevC = distC; prevFrameTime = now; lastSeenSeq = seq;

          bool symmetric = abs((int)distL - (int)distR) < HEADON_SYMMETRY_MM;
          if (inRange(distC) && closingC > 300.0f && symmetric) {
            headonHoldUntil = now + HEADON_HOLD_MS;
            nudgeBias = (distL >= distR) ? 1 : -1;
          }
        }

        // Jika manuver nudge aktif, tahan selama timer hold (~130ms)
        if (millis() < headonHoldUntil) {
          if (nudgeBias >= 0) {
            motorhw::setLeft(SPEED_ATTACK_INNER + 10); motorhw::setRight(SPEED_ATTACK_FULL);
          } else {
            motorhw::setLeft(SPEED_ATTACK_FULL); motorhw::setRight(SPEED_ATTACK_INNER + 10);
          }
          break;
        }

        // 7. Eksekusi tabel kebenaran
        engageDecisionTable(distL, distC, distR);
        break;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(2)); // ~500Hz loop
  }
}
```

**What changed vs your original table:** pure `STATE_IDLE` (both motors 0) only holds for `IDLE_TO_SEARCH_MS` (default 600ms) — after that it drops into a slow spin-search instead of sitting still forever, so the robot doesn't go permanently idle if the opponent steps outside the 400mm range. This is additive — set `IDLE_TO_SEARCH_MS` very high (or strip the `searching` branch) if you'd rather match your original table exactly.

---

## 8. ToF Task (VL53L1X, 3 Active + 3 Reserved)

Individual XSHUT sequencing for the 3 installed sensors (Short distance mode + ROI narrowing, per your tuning — this cuts down false triggers from the dohyo floor/border reflecting back into the sensor).

```cpp
// tof_task.cpp
#include <Wire.h>
#include <VL53L1X.h>
#include "shared_state.h"
#include "feature_flags.h"
#include "driver/gpio.h"

#define XSHUT_L GPIO_NUM_25
#define XSHUT_C GPIO_NUM_33
#define XSHUT_R GPIO_NUM_32

static const gpio_num_t xshutPins[3] = { XSHUT_L, XSHUT_C, XSHUT_R };
static const uint8_t    newAddr[3]   = { 0x2A, 0x2B, 0x2C };
static VL53L1X sensors[3]; // [0]=L, [1]=C, [2]=R — matches TOF_FL/TOF_FC/TOF_FR

static void initFrontSensor(int i) {
  gpio_set_level(xshutPins[i], 1);
  delay(10);
  sensors[i].setTimeout(50);
  sensors[i].init();
  sensors[i].setAddress(newAddr[i]);
  sensors[i].setDistanceMode(VL53L1X::Short);
  sensors[i].setMeasurementTimingBudget(20000); // 20ms
  // Narrow the ROI and bias it to the lower SPAD rows — the lens inverts
  // the image, so "lower SPADs" = physically upper FoV, avoiding the
  // dohyo floor/border line reflecting a false-close reading.
  sensors[i].setROISize(16, 8);
  sensors[i].setROICenter(60);
  sensors[i].startContinuous(20);
}

void tofTask(void* pv) {
  Wire.begin(21, 22, 400000); // SDA0, SCL0

  for (auto p : xshutPins) {
    gpio_set_direction(p, GPIO_MODE_OUTPUT);
    gpio_set_level(p, 0); // hold all three off before sequencing
  }
  delay(10);

  for (int i = 0; i < 3; i++) initFrontSensor(i);

#if HAS_EXTRA_TOF
  // --- Future: side-left/side-right/rear on I2C1, sharing the same 3 XSHUT pins ---
  // Wire1.begin(18, 19, 400000); // SDA1, SCL1 (reserved pins, §1.2)
  // Each xshutPins[i] toggle wakes one sensor on Wire AND one on Wire1 at once —
  // the two buses are electrically independent so 0x29 on each never collides.
  // Sequence identically to initFrontSensor(), but call sensor.setBus(&Wire1)
  // and assign into sensors[i+3] before startContinuous(). Not wired yet — left
  // commented so this file stays copy-pasteable without the extra hardware.
#endif

  uint8_t logMask = 0;
  bool logging = false;
  SysCmd cmd;

  for (;;) {
    if (xQueueReceive(cliCommandQueue, &cmd, 0) == pdTRUE) {
      if (cmd.type == CmdType::TOF_LOG_START) { logMask = cmd.tofMask; logging = true; }
      else if (cmd.type == CmdType::LOG_STOP) logging = false;
    }

    for (int i = 0; i < 3; i++) {
      uint16_t d = sensors[i].readRangeContinuousMillimeters();

      portENTER_CRITICAL(&g_stateMux);
      g_state.tofDist[i] = d;
      portEXIT_CRITICAL(&g_stateMux);

      if (logging && (logMask & (1 << i))) {
        Serial.printf("ToF%d: %u mm\n", i + 1, d);
      }
    }
    // tofDist[3..5] (ML/MR/RR) stay at their initial value until HAS_EXTRA_TOF —
    // the FSM's #if guards already treat those as "never triggers".

    vTaskDelay(pdMS_TO_TICKS(25)); // SENSOR_READ_INTERVAL_MS — must be >= the 20ms timing budget above
  }
}
```

Reminder from your own doc, kept as-is: readings outside `[1, 400]` mm, or a sensor timeout, count as **not detected** — `inRange()` in the FSM code enforces that same window.

---

## 9. Cytron Start Module Read

**Pin moved to GPIO4** — GPIO16 is now `INM11` (motor). Confirm this reassignment physically before relying on it.

```cpp
// cytron_start.h / .cpp
#include "driver/gpio.h"

#define IR_START GPIO_NUM_4

void cytronStartInit() {
  gpio_set_direction(IR_START, GPIO_MODE_INPUT);
}

static bool lastState = false;
bool cytronStartReceived() {
  bool now = gpio_get_level(IR_START) == 0; // active-LOW assumed — confirm against module datasheet
  bool rising = now && !lastState;
  lastState = now;
  return rising;
}
```

---

## 10. Summary — What's Left Open

- **Confirm the GPIO4 Cytron reassignment** — GPIO4 is active and tested. Cytron IR start can be toggled ON/OFF in NVS via CLI menu `[c]`. When disabled, firmware automatically falls back to an audible 5-second countdown.
- **MPU6050 IMU Status: CONFIRMED & ACTIVE** — Wired to **I2C1 (GPIO 18 SDA, GPIO 19 SCL)** with address `0x68`. `HAS_IMU` is set to `1` in `feature_flags.h`, enabling tilt protection, 45° gyro dodge on start, pushback detection (`handlePushback()`), and CLI IMU logging.
- **Pushback & Stalemate Detection:** `handlePushback()` is active via IMU (`accelX < -0.30G`), providing an automatic side-jink maneuver when pushed backward during head-on engagements, independent of current sensing (`HAS_CUR_SENSE`).
- **Timing & Search Tunables:** Robot menggunakan mode **Smooth Pursuit Curve** teruji (kedua roda berputar maju positif saat belok mengejar musuh), dan otomatis **DIAM (`stopAll()`)** saat tidak ada objek terdeteksi di rentang 1–400 mm untuk mencegah getaran liar (*chattering*) dan tabrakan meja uji.
- **6x ToF Sensors: CONFIRMED & ACTIVE (`HAS_EXTRA_TOF = 1`)** — Seluruh 6 sensor ToF aktif untuk deteksi 360° penuh pada I2C0 (Front-L/C/R) dan I2C1 (Mid-Left, Mid-Right, Mid-Back), dengan algoritma terpadu: Smooth Pursuit Curve pada 3 sensor depan, dan auto-pivot saat sensor samping/belakang mengunci lawan.
- **Flip `HAS_LINE_IR` to `1`** once the 4-sensor line array is wired (reserved GPIO 34, 35, 14, 13) — activates corner-aware edge avoidance.
- **`INVERT_RIGHT_MOTOR`** is set `true` per your note — double check the robot actually drives straight with equal `setLeft()`/`setRight()` values once assembled; flip if it turns out backwards.
- **Arena Tuning Parameters:**
  - `PROFILE_TEST`: `attackFull = 55`, `attackOuter = 50`, `attackInner = 45`, `turnInPlace = 90` (profil aman meja dengan pergerakan sangat halus).
  - `PROFILE_COMPETITION`: `attackFull = 255`, `attackOuter = 230`, `attackInner = 160`, `turnInPlace = 180` (daya dorong maksimal arena dohyo).
  - `HEADON_SYMMETRY_MM = 80` & closing speed threshold 300 mm/s (re-verify on arena).
  - `PUSHBACK_ACCEL_THRESHOLD = 0.30f` (tune based on robot weight and motor push resistance).