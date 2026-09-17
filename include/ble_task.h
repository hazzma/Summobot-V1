#pragma once
#include <Arduino.h>

void bleTask(void* pv);
void handleIncomingJson(const char* jsonStr);
void sendTxResponse(const String& payload);
