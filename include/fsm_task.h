#pragma once

void fsmTask(void* pv);
const char* getFsmStateName();
void triggerCombatStart();
void triggerCombatStop();
void triggerEmergencyStop();
void startManualCountdown();

