#include "shared_state.h"

SharedState g_state = {
    .edgeMask = 0,
    .edgeAny = false,
    .tofDist = {0, 0, 0, 9999, 9999, 9999},
    .tofSeq = 0,
    .gyroZ = 0.0f,
    .heading = 0.0f,
    .pitch = 0.0f,
    .roll = 0.0f,
    .accelMag = 1.0f,
    .motorCurrentMa = 0,
    .logToF = false,
    .logTofMask = 0,
    .logIR = false,
    .logIMU = false
};

portMUX_TYPE g_stateMux = portMUX_INITIALIZER_UNLOCKED;
QueueHandle_t cliCommandQueue = nullptr;
SemaphoreHandle_t g_wire1Mutex = nullptr;
