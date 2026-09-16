#pragma once

#include <cstdint>

// ============================================================================
// KONFIGURASI PROFIL KECEPATAN SUMOBOT 500g
// Rentang nilai PWM: 0 s/d 255 (255 = 100% duty cycle / daya penuh)
// File ini dapat di-edit langsung untuk men-tuning kecepatan di tiap mode.
// ============================================================================

enum class SpeedMode : uint8_t {
  TEST = 0,        // Mode Uji Coba / Aman / Meja (pelan, ~15-30%)
  COMPETITION = 1  // Mode Pertandingan Resmi (agresif, full power 70-100%)
};

struct SpeedProfile {
  const char* name;

  // --- MANUVER SERANG & KEJAR (FSM ENGAGE) ---
  int16_t attackFull;      // Maju lurus serang (C atau FL+C+FR)
  int16_t attackOuter;     // Roda luar saat serong kejar lawan
  int16_t attackInner;     // Roda dalam saat serong kejar lawan
  int16_t turnInPlace;     // Putar cepat di tempat saat lawan di samping (FL / FR / ML / MR)
  int16_t searchSpin;      // Maju lurus santai saat menjelajah arena mencari lawan (patrol)

  // --- MANUVER START DODGE (AWAL PERTANDINGAN) ---
  int16_t dodgeOuter;      // Roda luar saat manuver mengelak awal
  int16_t dodgeInner;      // Roda dalam saat manuver mengelak awal

  // --- REFLEX KEAMANAN & ADU DORONG ---
  int16_t edgeBackup;      // Mundur darurat saat garis putih terdeteksi
  int16_t edgeEvade;       // Manuver serong menjauhi sudut/tepi garis
  int16_t tiltEscape;      // Mundur darurat saat robot terangkat (sensor tilt/IMU)
  int16_t rearThreat;      // Maju sergap saat bokong diserang lawan (ToF Belakang)
  int16_t sideEvade;       // Putar balik saat sisi diserang mendadak (ToF ML/MR)
  int16_t pushbackJink;    // Manuver jink/slip out saat adu banteng didorong mundur

  // --- KURVA AKSELERASI (ANTI-JENGAT) ---
  int16_t accelRate;       // Laju ramp PWM per 5ms (0 / 255 = instan; 5-50 = halus, no wheelie)
};

// ============================================================================
// 1. PROFIL TEST (Mode Aman untuk Meja / Bench Testing)
// Semua kecepatan dibatasi agar robot tidak melompat jatuh dari meja pengujian.
// ============================================================================
constexpr SpeedProfile PROFILE_TEST = {
  .name         = "TEST (Aman / Meja)",
  // Serang & Kejar
  .attackFull   = 55,   // ~21% PWM
  .attackOuter  = 50,   // ~19% PWM
  .attackInner  = 45,   // ~18% PWM (kedua roda maju halus saat curve)
  .turnInPlace  = 90,   // ~35% PWM (respons putar di tempat)
  .searchSpin   = 45,   // ~17% PWM
  // Start Dodge
  .dodgeOuter   = 60,   // ~23% PWM
  .dodgeInner   = -30,  // ~-12% PWM
  // Reflex & Keamanan
  .edgeBackup   = 80,   // ~31% PWM
  .edgeEvade    = 70,   // ~27% PWM
  .tiltEscape   = 90,   // ~35% PWM
  .rearThreat   = 70,   // ~27% PWM
  .sideEvade    = 60,   // ~23% PWM
  .pushbackJink = 70,   // ~27% PWM
  .accelRate    = 18    // ~18 PWM per 5ms (smooth anti-jengat ramp)
};

// ============================================================================
// 2. PROFIL COMPETITION (Mode Lomba / Agresif / Pertandingan Penuh)
// Kecepatan dan torsi maksimal untuk mendorong dan menjatuhkan lawan di dohyo.
// ============================================================================
constexpr SpeedProfile PROFILE_COMPETITION = {
  .name         = "COMPETITION (Lomba / Full Power)",
  // Serang & Kejar
  .attackFull   = 255,  // 100% PWM (Full push lawan)
  .attackOuter  = 230,  // ~90% PWM
  .attackInner  = 160,  // ~63% PWM
  .turnInPlace  = 180,  // ~70% PWM (Respons putar sangat cepat)
  .searchSpin   = 100,  // ~39% PWM (Menyapu arena lebih cepat)
  // Start Dodge
  .dodgeOuter   = 180,  // ~70% PWM
  .dodgeInner   = -70,  // ~-27% PWM
  // Reflex & Keamanan
  .edgeBackup   = 230,  // ~90% PWM (Reflex garis secepat kilat)
  .edgeEvade    = 190,  // ~75% PWM
  .tiltEscape   = 255,  // 100% PWM (Lepaskan diri seketika saat diangkat)
  .rearThreat   = 255,  // 100% PWM (Kabur / tabrak balik)
  .sideEvade    = 180,  // ~70% PWM
  .pushbackJink = 210,  // ~82% PWM (Slip-out dorongan lawan)
  .accelRate    = 40    // ~40 PWM per 5ms (fast punchy ramp)
};

// API Akses Profil Kecepatan Aktif
void setSpeedMode(SpeedMode mode);
SpeedMode getSpeedMode();
const SpeedProfile& getSpeedProfile();
SpeedProfile& getSpeedProfileWritable(SpeedMode mode);
void updateSpeedProfile(SpeedMode mode, const SpeedProfile& prof);
void initSpeedProfilesFromNVM();
