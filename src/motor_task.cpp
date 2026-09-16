#include "motor_hw.h"
#include "shared_state.h"

void motorTask(void* pv) {
  motorhw::init();
  SysCmd cmd;

  for (;;) {
    // Pada mode TEST, motorTask mengonsumsi perintah dari antrean CLI
    if (cliCommandQueue != nullptr &&
        xQueueReceive(cliCommandQueue, &cmd, pdMS_TO_TICKS(5)) == pdTRUE) {
      switch (cmd.type) {
        case CmdType::MOTOR_FWD:
          if (cmd.motorId == 1) motorhw::setLeft(cmd.speed);
          else if (cmd.motorId == 2) motorhw::setRight(cmd.speed);
          else if (cmd.motorId == 3) { motorhw::setLeft(cmd.speed); motorhw::setRight(cmd.speed); }
          break;
        case CmdType::MOTOR_REV:
          if (cmd.motorId == 1) motorhw::setLeft(-cmd.speed);
          else if (cmd.motorId == 2) motorhw::setRight(-cmd.speed);
          else if (cmd.motorId == 3) { motorhw::setLeft(-cmd.speed); motorhw::setRight(-cmd.speed); }
          break;
        case CmdType::MOTOR_STOP:
          motorhw::stopAll();
          break;
        default:
          break; // Perintah non-motor diabaikan di sini
      }
    } else {
      vTaskDelay(pdMS_TO_TICKS(2));
    }
  }
}
