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

  btnEStop.addEventListener('click', () => {
    sendData(JSON.stringify({ cmd: 'estop' }) + '\n');
    logTerminal('[E-STOP] Perintah Darurat Motor Dimatikan!', 'term-err');
  });

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

    // 5. FSM State & Motors
    if (pkt.fsm) {
      document.getElementById('statFsm').textContent = pkt.fsm;
    }
    if (pkt.m && pkt.m.length >= 2) {
      document.getElementById('statMotor').textContent = `${pkt.m[0]} / ${pkt.m[1]}`;
    }
  } else if (pkt.t === 'profile') {
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
