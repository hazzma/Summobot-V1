/**
 * Summobot V1 — Tuning & Telemetry Studio JavaScript
 * Supports: Web Bluetooth (BLE Nordic UART Service) & Web Serial (USB)
 */

// UUID Nordic UART Service (NUS)
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_UUID      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write to robot
const NUS_TX_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify from robot

// State
let bleDevice = null;
let bleServer = null;
let rxCharacteristic = null;
let txCharacteristic = null;

let serialPort = null;
let serialReader = null;
let serialWriter = null;
let isSerialConnected = false;

let connectionType = 'none'; // 'ble' | 'serial' | 'none'
let rxBuffer = '';

// Operating Mode State
let currentOpMode = 'DATA'; // 'DATA' | 'COMBAT'
let currentCombatLevel = 'TEST'; // 'TEST' | 'COMPETITION'
let currentTuningMode = 'TEST'; // 'TEST' | 'COMPETITION'
let isGyroEnabled = true;

// Blackbox Flight Recorder (Flash Logger) State
let isBlackboxRecording = false;
let blackboxSampleCount = 0;
let hasFlashLogData = false;
let blackboxData = [];
let blackboxExpectedTotal = 0;
let activeLogFilter = 'all';
let isLiveStreamActive = true;

// Active Profiles Cache (Default fallbacks matching firmware)
const profiles = {
  TEST: {
    attackFull: 55, attackOuter: 50, attackInner: 45, turnInPlace: 90, searchSpin: 45,
    dodgeOuter: 60, dodgeInner: -30,
    edgeBackup: 80, edgeEvade: 70, tiltEscape: 90, rearThreat: 70, sideEvade: 60, pushbackJink: 70,
    accelRate: 18
  },
  COMPETITION: {
    attackFull: 255, attackOuter: 230, attackInner: 160, turnInPlace: 180, searchSpin: 100,
    dodgeOuter: 180, dodgeInner: -70,
    edgeBackup: 230, edgeEvade: 190, tiltEscape: 255, rearThreat: 255, sideEvade: 180, pushbackJink: 210,
    accelRate: 40
  }
};

// ============================================================================
// UI Initializer & Event Listeners
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initOpModeControls();
  initCurveCanvas();
  initTuningControls();
  initBlackboxControls();
  initConnectionButtons();
  initTerminal();
  updateCurveStats();
  drawCurve();
});

// Tab Switching
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const panel = document.getElementById(target);
      if (panel) panel.classList.add('active');

      if (target === 'tab-accel') {
        drawCurve();
      }
    });
  });
}

// ============================================================================
// Robot Operating Mode Controls (Ambil Data vs Combat)
// ============================================================================
function initOpModeControls() {
  const btnOpData = document.getElementById('btnOpData');
  const btnOpCombat = document.getElementById('btnOpCombat');
  const btnCombatTest = document.getElementById('btnCombatTest');
  const btnCombatComp = document.getElementById('btnCombatComp');
  const btnQuickStart = document.getElementById('btnQuickStart');
  const btnQuickStop = document.getElementById('btnQuickStop');

  btnOpData.addEventListener('click', () => {
    setOpMode('DATA');
  });

  btnOpCombat.addEventListener('click', () => {
    setOpMode('COMBAT');
  });

  btnCombatTest.addEventListener('click', () => {
    setCombatLevel('TEST');
  });

  btnCombatComp.addEventListener('click', () => {
    setCombatLevel('COMPETITION');
  });

  btnQuickStart.addEventListener('click', () => {
    sendData(JSON.stringify({ cmd: 'combat_start' }) + '\n');
    logTerminal('🚀 [COMBAT] Sinyal Start dikirim ke robot!', 'term-tx');
  });

  btnQuickStop.addEventListener('click', () => {
    sendData(JSON.stringify({ cmd: 'combat_stop' }) + '\n');
    logTerminal('⏸️ [COMBAT] Robot di-standby-kan.', 'term-info');
  });
}

function setOpMode(mode) {
  currentOpMode = mode;
  const isCombat = (mode === 'COMBAT');

  document.getElementById('btnOpData').classList.toggle('active', !isCombat);
  document.getElementById('btnOpCombat').classList.toggle('active', isCombat);
  
  const subBox = document.getElementById('combatSubOptions');
  if (subBox) {
    subBox.style.display = isCombat ? 'flex' : 'none';
  }

  const statOp = document.getElementById('statOpMode');
  if (statOp) {
    statOp.textContent = isCombat ? 'COMBAT (OTONOM)' : 'AMBIL DATA (STANDBY)';
    statOp.className = isCombat ? 'stat-badge stat-err' : 'stat-badge stat-green';
  }

  // Kirim perintah mode ke robot
  sendData(JSON.stringify({ cmd: 'set_op_mode', mode: mode }) + '\n');
  logTerminal(`[MODE] Robot dialihkan ke: ${isCombat ? 'Mode COMBAT' : 'Mode AMBIL DATA (Motor OFF)'}`, 'term-tx');
}

function setCombatLevel(level) {
  currentCombatLevel = level;
  const isComp = (level === 'COMPETITION');

  document.getElementById('btnCombatTest').classList.toggle('active', !isComp);
  document.getElementById('btnCombatComp').classList.toggle('active', isComp);

  const statMode = document.getElementById('statMode');
  if (statMode) {
    statMode.textContent = isComp ? 'COMPETITION (FULL)' : 'TEST (AMAN/MEJA)';
    statMode.className = isComp ? 'stat-badge stat-err' : 'stat-badge stat-green';
  }

  // Sinkronkan juga tab tuning
  setProfileMode(level, false);

  // Kirim perintah ke robot
  sendData(JSON.stringify({ cmd: 'set_spd_mode', mode: level }) + '\n');
  logTerminal(`[COMBAT LEVEL] Tingkat daya diatur ke: ${level}`, 'term-tx');
}

// ============================================================================
// Connection Handlers: Web Bluetooth & Web Serial
// ============================================================================
function initConnectionButtons() {
  const btnBle = document.getElementById('btnBleConnect');
  const btnSerial = document.getElementById('btnSerialConnect');
  const btnEStop = document.getElementById('btnEStop');
  const btnApplyStream = document.getElementById('btnApplyStream');

  btnBle.addEventListener('click', () => {
    if (connectionType === 'ble') {
      disconnectBLE();
    } else {
      connectBLE();
    }
  });

  btnSerial.addEventListener('click', () => {
    if (connectionType === 'serial') {
      disconnectSerial();
    } else {
      connectSerial();
    }
  });

  btnQuickStop.addEventListener('click', () => {
    sendData(JSON.stringify({ cmd: 'combat_stop' }) + '\n');
    logTerminal('[COMBAT] Perintah STANDBY (Motor OFF) dikirim.', 'term-err');
  });

  // Logika Gyro IMU Toggle Buttons
  const btnToggleGyro = document.getElementById('btnToggleGyro');
  if (btnToggleGyro) {
    btnToggleGyro.addEventListener('click', toggleGyroLogic);
  }
  const btnToggleGyroInline = document.getElementById('btnToggleGyroInline');
  if (btnToggleGyroInline) {
    btnToggleGyroInline.addEventListener('click', toggleGyroLogic);
  }

  btnApplyStream.addEventListener('click', () => {
    const payload = {
      cmd: 'stream',
      ir: document.getElementById('chkStreamIR').checked,
      tof: document.getElementById('chkStreamToF').checked,
      imu: document.getElementById('chkStreamIMU').checked,
      state: document.getElementById('chkStreamState').checked,
      hz: parseInt(document.getElementById('streamHz').value, 10)
    };
    sendData(JSON.stringify(payload) + '\n');
    logTerminal(`[STREAM] Konfigurasi filter logging dikirim: ${payload.hz} Hz`, 'term-tx');
  });
}

function updateConnectionUI(connected, type = 'none') {
  const pill = document.getElementById('connPill');
  const label = document.getElementById('connLabel');
  const btnBle = document.getElementById('btnBleConnect');
  const btnSerial = document.getElementById('btnSerialConnect');

  if (connected) {
    pill.classList.add('connected');
    connectionType = type;
    if (type === 'ble') {
      label.textContent = 'BLE Terhubung';
      btnBle.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Putus BLE`;
      btnBle.classList.replace('btn-primary', 'btn-secondary');
    } else {
      label.textContent = 'USB Serial (115200)';
      btnSerial.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Putus Serial`;
      btnSerial.classList.replace('btn-secondary', 'btn-primary');
    }
  } else {
    pill.classList.remove('connected');
    connectionType = 'none';
    label.textContent = 'Terputus';
    btnBle.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7l10 10-5 5V2l5 5L7 17"></path></svg> Konek BLE`;
    btnBle.className = 'btn btn-primary';
    btnSerial.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><circle cx="8" cy="12" r="2"></circle><path d="M14 12h4"></path></svg> Konek Serial (USB)`;
    btnSerial.className = 'btn btn-secondary';
  }
}

// 1. Web Bluetooth (Nordic UART Service)
async function connectBLE() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth tidak didukung pada browser ini atau URL bukan localhost/HTTPS. Silakan buka http://localhost:8080/web/index.html di Google Chrome atau Microsoft Edge!');
    return;
  }

  try {
    logTerminal('[BLE] Mencari Summobot-V1 di sekitar...', 'term-info');
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Summobot' },
        { services: [NUS_SERVICE_UUID] }
      ],
      optionalServices: [NUS_SERVICE_UUID]
    });

    bleDevice.addEventListener('gattserverdisconnected', onBLEDisconnected);
    logTerminal(`[BLE] Menghubungkan ke ${bleDevice.name}...`, 'term-info');

    bleServer = await bleDevice.gatt.connect();
    logTerminal('[BLE] Mencari Service UART...', 'term-info');
    const service = await bleServer.getPrimaryService(NUS_SERVICE_UUID);
    
    rxCharacteristic = await service.getCharacteristic(NUS_RX_UUID);
    txCharacteristic = await service.getCharacteristic(NUS_TX_UUID);

    await txCharacteristic.startNotifications();
    txCharacteristic.addEventListener('characteristicvaluechanged', handleBLENotification);

    updateConnectionUI(true, 'ble');
    logTerminal('[BLE] Berhasil terhubung & notifikasi aktif! Mengambil data...', 'term-tx');

    setTimeout(() => {
      requestProfileFromRobot();
    }, 350);
  } catch (err) {
    console.error(err);
    logTerminal(`[BLE ERROR] ${err.message}`, 'term-err');
    updateConnectionUI(false);
  }
}

function handleBLENotification(event) {
  const value = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const chunk = decoder.decode(value);
  processIncomingChunk(chunk);
}

function onBLEDisconnected() {
  logTerminal('[BLE] Koneksi Bluetooth terputus.', 'term-err');
  updateConnectionUI(false);
}

function disconnectBLE() {
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
  }
  updateConnectionUI(false);
}

// 2. Web Serial API (USB Cable)
async function connectSerial() {
  if (!navigator.serial) {
    alert('Web Serial tidak didukung pada browser ini. Harap gunakan Chrome/Edge versi terbaru.');
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    isSerialConnected = true;
    updateConnectionUI(true, 'serial');
    logTerminal('[SERIAL] Port USB Serial terhubung pada 115200 baud.', 'term-tx');

    readSerialLoop();
    setTimeout(() => {
      requestProfileFromRobot();
    }, 300);
  } catch (err) {
    console.error(err);
    logTerminal(`[SERIAL ERROR] ${err.message}`, 'term-err');
    updateConnectionUI(false);
  }
}

async function readSerialLoop() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
  serialReader = textDecoder.readable.getReader();

  try {
    while (true) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (value) processIncomingChunk(value);
    }
  } catch (err) {
    console.warn('Serial read error:', err);
  } finally {
    serialReader.releaseLock();
  }
}

async function disconnectSerial() {
  if (serialReader) {
    await serialReader.cancel();
  }
  if (serialPort) {
    await serialPort.close();
  }
  isSerialConnected = false;
  updateConnectionUI(false);
  logTerminal('[SERIAL] Port USB terputus.', 'term-err');
}

// 3. Unified Sender
async function sendData(str) {
  if (connectionType === 'ble' && rxCharacteristic) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(str);
      const CHUNK_SIZE = 20;
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const sub = data.subarray(i, i + CHUNK_SIZE);
        await rxCharacteristic.writeValueWithoutResponse(sub);
      }
    } catch (err) {
      logTerminal(`[BLE TX ERR] ${err.message}`, 'term-err');
    }
  } else if (connectionType === 'serial' && serialPort && serialPort.writable) {
    try {
      const encoder = new TextEncoderStream();
      const outputDone = encoder.readable.pipeTo(serialPort.writable);
      const writer = encoder.writable.getWriter();
      await writer.write(str);
      writer.releaseLock();
    } catch (err) {
      logTerminal(`[SERIAL TX ERR] ${err.message}`, 'term-err');
    }
  } else {
    logTerminal(`[OFFLINE] Perintah tidak terkirim (Robot belum konek): ${str.trim()}`, 'term-info');
  }
}

// ============================================================================
// Data Packet Parser (JSON Telemetry & Profiles)
// ============================================================================
function processIncomingChunk(chunk) {
  rxBuffer += chunk;
  const lines = rxBuffer.split('\n');
  rxBuffer = lines.pop();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!trimmed.includes('"t":"telem"')) {
      logTerminal(trimmed, 'term-rx');
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const packet = JSON.parse(trimmed);
        handlePacket(packet);
      } catch (e) {
        // Abaikan jika belum komplit
      }
    }
  }
}

function handlePacket(pkt) {
  if (pkt.t === 'telem') {
    // 1. Mode Operasi & Tingkat Combat dari robot
    if (pkt.op) {
      const isCombat = (pkt.op === 'COMBAT');
      document.getElementById('btnOpData').classList.toggle('active', !isCombat);
      document.getElementById('btnOpCombat').classList.toggle('active', isCombat);
      const subBox = document.getElementById('combatSubOptions');
      if (subBox) subBox.style.display = isCombat ? 'flex' : 'none';

      const statOp = document.getElementById('statOpMode');
      if (statOp) {
        statOp.textContent = isCombat ? 'COMBAT (OTONOM)' : 'AMBIL DATA (STANDBY)';
        statOp.className = isCombat ? 'stat-badge stat-err' : 'stat-badge stat-green';
      }
    }

    if (pkt.spd) {
      const isComp = (pkt.spd === 'COMPETITION');
      document.getElementById('btnCombatTest').classList.toggle('active', !isComp);
      document.getElementById('btnCombatComp').classList.toggle('active', isComp);
      const statMode = document.getElementById('statMode');
      if (statMode) {
        statMode.textContent = isComp ? 'COMPETITION (FULL)' : 'TEST (AMAN/MEJA)';
        statMode.className = isComp ? 'stat-badge stat-err' : 'stat-badge stat-green';
      }
    }

    // 2. Line IR: 1 = Garis Putih (Bahaya), 0 = Hitam Arena (Aman)
    if (pkt.ir && pkt.ir.length >= 4) {
      updateIRNode('FL', pkt.ir[0] === 1);
      updateIRNode('FR', pkt.ir[1] === 1);
      updateIRNode('BL', pkt.ir[2] === 1);
      updateIRNode('BR', pkt.ir[3] === 1);
    }

    // 3. 6x ToF Distance (mm)
    if (pkt.tof && pkt.tof.length >= 6) {
      updateToFMeter('tofValFL', 'tofBarFL', pkt.tof[0]);
      updateToFMeter('tofValFC', 'tofBarFC', pkt.tof[1]);
      updateToFMeter('tofValFR', 'tofBarFR', pkt.tof[2]);
      updateToFMeter('tofValML', 'tofBarML', pkt.tof[3]);
      updateToFMeter('tofValMR', 'tofBarMR', pkt.tof[4]);
      updateToFMeter('tofValRR', 'tofBarRR', pkt.tof[5]);
    }

    // 4. IMU (Pitch, Roll, Accel)
    if (pkt.imu) {
      if (pkt.imu.p !== undefined) document.getElementById('imuPitch').textContent = `${pkt.imu.p.toFixed(1)}°`;
      if (pkt.imu.r !== undefined) document.getElementById('imuRoll').textContent = `${pkt.imu.r.toFixed(1)}°`;
      if (pkt.imu.az !== undefined) document.getElementById('imuAz').textContent = `${pkt.imu.az.toFixed(2)}g`;

      const tiltEl = document.getElementById('statTilt');
      if (Math.abs(pkt.imu.p) > 15 || Math.abs(pkt.imu.r) > 15) {
        tiltEl.textContent = 'TERANGKAT!';
        tiltEl.className = 'stat-badge stat-err';
      } else {
        tiltEl.textContent = 'NORMAL';
        tiltEl.className = 'stat-badge stat-green';
      }
    }

    // 5. Status Logika Gyro IMU
    if (pkt.gyroEn !== undefined) {
      updateGyroLogicUI(pkt.gyroEn);
    }

    // 6. FSM State & Motors
    if (pkt.fsm) {
      document.getElementById('statFsm').textContent = pkt.fsm;
    }
    if (pkt.m && pkt.m.length >= 2) {
      document.getElementById('statMotor').textContent = `${pkt.m[0]} / ${pkt.m[1]}`;
    }

    // 7. Status Blackbox Flash Logger
    if (pkt.logRec !== undefined) {
      updateBlackboxStatus(pkt.logRec, pkt.logCnt || 0, pkt.logFlash || false);
    }
  } else if (pkt.t === 'log_status') {
    updateBlackboxStatus(pkt.recording, pkt.count || 0, pkt.hasFlash || pkt.saved || false);
    if (pkt.saved) {
      logTerminal(`💾 [BLACKBOX] Rekaman berhasil disimpan ke Flash (${pkt.count} baris).`, 'term-tx');
    }
    if (pkt.cleared) {
      logTerminal('🗑️ [BLACKBOX] File log /blackbox.csv di Flash telah dihapus.', 'term-info');
      blackboxData = [];
      renderBlackboxTable();
      updateBlackboxMetrics();
    }
  } else if (pkt.t === 'log_start') {
    blackboxData = [];
    blackboxExpectedTotal = pkt.total || 0;
    logTerminal(`📥 [BLACKBOX] Mulai mengunduh ${pkt.total} data log dari Flash...`, 'term-info');
    updateFetchProgress(0, pkt.total);
  } else if (pkt.t === 'log_data') {
    if (Array.isArray(pkt.rows)) {
      for (const r of pkt.rows) {
        blackboxData.push({
          tMs: r[0],
          stateId: r[1],
          pwmL: r[2],
          pwmR: r[3],
          edgeMask: r[4],
          tof: [r[5], r[6], r[7], r[8], r[9], r[10]],
          pitch: (r[11] || 0) / 10.0,
          roll: (r[12] || 0) / 10.0,
          accel: (r[13] || 0) / 100.0
        });
      }
      updateFetchProgress(blackboxData.length, blackboxExpectedTotal);
    }
  } else if (pkt.t === 'log_end') {
    logTerminal(`✅ [BLACKBOX] Pengunduhan data log selesai! Total: ${blackboxData.length} baris.`, 'term-tx');
    finishLogFetch();
  } else if (pkt.t === 'profile') {
    if (pkt.gyroEn !== undefined) {
      updateGyroLogicUI(pkt.gyroEn);
    }
    if (pkt.mode) {
      const modeKey = pkt.mode;
      profiles[modeKey] = { ...profiles[modeKey], ...pkt };
      if (modeKey === currentTuningMode) {
        loadProfileIntoInputs(profiles[modeKey]);
        updateCurveStats();
        drawCurve();
      }
      logTerminal(`[NVM] Profil ${modeKey} berhasil disinkronkan dari robot.`, 'term-tx');
    }
    if (pkt.opMode) {
      const isCombat = (pkt.opMode === 'COMBAT');
      document.getElementById('btnOpData').classList.toggle('active', !isCombat);
      document.getElementById('btnOpCombat').classList.toggle('active', isCombat);
      const subBox = document.getElementById('combatSubOptions');
      if (subBox) subBox.style.display = isCombat ? 'flex' : 'none';
    }
    if (pkt.activeSpdMode) {
      const isComp = (pkt.activeSpdMode === 'COMPETITION');
      document.getElementById('btnCombatTest').classList.toggle('active', !isComp);
      document.getElementById('btnCombatComp').classList.toggle('active', isComp);
    }
  }
}

// ============================================================================
// Gyro IMU Logic Controls
// ============================================================================
function updateGyroLogicUI(enabled) {
  isGyroEnabled = !!enabled;

  const btnToggleGyro = document.getElementById('btnToggleGyro');
  const badgeGyroStatus = document.getElementById('badgeGyroStatus');
  const lblGyroSwitch = document.getElementById('lblGyroSwitch');

  if (btnToggleGyro) {
    btnToggleGyro.classList.toggle('active', isGyroEnabled);
    btnToggleGyro.classList.toggle('disabled', !isGyroEnabled);
  }
  if (badgeGyroStatus) {
    badgeGyroStatus.textContent = isGyroEnabled ? 'AKTIF' : 'NONAKTIF';
    badgeGyroStatus.className = isGyroEnabled ? 'badge-tag tag-cyan' : 'badge-tag tag-red';
  }
  if (lblGyroSwitch) {
    lblGyroSwitch.textContent = isGyroEnabled ? 'LOGIKA GYRO: AKTIF' : 'LOGIKA GYRO: NONAKTIF (DIABAIKAN)';
  }

  const btnToggleGyroInline = document.getElementById('btnToggleGyroInline');
  const lblGyroInline = document.getElementById('lblGyroInline');
  const imuLogicNote = document.getElementById('imuLogicNote');

  if (btnToggleGyroInline) {
    btnToggleGyroInline.classList.toggle('active', isGyroEnabled);
    btnToggleGyroInline.classList.toggle('disabled', !isGyroEnabled);
  }
  if (lblGyroInline) {
    lblGyroInline.textContent = isGyroEnabled ? 'Logika Gyro: AKTIF' : 'Logika Gyro: NONAKTIF';
  }
  if (imuLogicNote) {
    if (isGyroEnabled) {
      imuLogicNote.className = 'imu-logic-note';
      imuLogicNote.innerHTML = '🛡️ <strong>Logika Gyro Aktif:</strong> Proteksi kemiringan (tilt escape &ge; 15&deg;), pushback, dan dodge aktif.';
    } else {
      imuLogicNote.className = 'imu-logic-note disabled';
      imuLogicNote.innerHTML = '⚠️ <strong>Logika Gyro Nonaktif:</strong> Proteksi tilt, pushback, dan gyro dodge diabaikan (robot murni mengandalkan 6x ToF & 4x IR).';
    }
  }
}

function toggleGyroLogic() {
  const nextState = !isGyroEnabled;
  updateGyroLogicUI(nextState);
  sendData(JSON.stringify({ cmd: 'set_gyro', enabled: nextState }) + '\n');
  logTerminal(`[GYRO] Logika Gyro IMU diubah ke: ${nextState ? 'AKTIF' : 'NONAKTIF (DIABAIKAN)'}`, nextState ? 'term-tx' : 'term-warn');
}

// UI Updaters
function updateIRNode(pos, isWhiteLine) {
  const bulb = document.getElementById(`bulb-${pos}`);
  const tag = document.getElementById(`tag-${pos}`);
  if (!bulb || !tag) return;

  if (isWhiteLine) {
    bulb.classList.add('detected');
    tag.classList.add('white-line');
    tag.textContent = 'PUTIH (GARIS!)';
  } else {
    bulb.classList.remove('detected');
    tag.classList.remove('white-line');
    tag.textContent = 'HITAM (AMAN)';
  }
}

function updateToFMeter(valId, barId, mm) {
  const valEl = document.getElementById(valId);
  const barEl = document.getElementById(barId);
  if (!valEl || !barEl) return;

  if (mm <= 0 || mm >= 800) {
    valEl.textContent = '>400 mm';
    barEl.style.width = '0%';
  } else {
    valEl.textContent = `${mm} mm`;
    const pct = Math.max(0, Math.min(100, ((400 - Math.min(400, mm)) / 400) * 100));
    barEl.style.width = `${pct}%`;
  }
}

// ============================================================================
// Anti-Jengat / Accel Curve Tuner & Canvas Graph
// ============================================================================
let curveCanvas, curveCtx;
let animReq = null;

function initCurveCanvas() {
  curveCanvas = document.getElementById('curveCanvas');
  curveCtx = curveCanvas.getContext('2d');

  const slider = document.getElementById('sliderAccelRate');
  slider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    profiles[currentTuningMode].accelRate = val;
    updateCurveStats();
    drawCurve();
  });

  document.querySelectorAll('.btn-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.getAttribute('data-accel'), 10);
      slider.value = val;
      profiles[currentTuningMode].accelRate = val;
      updateCurveStats();
      drawCurve();
    });
  });

  document.getElementById('btnSaveAccelNVM').addEventListener('click', () => {
    const rate = profiles[currentTuningMode].accelRate;
    const payload = {
      cmd: 'save_profile',
      mode: currentTuningMode,
      ...profiles[currentTuningMode]
    };
    sendData(JSON.stringify(payload) + '\n');
    logTerminal(`[NVM] accelRate (${rate}) disimpan ke NVM mode ${currentTuningMode}.`, 'term-tx');
  });

  document.getElementById('btnSimulateLaunch').addEventListener('click', () => {
    startLaunchSimulation();
  });
}

function updateCurveStats() {
  const rate = profiles[currentTuningMode].accelRate || 18;
  document.getElementById('valAccelRate').textContent = `${rate} PWM / 5ms`;

  const ms = Math.round((255 / Math.max(1, rate)) * 5);
  document.getElementById('calcRampTime').textContent = `~${ms} ms`;

  const charEl = document.getElementById('calcCharacter');
  if (rate <= 12) {
    charEl.textContent = 'Ultra-Smooth (Torsi sangat halus, no wheelie sama sekali)';
  } else if (rate <= 25) {
    charEl.textContent = 'Anti-Jengat Optimal (Roda depan menempel erat, responsif)';
  } else if (rate <= 45) {
    charEl.textContent = 'Agresif Lomba (Punchy launch, kontrol blade stabil)';
  } else {
    charEl.textContent = 'Sangat Keras / Rentan Jengat (Mirip lompatan instan)';
  }
}

function drawCurve() {
  if (!curveCtx) return;
  const w = curveCanvas.width;
  const h = curveCanvas.height;

  curveCtx.fillStyle = '#060a12';
  curveCtx.fillRect(0, 0, w, h);

  curveCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  curveCtx.lineWidth = 1;
  for (let y = 40; y < h - 40; y += 40) {
    curveCtx.beginPath();
    curveCtx.moveTo(50, y);
    curveCtx.lineTo(w - 30, y);
    curveCtx.stroke();
  }
  for (let x = 50; x < w - 30; x += 60) {
    curveCtx.beginPath();
    curveCtx.moveTo(x, 40);
    curveCtx.lineTo(x, h - 40);
    curveCtx.stroke();
  }

  curveCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  curveCtx.lineWidth = 2;
  curveCtx.beginPath();
  curveCtx.moveTo(50, 30);
  curveCtx.lineTo(50, h - 40);
  curveCtx.lineTo(w - 20, h - 40);
  curveCtx.stroke();

  curveCtx.fillStyle = '#64748b';
  curveCtx.font = '11px "JetBrains Mono", monospace';
  curveCtx.fillText('PWM 255', 2, 45);
  curveCtx.fillText('PWM 128', 2, (h - 40 + 40) / 2 + 4);
  curveCtx.fillText('PWM 0', 10, h - 38);
  curveCtx.fillText('Waktu (0 ms ➔ 200 ms)', w / 2 - 50, h - 15);

  const rate = profiles[currentTuningMode].accelRate || 18;
  const rampTimeMs = (255 / Math.max(1, rate)) * 5;
  const maxTimeMs = 200;

  const plotW = w - 80;

  // 1. Red Dashed Instant Launch
  curveCtx.strokeStyle = '#ef4444';
  curveCtx.lineWidth = 2;
  curveCtx.setLineDash([5, 5]);
  curveCtx.beginPath();
  curveCtx.moveTo(50, h - 40);
  curveCtx.lineTo(54, 40);
  curveCtx.lineTo(w - 30, 40);
  curveCtx.stroke();
  curveCtx.setLineDash([]);

  // 2. Cyan Slew-Rate Ramped Curve
  curveCtx.strokeStyle = '#06b6d4';
  curveCtx.lineWidth = 3;
  curveCtx.beginPath();
  curveCtx.moveTo(50, h - 40);

  const rampEndX = 50 + Math.min(plotW, (rampTimeMs / maxTimeMs) * plotW);
  curveCtx.lineTo(rampEndX, 40);
  curveCtx.lineTo(w - 30, 40);
  curveCtx.stroke();

  curveCtx.fillStyle = 'rgba(6, 182, 212, 0.08)';
  curveCtx.beginPath();
  curveCtx.moveTo(50, h - 40);
  curveCtx.lineTo(rampEndX, 40);
  curveCtx.lineTo(w - 30, 40);
  curveCtx.lineTo(w - 30, h - 40);
  curveCtx.closePath();
  curveCtx.fill();

  curveCtx.fillStyle = '#06b6d4';
  curveCtx.beginPath();
  curveCtx.arc(rampEndX, 40, 5, 0, Math.PI * 2);
  curveCtx.fill();

  curveCtx.fillStyle = '#f8fafc';
  curveCtx.fillText(`${Math.round(rampTimeMs)} ms (Full Speed)`, rampEndX - 40, 26);
}

function startLaunchSimulation() {
  if (animReq) cancelAnimationFrame(animReq);
  const start = performance.now();
  const rate = profiles[currentTuningMode].accelRate || 18;
  const rampTimeMs = (255 / Math.max(1, rate)) * 5;

  function frame(now) {
    const elapsed = now - start;
    drawCurve();

    const w = curveCanvas.width;
    const h = curveCanvas.height;
    const plotW = w - 80;
    const maxTimeMs = 200;

    const curX = 50 + Math.min(plotW, (elapsed / maxTimeMs) * plotW);
    let curY = h - 40;

    if (elapsed < rampTimeMs) {
      const progress = elapsed / rampTimeMs;
      curY = (h - 40) - progress * (h - 80);
    } else {
      curY = 40;
    }

    curveCtx.fillStyle = '#ffffff';
    curveCtx.shadowColor = '#06b6d4';
    curveCtx.shadowBlur = 12;
    curveCtx.beginPath();
    curveCtx.arc(curX, curY, 7, 0, Math.PI * 2);
    curveCtx.fill();
    curveCtx.shadowBlur = 0;

    if (elapsed < 2000) {
      animReq = requestAnimationFrame(frame);
    }
  }
  animReq = requestAnimationFrame(frame);
}

// ============================================================================
// Parameter Tuning Tab Controls (TEST vs COMPETITION)
// ============================================================================
const paramKeys = [
  'attackFull', 'attackOuter', 'attackInner', 'turnInPlace', 'searchSpin',
  'edgeBackup', 'edgeEvade', 'dodgeOuter', 'tiltEscape', 'rearThreat'
];

function initTuningControls() {
  const btnTest = document.getElementById('btnModeTest');
  const btnComp = document.getElementById('btnModeComp');

  btnTest.addEventListener('click', () => {
    setProfileMode('TEST');
  });

  btnComp.addEventListener('click', () => {
    setProfileMode('COMPETITION');
  });

  paramKeys.forEach(key => {
    const capKey = key.charAt(0).toUpperCase() + key.slice(1);
    const numInput = document.getElementById(`tune${capKey}`);
    const rngInput = document.getElementById(`rng${capKey}`);

    if (numInput && rngInput) {
      numInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10) || 0;
        rngInput.value = val;
        profiles[currentTuningMode][key] = val;
      });

      rngInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10) || 0;
        numInput.value = val;
        profiles[currentTuningMode][key] = val;
      });
    }
  });

  document.getElementById('btnSaveAllNVM').addEventListener('click', () => {
    const payload = {
      cmd: 'save_profile',
      mode: currentTuningMode,
      ...profiles[currentTuningMode]
    };
    sendData(JSON.stringify(payload) + '\n');
    logTerminal(`[NVM] Seluruh parameter mode ${currentTuningMode} dikirim untuk disimpan ke NVM!`, 'term-tx');
  });

  document.getElementById('btnLoadNVM').addEventListener('click', () => {
    requestProfileFromRobot();
  });
}

function setProfileMode(mode, notifyRobot = true) {
  currentTuningMode = mode;
  document.getElementById('btnModeTest').classList.toggle('active', mode === 'TEST');
  document.getElementById('btnModeComp').classList.toggle('active', mode === 'COMPETITION');

  loadProfileIntoInputs(profiles[mode]);
  updateCurveStats();
  drawCurve();

  if (notifyRobot) {
    sendData(JSON.stringify({ cmd: 'set_spd_mode', mode: mode }) + '\n');
    logTerminal(`[MODE] Berpindah ke Profil ${mode}`, 'term-info');
  }
}

function loadProfileIntoInputs(prof) {
  if (!prof) return;
  paramKeys.forEach(key => {
    const capKey = key.charAt(0).toUpperCase() + key.slice(1);
    const numInput = document.getElementById(`tune${capKey}`);
    const rngInput = document.getElementById(`rng${capKey}`);
    if (numInput && rngInput && prof[key] !== undefined) {
      numInput.value = prof[key];
      rngInput.value = prof[key];
    }
  });

  const sliderAccel = document.getElementById('sliderAccelRate');
  if (sliderAccel && prof.accelRate !== undefined) {
    sliderAccel.value = prof.accelRate;
  }
}

function requestProfileFromRobot() {
  sendData(JSON.stringify({ cmd: 'get_profile', mode: currentTuningMode }) + '\n');
  logTerminal(`[REQUEST] Meminta data profil ${currentTuningMode} dari NVM robot...`, 'term-info');
}

// ============================================================================
// Terminal Console & Logging
// ============================================================================
function initTerminal() {
  const terminal = document.getElementById('terminalOutput');
  const input = document.getElementById('termCmdInput');
  const btnSend = document.getElementById('btnSendCmd');
  const btnClear = document.getElementById('btnClearLog');

  btnSend.addEventListener('click', () => {
    sendTerminalCmd();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendTerminalCmd();
  });

  btnClear.addEventListener('click', () => {
    terminal.innerHTML = '<div class="term-line term-info">[SYSTEM] Terminal dibersihkan.</div>';
  });
}

function sendTerminalCmd() {
  const input = document.getElementById('termCmdInput');
  const txt = input.value.trim();
  if (!txt) return;

  sendData(txt + '\n');
  logTerminal(`> ${txt}`, 'term-tx');
  input.value = '';
}

function logTerminal(msg, cssClass = 'term-rx') {
  const term = document.getElementById('terminalOutput');
  if (!term) return;

  const line = document.createElement('div');
  line.className = `term-line ${cssClass}`;
  const now = new Date().toTimeString().split(' ')[0];
  line.textContent = `[${now}] ${msg}`;
  term.appendChild(line);

  term.scrollTop = term.scrollHeight;

  if (term.childNodes.length > 200) {
    term.removeChild(term.firstChild);
  }
}

// ============================================================================
// Blackbox Flight Recorder (Flash Data Logger) Functions
// ============================================================================
const LOG_STATE_NAMES = [
  'WAIT_START',
  'DODGE',
  'SEARCH',
  'TRACK',
  'ATTACK',
  'EDGE_EVADE',
  'PUSHBACK',
  'TILT_ESCAPE',
  'DATA_STANDBY'
];

function initBlackboxControls() {
  // Main Panel Buttons
  const btnStart = document.getElementById('btnLogStart');
  const btnStop = document.getElementById('btnLogStop');
  const btnFetch = document.getElementById('btnLogFetch');
  const btnExport = document.getElementById('btnLogExportCsv');
  const btnClear = document.getElementById('btnLogClear');

  // Quick Banner Buttons
  const btnQuickStart = document.getElementById('btnQuickLogStart');
  const btnQuickStop = document.getElementById('btnQuickLogStop');
  const btnQuickFetch = document.getElementById('btnQuickLogFetch');

  // Live Stream Toggle Checkbox
  const chkLive = document.getElementById('chkLiveStream');

  // Start Logging
  const onStart = () => {
    sendData(JSON.stringify({ cmd: 'log_start' }) + '\n');
    logTerminal('🔴 [BLACKBOX] Perintah Mulai Rekam dikirim!', 'term-tx');
  };
  if (btnStart) btnStart.addEventListener('click', onStart);
  if (btnQuickStart) btnQuickStart.addEventListener('click', onStart);

  // Stop Logging
  const onStop = () => {
    sendData(JSON.stringify({ cmd: 'log_stop' }) + '\n');
    logTerminal('⏹️ [BLACKBOX] Perintah Berhenti Rekam & Simpan dikirim!', 'term-tx');
  };
  if (btnStop) btnStop.addEventListener('click', onStop);
  if (btnQuickStop) btnQuickStop.addEventListener('click', onStop);

  // Fetch Log Data
  const onFetch = () => {
    sendData(JSON.stringify({ cmd: 'log_fetch' }) + '\n');
    logTerminal('📥 [BLACKBOX] Meminta pengiriman data log dari Flash ESP32...', 'term-tx');
    // Buka otomatis tab blackbox agar pengguna langsung melihat tabel
    const bbTabBtn = document.querySelector('.nav-tab[data-tab="tab-blackbox"]');
    if (bbTabBtn) bbTabBtn.click();
  };
  if (btnFetch) btnFetch.addEventListener('click', onFetch);
  if (btnQuickFetch) btnQuickFetch.addEventListener('click', onFetch);

  // Export CSV
  if (btnExport) {
    btnExport.addEventListener('click', exportBlackboxCsv);
  }

  // Clear Flash Log
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (confirm('Yakin ingin menghapus seluruh rekaman log di Flash ESP32?')) {
        sendData(JSON.stringify({ cmd: 'log_clear' }) + '\n');
        logTerminal('🗑️ [BLACKBOX] Perintah Hapus Log Flash dikirim!', 'term-tx');
      }
    });
  }

  // Live Telemetry Toggle
  if (chkLive) {
    chkLive.addEventListener('change', (e) => {
      isLiveStreamActive = e.target.checked;
      sendData(JSON.stringify({ cmd: 'stream', live: isLiveStreamActive }) + '\n');
      logTerminal(`📡 [TELEMETRI] Live Streaming diubah ke: ${isLiveStreamActive ? 'AKTIF' : 'NONAKTIF (HEMAT BLE)'}`, 'term-info');
    });
  }

  // Filter Buttons
  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeLogFilter = pill.getAttribute('data-filter') || 'all';
      renderBlackboxTable();
    });
  });

  // Scrubber Slider
  const slider = document.getElementById('bbScrubberSlider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10) || 0;
      scrubToRow(idx);
    });
  }
}

function updateBlackboxStatus(isRecording, count, hasFlash) {
  isBlackboxRecording = !!isRecording;
  blackboxSampleCount = count || 0;
  hasFlashLogData = !!hasFlash;

  // Update Main Badge
  const mainBadge = document.getElementById('blackboxMainBadge');
  const mainBadgeText = document.getElementById('blackboxMainBadgeText');
  if (mainBadge && mainBadgeText) {
    if (isBlackboxRecording) {
      mainBadge.className = 'blackbox-badge recording';
      mainBadgeText.textContent = `MEREKAM KE FLASH (${blackboxSampleCount} pts)`;
    } else if (hasFlashLogData) {
      mainBadge.className = 'blackbox-badge has-flash';
      mainBadgeText.textContent = `DATA FLASH TERSEDIA (${blackboxSampleCount} pts)`;
    } else {
      mainBadge.className = 'blackbox-badge';
      mainBadgeText.textContent = 'STANDBY';
    }
  }

  // Update Quick Badge
  const qBadge = document.getElementById('quickRecBadge');
  const qText = document.getElementById('quickRecText');
  if (qBadge && qText) {
    if (isBlackboxRecording) {
      qBadge.className = 'rec-badge recording';
      qText.textContent = `REKAM FLASH (${blackboxSampleCount})`;
    } else if (hasFlashLogData) {
      qBadge.className = 'rec-badge has-flash';
      qText.textContent = `FLASH LOG (${blackboxSampleCount})`;
    } else {
      qBadge.className = 'rec-badge';
      qText.textContent = 'BLACKBOX: STANDBY';
    }
  }

  // Update Sidebar Stat
  const statBb = document.getElementById('statBlackbox');
  if (statBb) {
    if (isBlackboxRecording) {
      statBb.textContent = `REKAM (${blackboxSampleCount})`;
      statBb.className = 'stat-badge stat-err';
    } else if (hasFlashLogData) {
      statBb.textContent = `FLASH (${blackboxSampleCount})`;
      statBb.className = 'stat-badge stat-cyan';
    } else {
      statBb.textContent = 'STANDBY';
      statBb.className = 'stat-badge stat-green';
    }
  }

  // Update Button States
  const btnStart = document.getElementById('btnLogStart');
  const btnStop = document.getElementById('btnLogStop');
  const btnQuickStart = document.getElementById('btnQuickLogStart');
  const btnQuickStop = document.getElementById('btnQuickLogStop');

  if (btnStart) btnStart.disabled = isBlackboxRecording;
  if (btnQuickStart) btnQuickStart.disabled = isBlackboxRecording;
  if (btnStop) btnStop.disabled = !isBlackboxRecording;
  if (btnQuickStop) btnQuickStop.disabled = !isBlackboxRecording;
}

function updateFetchProgress(current, total) {
  const tbody = document.getElementById('tbodyBlackbox');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="bb-table-empty">
          <div style="font-weight:700; color:var(--accent-cyan); margin-bottom:6px;">
            📥 Sedang Mengunduh Data dari Flash ESP32: ${current} / ${total || '?'} baris...
          </div>
          <div style="font-size:0.75rem; color:var(--text-secondary);">
            Mohon tunggu sebentar, data sedang ditransfer via BLE/Serial.
          </div>
        </td>
      </tr>
    `;
  }
}

function finishLogFetch() {
  updateBlackboxMetrics();
  renderBlackboxTable();

  // Setup Scrubber Slider
  const slider = document.getElementById('bbScrubberSlider');
  if (slider) {
    if (blackboxData.length > 0) {
      slider.disabled = false;
      slider.min = 0;
      slider.max = blackboxData.length - 1;
      slider.value = 0;
      scrubToRow(0);
    } else {
      slider.disabled = true;
    }
  }

  // Enable Export CSV Button
  const btnExport = document.getElementById('btnLogExportCsv');
  if (btnExport) {
    btnExport.disabled = (blackboxData.length === 0);
  }
}

function updateBlackboxMetrics() {
  const countEl = document.getElementById('bbMetricCount');
  const durEl = document.getElementById('bbMetricDuration');
  const speedEl = document.getElementById('bbMetricMaxPwm');
  const enemyEl = document.getElementById('bbMetricEnemyCount');
  const edgeEl = document.getElementById('bbMetricEdgeCount');

  const total = blackboxData.length;
  if (countEl) countEl.textContent = `${total} baris`;

  if (total === 0) {
    if (durEl) durEl.textContent = '0.00 s';
    if (speedEl) speedEl.textContent = '0% / 0%';
    if (enemyEl) enemyEl.textContent = '0 kali';
    if (edgeEl) edgeEl.textContent = '0 kali';
    return;
  }

  const durationSec = (blackboxData[total - 1].tMs / 1000.0).toFixed(2);
  if (durEl) durEl.textContent = `${durationSec} s`;

  let maxL = 0;
  let maxR = 0;
  let enemyHits = 0;
  let edgeHits = 0;

  for (const d of blackboxData) {
    maxL = Math.max(maxL, Math.abs(d.pwmL));
    maxR = Math.max(maxR, Math.abs(d.pwmR));
    if (d.edgeMask > 0) edgeHits++;

    let hasEnemy = false;
    for (let k = 0; k < 6; k++) {
      if (d.tof[k] >= 1 && d.tof[k] <= 400) {
        hasEnemy = true;
        break;
      }
    }
    if (hasEnemy) enemyHits++;
  }

  if (speedEl) speedEl.textContent = `${maxL}% / ${maxR}%`;
  if (enemyEl) enemyEl.textContent = `${enemyHits} baris`;
  if (edgeEl) edgeEl.textContent = `${edgeHits} baris`;
}

function getMotorActionText(pwmL, pwmR) {
  if (pwmL === 0 && pwmR === 0) return 'Diam (Stop)';
  if (pwmL > 0 && pwmR > 0) {
    if (Math.abs(pwmL - pwmR) <= 10) return `Maju Lurus (${pwmL}%)`;
    if (pwmL > pwmR) return `Serong Kanan Halus`;
    return `Serong Kiri Halus`;
  }
  if (pwmL < 0 && pwmR < 0) {
    return `Mundur Reflex (${pwmL}%)`;
  }
  if (pwmL > 0 && pwmR <= 0) return `Pivot Kanan`;
  if (pwmL <= 0 && pwmR > 0) return `Pivot Kiri`;
  return `Manuver`;
}

function renderIrBadges(edgeMask) {
  const fl = (edgeMask & (1 << 0)) ? 'hit' : 'safe';
  const fr = (edgeMask & (1 << 1)) ? 'hit' : 'safe';
  const bl = (edgeMask & (1 << 2)) ? 'hit' : 'safe';
  const br = (edgeMask & (1 << 3)) ? 'hit' : 'safe';
  return `
    <div class="ir-matrix-cell">
      <span class="ir-micro-pill ${fl}">FL:${fl === 'hit' ? 'PUTIH' : 'OK'}</span>
      <span class="ir-micro-pill ${fr}">FR:${fr === 'hit' ? 'PUTIH' : 'OK'}</span>
      <span class="ir-micro-pill ${bl}">BL:${bl === 'hit' ? 'PUTIH' : 'OK'}</span>
      <span class="ir-micro-pill ${br}">BR:${br === 'hit' ? 'PUTIH' : 'OK'}</span>
    </div>
  `;
}

function renderTofChips(tofArr) {
  const names = ['FL', 'FC', 'FR', 'ML', 'MR', 'RR'];
  let html = '<div class="tof-matrix-cell">';
  for (let i = 0; i < 6; i++) {
    const d = tofArr[i];
    const isEnemy = (d >= 1 && d <= 400);
    const cls = isEnemy ? 'tof-micro-chip enemy-hit' : 'tof-micro-chip';
    const distText = (d >= 2000 || d === 0) ? '--' : `${d}mm`;
    html += `<span class="${cls}">${isEnemy ? '🎯 ' : ''}${names[i]}:${distText}</span>`;
  }
  html += '</div>';
  return html;
}

function renderBlackboxTable() {
  const tbody = document.getElementById('tbodyBlackbox');
  if (!tbody) return;

  if (blackboxData.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="bb-table-empty">
          Belum ada data log yang dimuat. Klik tombol <strong>"📥 Tarik Data Log"</strong> untuk mengambil data dari Flash ESP32.
        </td>
      </tr>
    `;
    return;
  }

  // Filter rows
  const filtered = blackboxData.filter((row, idx) => {
    row._origIdx = idx;
    if (activeLogFilter === 'enemy') {
      return row.tof.some(d => d >= 1 && d <= 400);
    }
    if (activeLogFilter === 'edge') {
      return row.edgeMask > 0;
    }
    if (activeLogFilter === 'motor') {
      return row.pwmL !== 0 || row.pwmR !== 0;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="bb-table-empty">
          Tidak ada baris data yang cocok dengan filter <strong>"${activeLogFilter}"</strong>.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  filtered.forEach(row => {
    const timeSec = (row.tMs / 1000.0).toFixed(2);
    const stateName = LOG_STATE_NAMES[row.stateId] || 'UNKNOWN';
    const actionText = getMotorActionText(row.pwmL, row.pwmR);

    // Motor bar widths
    const barW_L = Math.min(50, Math.round(Math.abs(row.pwmL) / 2));
    const barW_R = Math.min(50, Math.round(Math.abs(row.pwmR) / 2));
    const barClass_L = row.pwmL >= 0 ? 'pos' : 'neg';
    const barClass_R = row.pwmR >= 0 ? 'pos' : 'neg';

    // Tilt check
    const isTilted = (Math.abs(row.pitch) > 15 || Math.abs(row.roll) > 15);

    html += `
      <tr id="bbRow-${row._origIdx}" onclick="scrubToRow(${row._origIdx})">
        <td>
          <span class="time-tag">+${timeSec}s</span>
          <span style="display:block; font-size:0.65rem; color:var(--text-muted);">${row.tMs}ms</span>
        </td>
        <td>
          <span class="fsm-tag fsm-${stateName}">${stateName}</span>
        </td>
        <td>
          <div class="motor-cell-wrap">
            <span class="motor-label-val">L: ${row.pwmL > 0 ? '+' : ''}${row.pwmL}%</span>
            <div class="motor-bar-bg"><div class="motor-bar-fill ${barClass_L}" style="width:${barW_L}px;"></div></div>
            <span class="motor-label-val" style="margin-left:8px;">R: ${row.pwmR > 0 ? '+' : ''}${row.pwmR}%</span>
            <div class="motor-bar-bg"><div class="motor-bar-fill ${barClass_R}" style="width:${barW_R}px;"></div></div>
            <span class="motor-action-badge">${actionText}</span>
          </div>
        </td>
        <td>
          ${renderIrBadges(row.edgeMask)}
        </td>
        <td>
          ${renderTofChips(row.tof)}
        </td>
        <td>
          <div class="imu-cell ${isTilted ? 'tilted' : ''}">
            <div>P:${row.pitch.toFixed(1)}° | R:${row.roll.toFixed(1)}°</div>
            <div style="font-size:0.68rem; color:var(--text-muted);">${row.accel.toFixed(2)}g ${isTilted ? '⚠️ TERANGKAT' : ''}</div>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function scrubToRow(idx) {
  if (idx < 0 || idx >= blackboxData.length) return;
  const row = blackboxData[idx];

  // Update Scrubber Text
  const timeDisp = document.getElementById('scrubberCurrentTime');
  const sumDisp = document.getElementById('scrubberStateSummary');
  const slider = document.getElementById('bbScrubberSlider');

  if (timeDisp) timeDisp.textContent = `+${(row.tMs / 1000.0).toFixed(2)}s (${row.tMs} ms)`;
  if (sumDisp) {
    const sName = LOG_STATE_NAMES[row.stateId] || 'UNKNOWN';
    const act = getMotorActionText(row.pwmL, row.pwmR);
    sumDisp.innerHTML = `State: <strong>${sName}</strong> | Motor: <strong>${act}</strong>`;
  }
  if (slider) slider.value = idx;

  // Highlight row in table and scroll to view
  document.querySelectorAll('.bb-data-table tr').forEach(tr => tr.classList.remove('highlight-scrub'));
  const targetRow = document.getElementById(`bbRow-${idx}`);
  if (targetRow) {
    targetRow.classList.add('highlight-scrub');
    targetRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function exportBlackboxCsv() {
  if (blackboxData.length === 0) {
    alert('Tidak ada data log untuk diekspor!');
    return;
  }

  let csv = 'ms,detik,state,pwmL,pwmR,aksi_motor,edge_mask,edge_FL,edge_FR,edge_BL,edge_BR,tof_FL_mm,tof_FC_mm,tof_FR_mm,tof_ML_mm,tof_MR_mm,tof_RR_mm,pitch_deg,roll_deg,accel_g\n';

  blackboxData.forEach(row => {
    const sec = (row.tMs / 1000.0).toFixed(2);
    const sName = LOG_STATE_NAMES[row.stateId] || 'UNKNOWN';
    const act = getMotorActionText(row.pwmL, row.pwmR).replace(/,/g, ' ');
    const fl = (row.edgeMask & 1) ? 1 : 0;
    const fr = (row.edgeMask & 2) ? 1 : 0;
    const bl = (row.edgeMask & 4) ? 1 : 0;
    const br = (row.edgeMask & 8) ? 1 : 0;

    csv += `${row.tMs},${sec},${sName},${row.pwmL},${row.pwmR},"${act}",${row.edgeMask},${fl},${fr},${bl},${br},${row.tof[0]},${row.tof[1]},${row.tof[2]},${row.tof[3]},${row.tof[4]},${row.tof[5]},${row.pitch.toFixed(1)},${row.roll.toFixed(1)},${row.accel.toFixed(2)}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `sumobot_blackbox_${nowStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logTerminal(`💾 [CSV] File data log ${a.download} berhasil di-download!`, 'term-tx');
}
