'use strict';
/* ============================================================
   SUMOBOT V1 STUDIO — app.js
   Transport : Web Bluetooth NUS + Web Serial 115200 (+ Simulasi)
   Modul     : Live Telemetry, Tuning, Blackbox+Kamera, Replay Sync
   ============================================================ */

/* ---------------- 1. UTIL ---------------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function fmtMs(t){
  t = Math.max(0, t | 0);
  const m = (t / 60000) | 0, s = ((t % 60000) / 1000) | 0, ms = t % 1000;
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(ms).padStart(3,'0');
}
function fmtBytes(b){
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}
function hexA(hex, a){
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;
}
function toast(msg, type = 'info', ms = 3200){
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  $('#toasts').appendChild(d);
  requestAnimationFrame(() => d.classList.add('in'));
  setTimeout(() => { d.classList.remove('in'); setTimeout(() => d.remove(), 300); }, ms);
}

/* ---------------- 2. KONSTANTA PROTOKOL ---------------- */
const STATES = [
  { name:'WAIT',   c:'#8b98b8' }, // 0
  { name:'DODGE',  c:'#d946ef' }, // 1
  { name:'SEARCH', c:'#00f3ff' }, // 2
  { name:'TRACK',  c:'#f59e0b' }, // 3
  { name:'ATTACK', c:'#ef4444' }, // 4
  { name:'EDGE',   c:'#ff7a45' }, // 5
  { name:'PUSH',   c:'#10b981' }, // 6
  { name:'TILT',   c:'#ff3b5c' }, // 7
  { name:'TEST',   c:'#60a5fa' }  // 8
];
const TOF_CH   = ['FL','FC','FR','ML','MR','RR'];
const TOF_ANGLE = [-30, 0, 30, -90, 90, 180].map(d => d * Math.PI / 180);
const EDGE_POS = ['FL','FR','BL','BR'];
const DEFROW = { t:0, st:0, pl:0, pr:0, em:0, tof:[1150,1150,1150,1100,1100,1200], pit:0, rol:0, acc:0 };

const NUS_SVC = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // client menulis ke sini
const NUS_RX  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // client subscribe notifikasi

/* ---------------- 3. STATE GLOBAL ---------------- */
const link = { mode:null, bleDev:null, bleTx:null, serialPort:null, serialWriter:null };
let rxBuf = '';
let pktCount = 0, pktWindow = 0, lastPktAt = 0, hzLast = performance.now();
const blackboxRows = [];              // buffer baris hasil konversi (live capture + log_fetch)
let captureActive = false;            // sedang merekam -> baris masuk ke buffer
let fetching      = false;            // sedang menarik data dari flash
let loggingActive = false;
let cntDirty = false, lastCnt = 0;
let isGyroEnabled = true;

function updateGyroUI(en){
  isGyroEnabled = !!en;
  const tBtn = $('#btnTuningGyroToggle');
  const tTxt = $('#txtTuningGyro');
  if (tBtn) {
    tBtn.classList.toggle('active', isGyroEnabled);
    tBtn.classList.toggle('off', !isGyroEnabled);
  }
  if (tTxt) {
    tTxt.textContent = isGyroEnabled ? 'LOGIKA GYRO: AKTIF' : 'LOGIKA GYRO: MATI (DIABAIKAN)';
  }
  $$('.btn-gyro-toggle').forEach(btn => {
    btn.classList.toggle('on', isGyroEnabled);
    btn.classList.toggle('off', !isGyroEnabled);
    const s = btn.querySelector('span');
    if (s) s.textContent = isGyroEnabled ? 'GYRO: ON' : 'GYRO: OFF';
  });
}

function toggleGyroLogic(){
  const next = !isGyroEnabled;
  if (sendCmd({ cmd: 'set_gyro', enabled: next })){
    updateGyroUI(next);
    toast(`Logika Gyro kompetisi: ${next ? 'DIAKTIFKAN' : 'DINONAKTIFKAN (DIABAIKAN)'}`, next ? 'ok' : 'warn');
  }
}

function triggerCalibrateGyro(){
  if (sendCmd({ cmd: 'cal_gyro' })){
    toast('Memulai kalibrasi Gyro IMU... Pastikan robot diam sempurna di meja datar!', 'info', 4500);
  }
}


function convertRow(a){
  return {
    t: a[0]|0, st: a[1]|0, pl: a[2]|0, pr: a[3]|0, em: a[4]|0,
    tof: [a[5], a[6], a[7], a[8], a[9], a[10]],
    pit: (a[11]||0)/10, rol: (a[12]||0)/10, acc: (a[13]||0)/100
  };
}

/* ---------------- 4. TRANSPORT ---------------- */
function feedLine(line){
  line = line.trim(); if (!line) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  handleMsg(msg);
}
function feedChunk(text){
  rxBuf += text;
  let i;
  while ((i = rxBuf.indexOf('\n')) >= 0){ feedLine(rxBuf.slice(0, i)); rxBuf = rxBuf.slice(i + 1); }
}
function onWireText(t){ pktCount++; lastPktAt = performance.now(); feedChunk(t); }

function setLink(mode){
  link.mode = mode;
  $('#chipBle').classList.toggle('on',   mode === 'ble');
  $('#chipSer').classList.toggle('on',   mode === 'serial');
  $('#chipSim').classList.toggle('on',   mode === 'sim');
  $('#btnBle').classList.toggle('active',   mode === 'ble');
  $('#btnSerial').classList.toggle('active', mode === 'serial');
  $('#btnSim').classList.toggle('active',   mode === 'sim');
}

/* ---- Web Bluetooth (NUS) ---- */
async function bleConnect(){
  try{
    if (!navigator.bluetooth) throw new Error('Browser tidak mendukung Web Bluetooth');
    const dev = await navigator.bluetooth.requestDevice({ filters:[{ services:[NUS_SVC] }] });
    dev.addEventListener('gattserverdisconnected', () => bleCleanup());
    toast('Menghubungkan BLE…');
    const gatt = await dev.gatt.connect();
    const svc  = await gatt.getPrimaryService(NUS_SVC);
    link.bleTx = await svc.getCharacteristic(NUS_TX);
    const rx   = await svc.getCharacteristic(NUS_RX);
    await rx.startNotifications();
    rx.addEventListener('characteristicvaluechanged',
      e => onWireText(new TextDecoder().decode(e.target.value)));
    link.bleDev = dev;
    setLink('ble');
    toast('BLE terhubung: ' + (dev.name || 'NUS Device'), 'ok');
  } catch(e){ toast('BLE gagal: ' + e.message, 'err'); }
}
function bleCleanup(){
  link.bleDev = null; link.bleTx = null;
  if (link.mode === 'ble'){ setLink(null); toast('BLE terputus', 'warn'); }
}

/* ---- Web Serial 115200 ---- */
async function serialConnect(){
  try{
    if (!navigator.serial) throw new Error('Browser tidak mendukung Web Serial');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    link.serialPort = port;
    link.serialWriter = await port.writable.getWriter();
    setLink('serial');
    toast('Serial 115200 terhubung', 'ok');
    readSerialLoop(port);
  } catch(e){ toast('Serial gagal: ' + e.message, 'err'); }
}
async function readSerialLoop(port){
  const dec = new TextDecoder();
  try{
    while (port.readable && link.serialPort === port){
      const reader = port.readable.getReader();
      try{
        while (true){
          const { value, done } = await reader.read();
          if (done) break;
          if (value) onWireText(dec.decode(value, { stream:true }));
        }
      } finally { reader.releaseLock(); }
    }
  } catch(e){ console.warn(e); }
  if (link.mode === 'serial'){ setLink(null); toast('Serial terputus', 'warn'); }
}
async function serialDisconnect(){
  setLink(null);
  try { link.serialWriter && link.serialWriter.releaseLock(); } catch {}
  try { await link.serialPort.close(); } catch {}
  link.serialPort = null; link.serialWriter = null;
  toast('Serial diputus', 'info');
}

/* ---- Pengirim perintah JSON ---- */
const wireEnc = new TextEncoder();
function sendCmd(obj){
  const s = JSON.stringify(obj) + '\n';
  if (link.mode === 'ble' && link.bleTx){
    const bytes = wireEnc.encode(s);
    const p = link.bleTx.properties;
    const pr = p.writeWithoutResponse ? link.bleTx.writeValueWithoutResponse(bytes)
                                      : link.bleTx.writeValue(bytes);
    if (pr && pr.catch) pr.catch(() => {});
    return true;
  }
  if (link.mode === 'serial' && link.serialWriter){
    try { link.serialWriter.write(wireEnc.encode(s)); return true; }
    catch(e){ toast('Serial write gagal', 'err'); return false; }
  }
  if (link.mode === 'sim'){ sim.cmd(obj); return true; }
  toast('Tidak ada koneksi aktif — hubungkan robot / aktifkan Simulasi', 'warn');
  return false;
}

function getFsmStateId(name){
  if (typeof name === 'number') return name;
  if (!name) return 0;
  const s = String(name).toUpperCase();
  if (s.includes('DODGE')) return 1;
  if (s.includes('SEARCH')) return 2;
  if (s.includes('TRACK')) return 3;
  if (s.includes('ATTACK')) return 4;
  if (s.includes('EDGE')) return 5;
  if (s.includes('PUSH')) return 6;
  if (s.includes('TILT')) return 7;
  if (s.includes('DATA') || s.includes('TEST') || s.includes('STANDBY')) return 8;
  return 0;
}

/* ---------------- 5. ROUTER PESAN ---------------- */
function handleMsg(m){
  lastPktAt = performance.now();
  if (m.t === 'telem'){
    pktWindow++;
    let em = 0;
    if (Array.isArray(m.ir)){
      if (m.ir[0]) em |= (1 << 0);
      if (m.ir[1]) em |= (1 << 1);
      if (m.ir[2]) em |= (1 << 2);
      if (m.ir[3]) em |= (1 << 3);
    }
    const row = {
      t: performance.now(),
      st: getFsmStateId(m.fsm),
      pl: (m.m && m.m[0] != null) ? m.m[0] : 0,
      pr: (m.m && m.m[1] != null) ? m.m[1] : 0,
      em: em,
      tof: m.tof || [0,0,0,0,0,0],
      pit: (m.imu && m.imu.p != null) ? m.imu.p : 0,
      rol: (m.imu && m.imu.r != null) ? m.imu.r : 0,
      acc: (m.imu && m.imu.az != null) ? m.imu.az : 0
    };
    livePanel.setRow(row);
    if (captureActive) blackboxRows.push(row);
    if (m.gyroEn !== undefined) updateGyroUI(m.gyroEn);
    if (m.logRec !== undefined){
      applyLogStatus({
        recording: m.logRec,
        count: m.logCnt || 0,
        hasFlash: m.logFlash || false
      });
    }
  } else if (m.t === 'log_data' && Array.isArray(m.rows)){
    pktWindow += m.rows.length;
    for (const r of m.rows){
      const row = convertRow(r);
      livePanel.setRow(row);
      if (captureActive || fetching) blackboxRows.push(row);
    }
    cntDirty = true;
  } else if (m.t === 'log_start'){
    if (fetching) toast(`Mengunduh ${m.total || 0} baris dari Flash...`, 'info');
  } else if (m.t === 'log_end'){
    fetching = false;
    toast(`Blackbox selesai diunduh: ${blackboxRows.length} baris siap replay!`, 'ok');
    refreshCounters();
  } else if (m.t === 'log_status'){
    applyLogStatus(m);
  } else if (m.t === 'cal_gyro_ok' || m.t === 'gyro_cal_ok'){
    toast('Kalibrasi Gyro IMU berhasil! Offset zero-rate & tare datar tersimpan.', 'ok', 4000);
  } else if (m.t === 'estop_ok'){
    stopLogging(false, true); // Putus loop spam: stop UI/media tanpa kirim cmd balik ke robot
    toast('EMERGENCY STOP DITERIMA FIRMWARE', 'err');
  } else if (m.t === 'profile'){
    const mode = (m.mode === 'COMPETITION') ? 'COMPETITION' : 'TEST';
    if (profiles[mode]){
      paramKeys.forEach(k => {
        if (m[k] !== undefined) profiles[mode][k] = m[k];
      });
      if (currentTuningMode === mode){
        loadProfileIntoInputs(mode);
      }
    }
    if (m.gyroEn !== undefined) updateGyroUI(m.gyroEn);
    toast(`Profil ${mode} berhasil diterima dari robot`, 'ok');
  }
}

function applyLogStatus(m){
  $('#flCount').textContent = (m.count ?? 0);
  $('#flHas').textContent   = m.hasFlash ? 'TERDETEKSI' : 'TIDAK ADA';
  $('#flTotal').textContent = fmtBytes(m.totalBytes);
  $('#flUsed').textContent  = fmtBytes(m.usedBytes);
  $('#flFree').textContent  = fmtBytes(m.freeBytes);
  $('#flSize').textContent  = fmtBytes(m.fileSize);
  $('#flFill').style.width  = (m.totalBytes ? clamp(m.usedBytes/m.totalBytes*100, 0, 100) : 0) + '%';
  $('#recBadge').classList.toggle('on', !!m.recording || loggingActive);
  $('#btnLogFetch').disabled = !m.hasFlash;
  // Selesai menarik data?
  if (fetching && !m.recording && m.count > 0 && blackboxRows.length >= m.count){
    fetching = false;
    toast('Blackbox diterima: ' + m.count + ' baris — siap replay', 'ok');
    refreshCounters();
  }
}

/* ============================================================
   6. CHASSIS VISUALIZER (Canvas 2D — dipakai Live & Replay)
   ============================================================ */
function rr(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
function arrowHead(ctx, x, y, dir, col, s){
  ctx.save(); ctx.translate(x, y); ctx.rotate(dir + Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(0, -s); ctx.lineTo(s * .7, s * .6); ctx.lineTo(-s * .7, s * .6);
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  ctx.restore();
}

class ChassisViz{
  constructor(canvas){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.row = null; this.dpr = 1;
    new ResizeObserver(() => this.fit()).observe(canvas);
    this.fit();
  }
  fit(){
    const r = this.cv.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width  = Math.round(r.width  * this.dpr);
    this.cv.height = Math.round(r.height * this.dpr);
  }
  render(now){
    const cv = this.cv, ctx = this.ctx, W = cv.width, H = cv.height;
    if (W < 20) return;
    const w = W / this.dpr, h = H / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2, unit = Math.min(w, h) / 2 * 0.94;
    const r = this.row || DEFROW;
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);

    // ---- Arena (lintasan persegi + grid) ----
    ctx.strokeStyle = 'rgba(0,243,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 6; i++){
      const p = cy - unit + unit * 2 * i / 6, q = cx - unit + unit * 2 * i / 6;
      ctx.moveTo(cx - unit, p); ctx.lineTo(cx + unit, p);
      ctx.moveTo(q, cy - unit); ctx.lineTo(q, cy + unit);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,243,255,.12)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - unit, cy - unit, unit * 2, unit * 2);

    const HW = unit * 0.30, HH = unit * 0.385; // setengah dimensi sasis
    this.drawCones(ctx, cx, cy, unit, r, pulse);
    this.drawBody(ctx, cx, cy, HW, HH, r);
    this.drawEdges(ctx, cx, cy, HW, HH, r, pulse, now);
    this.drawMotion(ctx, cx, cy, unit, r);
  }
  /* 6 kerucut ToF — MERAH PEKAT KETIKA ADA OBJEK/MUSUH */
  drawCones(ctx, cx, cy, unit, r, pulse){
    const spread = 0.24, r0 = unit * 0.34;
    for (let i = 0; i < 6; i++){
      const a = TOF_ANGLE[i];
      const v = r.tof[i] ?? 1200;
      const det = v > 0 && v <= 400;                       // musuh/objek terdeteksi
      const len = det ? clamp(v/400, .18, 1) * unit * .55 : unit * .40;
      const px = cx + Math.sin(a) * r0,        py = cy - Math.cos(a) * r0;
      const x1 = cx + Math.sin(a-spread)*(r0+len), y1 = cy - Math.cos(a-spread)*(r0+len);
      const x2 = cx + Math.sin(a+spread)*(r0+len), y2 = cy - Math.cos(a+spread)*(r0+len);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath();
      if (det){
        // Laser merah terang pekat menyala
        ctx.fillStyle = `rgba(255, 0, 50, ${0.55 + 0.25 * pulse})`;
        ctx.fill();
        ctx.strokeStyle = '#ff0033';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Busur deteksi di ujung target
        ctx.beginPath();
        ctx.arc(cx, cy, r0 + len, a - spread, a + spread);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Label jarak merah kontras tinggi dengan badge latar merah pekat
        const tagX = cx + Math.sin(a) * (r0 + len + 18);
        const tagY = cy - Math.cos(a) * (r0 + len + 18);
        const tagText = `${Math.round(v)}mm`;
        ctx.font = '700 11px "JetBrains Mono", monospace';
        const tw = ctx.measureText(tagText).width + 10;
        ctx.fillStyle = '#ff0033';
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 10;
        rr(ctx, tagX - tw/2, tagY - 8, tw, 16, 4);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tagX, tagY);
      } else {
        ctx.fillStyle = 'rgba(0,243,255,.045)'; ctx.fill();
        ctx.strokeStyle = 'rgba(0,243,255,.20)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  /* 4 sensor IR tepi berbentuk lingkaran presisi di tiap sudut robot */
  drawEdges(ctx, cx, cy, HW, HH, r, pulse, now){
    const pts = [[-1,-1,'FL'],[1,-1,'FR'],[-1,1,'BL'],[1,1,'BR']];
    for (let i = 0; i < 4; i++){
      const [fx, fy, name] = pts[i];
      // Pasang pas di tepi sudut dek
      const x = cx + fx * (HW - 4), y = cy + fy * (HH - 4);
      const on = !!(r.em & (1 << i));

      // Jika menyentuh garis putih, buat visualisasi merah mencolok:
      if (on){
        // 1. Aura merah pekat di sudut sasis
        const aura = ctx.createRadialGradient(x, y, 2, x, y, 36);
        aura.addColorStop(0, 'rgba(255, 0, 50, 0.85)');
        aura.addColorStop(0.5, 'rgba(255, 0, 50, 0.35)');
        aura.addColorStop(1, 'rgba(255, 0, 50, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(x, y, 36, 0, Math.PI * 2);
        ctx.fill();

        // 2. Ripple gelombang kejut merah ganda
        const p1 = (now / 450) % 1;
        const p2 = ((now + 225) / 450) % 1;
        ctx.strokeStyle = `rgba(255, 20, 50, ${(1 - p1) * 0.95})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, 10 + p1 * 22, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255, 20, 50, ${(1 - p2) * 0.85})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(x, y, 10 + p2 * 22, 0, Math.PI * 2);
        ctx.stroke();

        // 3. Bezel ring merah menyala
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#1a0508';
        ctx.fill();
        ctx.strokeStyle = '#ff0033';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 4. Lensa LED merah padat dengan titik specular putih
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 24 * pulse + 10;
        ctx.fillStyle = '#ff0033';
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // 5. Badge teks merah menyala dengan seruan peringatan
        const tx = x + (fx < 0 ? -22 : 22);
        const ty = y + (fy < 0 ? -14 : 16);
        const tagText = name + ' !';
        ctx.font = '800 10.5px "JetBrains Mono", monospace';
        const tw = ctx.measureText(tagText).width + 10;
        const th = 16;
        ctx.fillStyle = '#ff0033';
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        rr(ctx, tx - tw/2, ty - th/2, tw, th, 4);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tagText, tx, ty);
      } else {
        // Kondisi aman / lantai hitam (hijau zamrud standby dengan titik LED)
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#0a101f';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.45)';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Badge Standby
        const tx = x + (fx < 0 ? -19 : 19);
        const ty = y + (fy < 0 ? -12 : 14);
        ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
        ctx.strokeStyle = 'rgba(139, 152, 184, 0.35)';
        ctx.lineWidth = 1;
        const tw = 22, th = 14;
        ctx.beginPath();
        rr(ctx, tx - tw/2, ty - th/2, tw, th, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(203, 213, 225, 0.95)';
        ctx.font = '700 9.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, tx, ty);
      }
    }
  }
  /* sasis + blade + roda */
  drawBody(ctx, cx, cy, HW, HH, r){
    const st = STATES[r.st] || STATES[0];
    ctx.fillStyle = '#1c2a4a'; ctx.strokeStyle = 'rgba(0,243,255,.25)'; ctx.lineWidth = 1;
    for (const s of [-1, 1]){                            // roda kiri/kanan
      rr(ctx, cx + s * HW + (s < 0 ? -10 : 2), cy - HH * .55, 8, HH * 1.1, 2);
      ctx.fill(); ctx.stroke();
    }
    rr(ctx, cx - HW, cy - HH, HW * 2, HH * 2, 7);        // dek utama
    ctx.fillStyle = 'rgba(13,20,36,.92)'; ctx.fill();
    ctx.strokeStyle = st.c; ctx.globalAlpha = .55; ctx.lineWidth = 1.6;
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.beginPath();                                     // blade depan
    ctx.moveTo(cx - HW + 2, cy - HH + 1);
    ctx.lineTo(cx - HW * 1.22, cy - HH - 9);
    ctx.lineTo(cx + HW * 1.22, cy - HH - 9);
    ctx.lineTo(cx + HW - 2, cy - HH + 1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,158,11,.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(245,158,11,.75)'; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath();                                     // penanda arah hadap
    ctx.moveTo(cx, cy - HH * .55); ctx.lineTo(cx - 5, cy - HH * .32); ctx.lineTo(cx + 5, cy - HH * .32);
    ctx.closePath(); ctx.fillStyle = 'rgba(0,243,255,.6)'; ctx.fill();
  }
  /* panah vektor gerak dari pwmL/pwmR */
  drawMotion(ctx, cx, cy, unit, r){
    const pl = r.pl || 0, pr = r.pr || 0;
    const v = (pl + pr) / 2, wR = (pr - pl) / 2;
    const av = Math.abs(v), aw = Math.abs(wR);
    if (av < 6 && aw < 6){                               // diam
      ctx.strokeStyle = 'rgba(139,152,184,.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 4, 0, 7); ctx.stroke(); return;
    }
    if (av < 12 && aw >= 12){                            // putar di tempat
      const cw = wR < 0;                                 // pwm kanan > kiri -> belok kiri (CCW)
      const R = unit * .17, a0 = -Math.PI * .5, span = Math.PI * 1.45;
      ctx.strokeStyle = '#00f3ff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,243,255,.7)'; ctx.shadowBlur = 8;
      ctx.beginPath();
      if (cw) ctx.arc(cx, cy, R, a0, a0 + span, false);
      else    ctx.arc(cx, cy, R, a0, a0 - span, true);
      ctx.stroke(); ctx.shadowBlur = 0;
      const ae = cw ? a0 + span : a0 - span;
      arrowHead(ctx, cx + Math.cos(ae) * R, cy + Math.sin(ae) * R,
                ae + (cw ? Math.PI/2 : -Math.PI/2), '#00f3ff', 8);
      return;
    }
    const fwd = v > 0;
    const ang = clamp(-wR * 1.4, -75, 75) * Math.PI / 180;
    const L = unit * (0.16 + Math.min(av, 100) / 100 * 0.26);
    const col = fwd ? (av > 70 ? '#ef4444' : '#10b981') : '#f59e0b';
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang + (fwd ? 0 : Math.PI));
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, L * .55); ctx.lineTo(0, -L * .45); ctx.stroke();
    arrowHead(ctx, 0, -L * .45, -Math.PI / 2, col, 9);
    ctx.restore(); ctx.shadowBlur = 0;
  }
}

/* ============================================================
   7. VIZ PANEL (DOM + Canvas) — template dipakai ulang
   ============================================================ */
function setPwm(fillEl, val){
  const p = clamp(Math.abs(val), 0, 100) / 2;
  if (val >= 0){ fillEl.style.top='auto'; fillEl.style.bottom='50%'; fillEl.classList.remove('neg'); }
  else         { fillEl.style.bottom='auto'; fillEl.style.top='50%'; fillEl.classList.add('neg'); }
  fillEl.style.height = p + '%';
}
const pct = v => (v > 0 ? '+' : '') + Math.round(v) + '%';

class VizPanel{
  constructor(root){
    this.root = root;
    root.innerHTML = this.tpl();
    this.viz = new ChassisViz($('canvas', root));
    this.ui = {
      badge:  $('.vp-badge', root),  clock: $('.vp-clock', root),
      tofBars:$$('.tofbar', root),
      pwmL:   $('.pu-l .pwm-fill', root), pwmR:  $('.pu-r .pwm-fill', root),
      pwmLv:  $('.pu-l .pwm-val',  root), pwmRv: $('.pu-r .pwm-val',  root),
      arrow:  $('.move-arrow', root),     desc:  $('.move-desc', root),
      acc:    $('.accel', root),
      rollBox: $('.mini-bot.front', root), pitchBox: $('.mini-bot.side', root),
      rollVal:$('.rv', root), pitchVal:$('.pv', root),
      tilt:   $('.tilt-badge', root),
      edgeChips: $$('.edge-chip', root)
    };
  }
  tpl(){
    const bars = TOF_CH.map(n => `
      <div class="tofbar">
        <span class="tb-l">${n}</span>
        <div class="tb-t"><div class="tb-f"></div></div>
        <span class="tb-v mono">---</span>
      </div>`).join('');
    const chips = EDGE_POS.map(n => `<span class="edge-chip">${n}</span>`).join('');
    return `
    <div class="vp-tof">${bars}</div>
    <div class="vp-main">
      <div class="vp-stage">
        <canvas></canvas>
        <div class="vp-badge">IDLE</div>
        <div class="vp-clock">00:00.000</div>
        <div class="vp-legend">
          <span><i style="background:#ff3b5c"></i>DETEKSI / EDGE</span>
          <span><i style="background:rgba(16,185,129,.6)"></i>IR AMAN</span>
          <span><i style="background:rgba(0,243,255,.5)"></i>CLEAR</span>
        </div>
      </div>
      <div class="vp-side">
        <div class="vp-block">
          <h4>DRIVE</h4>
          <div class="pwm-wrap">
            <div class="pwm-unit pu-l">
              <div class="pwm-track"><div class="pwm-mid"></div><div class="pwm-fill"></div></div>
              <span class="pwm-val mono">+0%</span><label>MOTOR KIRI</label>
            </div>
            <div class="move-ind">
              <span class="move-arrow">•</span><span class="move-desc">DIAM</span>
            </div>
            <div class="pwm-unit pu-r">
              <div class="pwm-track"><div class="pwm-mid"></div><div class="pwm-fill"></div></div>
              <span class="pwm-val mono">+0%</span><label>MOTOR KANAN</label>
            </div>
          </div>
          <div class="accel-row"><span>ACCEL</span><span><b class="accel">0.00</b> G</span></div>
        </div>
        <div class="vp-block imu-block">
          <h4>IMU TILT (KEMIRINGAN ROBOT)</h4>
          <div class="imu-stack">
            <div class="imu-card">
              <div class="imu-card-head">
                <span class="imu-axis-title">ROLL <small>(Kiri / Kanan)</small></span>
                <b class="mono rv">0.0°</b>
              </div>
              <div class="imu-stage"><div class="horizon"></div><div class="mini-bot front"></div></div>
            </div>
            <div class="imu-card">
              <div class="imu-card-head">
                <span class="imu-axis-title">PITCH <small>(Depan / Belakang)</small></span>
                <b class="mono pv">0.0°</b>
              </div>
              <div class="imu-stage"><div class="horizon"></div><div class="mini-bot side"></div></div>
            </div>
          </div>
          <div class="tilt-badge"><svg class="ic"><use href="#i-warn"/></svg> ROBOT TERANGKAT (TILT)</div>
          <div class="imu-actions">
            <button type="button" class="btn-gyro-toggle on" title="Toggle Logika Gyro IMU (Dodge &amp; Tilt Protect)"><svg class="ic"><use href="#i-bolt"/></svg> <span>GYRO: ON</span></button>
            <button type="button" class="btn-gyro-cal" title="Kalibrasi Zero-Drift &amp; Leveling Gyro Robot"><svg class="ic"><use href="#i-sync"/></svg> KALIBRASI</button>
          </div>
        </div>
        <div class="vp-block">
          <h4>EDGE IR</h4>
          <div class="edge-chips">${chips}</div>
        </div>
      </div>
    </div>`;
  }
  setRow(row){
    if (!row) return;
    this.viz.row = row; // Sambungkan data live/replay ke render Canvas 2D
    const u = this.ui;
    const st = STATES[row.st] || STATES[0];
    u.badge.textContent = st.name;
    u.badge.style.color = st.c;
    u.badge.style.borderColor = st.c;
    u.badge.style.background = hexA(st.c, .12);
    u.clock.textContent = fmtMs(row.t);

    row.tof.forEach((v, i) => {
      const b = u.tofBars[i];
      if (!b) return;
      const vv = +v || 0;
      const isDetected = (vv > 0 && vv <= 400);
      b.classList.toggle('hot', isDetected);
      if (isDetected) {
        // Semakin dekat musuh (1-400mm), bar semakin penuh sebagai indikator peringatan kedekatan
        const pct = Math.min(100, Math.max(12, ((400 - vv) / 400) * 100));
        $('.tb-f', b).style.width = pct.toFixed(1) + '%';
        $('.tb-v', b).textContent = Math.round(vv) + ' mm';
      } else if (vv > 400) {
        $('.tb-f', b).style.width = '0%';
        $('.tb-v', b).textContent = '>400 mm';
      } else {
        $('.tb-f', b).style.width = '0%';
        $('.tb-v', b).textContent = 'CLEAR';
      }
    });

    setPwm(u.pwmL, row.pl); setPwm(u.pwmR, row.pr);
    u.pwmLv.textContent = pct(row.pl); u.pwmRv.textContent = pct(row.pr);

    // Arah gerak
    const v = (row.pl + row.pr) / 2, w = (row.pr - row.pl) / 2;
    const av = Math.abs(v), aw = Math.abs(w);
    let glyph = '•', rot = 0, desc = 'DIAM', col = '#8b98b8';
    if (!(av < 6 && aw < 6)){
      if (av < 12 && aw >= 12){
        glyph = w > 0 ? '↺' : '↻';
        desc  = 'PUTAR ' + (w > 0 ? 'KIRI' : 'KANAN');
        col   = '#00f3ff';
      } else {
        const fwd = v > 0;
        rot = -w * 1.2 + (fwd ? 0 : 180);
        glyph = '↑';
        if (fwd){
          col = av > 70 ? '#ef4444' : '#10b981';
          desc = aw < 10 ? (av > 70 ? 'ATTACK' : 'MAJU')
                         : (w > 0 ? 'SERONG KIRI' : 'SERONG KANAN');
        } else {
          col = '#f59e0b';
          desc = aw < 10 ? 'MUNDUR' : 'MUNDUR ' + (w > 0 ? 'KIRI' : 'KANAN');
        }
      }
    }
    u.arrow.textContent = glyph;
    u.arrow.style.transform = `rotate(${rot}deg)`;
    u.arrow.style.color = col;
    u.desc.textContent = desc; u.desc.style.color = col;
    u.acc.textContent = row.acc.toFixed(2);

    // IMU
    u.rollBox.style.transform  = `translate(-50%,-50%) rotate(${clamp(row.rol, -45, 45)}deg)`;
    u.pitchBox.style.transform = `translate(-50%,-50%) rotate(${clamp(-row.pit, -45, 45)}deg)`;
    u.rollVal.textContent  = (row.rol > 0 ? '+' : '') + row.rol.toFixed(1) + '°';
    u.pitchVal.textContent = (row.pit > 0 ? '+' : '') + row.pit.toFixed(1) + '°';
    u.tilt.classList.toggle('on', Math.abs(row.pit) > 15 || Math.abs(row.rol) > 15);

    // IR edge chips (bit0 FL, bit1 FR, bit2 BL, bit3 BR)
    u.edgeChips.forEach((c, i) => c.classList.toggle('on', !!(row.em & (1 << i))));
  }
  setClock(t){ this.ui.clock.textContent = fmtMs(t); }
}

const livePanel   = new VizPanel($('#liveVizPanel'));
const replayPanel = new VizPanel($('#replayVizPanel'));

/* ============================================================
   8. TUNING & SPEED PROFILES
   ============================================================ */
const profiles = {
  TEST: {
    attackFull: 55, attackOuter: 50, attackInner: 45, turnInPlace: 90, searchSpin: 45,
    dodgeOuter: 60, dodgeInner: -30,
    edgeBackup: 80, edgeEvade: 70, tiltEscape: 90, rearThreat: 70, sideEvade: 60, pushbackJink: 70,
    accelRate: 18,
    startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
  },
  COMPETITION: {
    attackFull: 255, attackOuter: 230, attackInner: 160, turnInPlace: 180, searchSpin: 100,
    dodgeOuter: 180, dodgeInner: -70,
    edgeBackup: 230, edgeEvade: 190, tiltEscape: 255, rearThreat: 255, sideEvade: 180, pushbackJink: 210,
    accelRate: 40,
    startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
  }
};
let currentTuningMode = 'TEST';

const paramKeys = [
  'attackFull', 'attackOuter', 'attackInner', 'turnInPlace', 'searchSpin',
  'edgeBackup', 'edgeEvade', 'tiltEscape', 'rearThreat', 'sideEvade', 'pushbackJink',
  'dodgeOuter', 'dodgeInner', 'accelRate',
  'startDelayMs', 'startTurnMs'
];

// Adapter agar simulasi lokal tetap membaca nilai aktif
const profile = {
  get attackPwm(){ return Math.round((profiles[currentTuningMode].attackFull || 55) / 2.55); },
  get pushPwm(){ return Math.round((profiles[currentTuningMode].attackFull || 55) / 2.55 * 0.8); },
  get turnPwm(){ return Math.round((profiles[currentTuningMode].turnInPlace || 90) / 2.55); },
  get dodgePwm(){ return Math.round((profiles[currentTuningMode].dodgeOuter || 60) / 2.55); },
  get reflexPwm(){ return Math.round((profiles[currentTuningMode].edgeBackup || 80) / 2.55); },
  get edgeBackoffMs(){ return 220; },
  get startDashPwm(){ return Math.round((profiles[currentTuningMode].attackFull || 55) / 2.55); },
  get accelRate(){ return profiles[currentTuningMode].accelRate || 18; }
};

function paintTrack(inp){
  if (!inp) return;
  const min = +inp.min || 0, max = +inp.max || 255, val = +inp.value;
  const p = clamp((val - min) / (max - min) * 100, 0, 100);
  inp.style.background =
    `linear-gradient(90deg, rgba(0,243,255,.55) ${p}%, rgba(139,152,184,.18) ${p}%)`;
}
function markDirty(){
  const btn = $('#btnSaveAllNVM');
  if (btn) btn.classList.add('dirty');
}
function markClean(){
  const btn = $('#btnSaveAllNVM');
  if (btn) btn.classList.remove('dirty');
}

let curveCanvas = null, curveCtx = null, animReq = null;

function initCurveCanvas(){
  curveCanvas = $('#curveCanvas');
  if (curveCanvas) curveCtx = curveCanvas.getContext('2d');
}

function updateCurveStats(){
  const rate = profiles[currentTuningMode].accelRate || 18;
  const rampTimeMs = Math.round((255 / Math.max(1, rate)) * 5);
  const rampEl = $('#calcRampTime');
  if (rampEl) rampEl.textContent = `~${rampTimeMs} ms`;

  const charEl = $('#calcCharacter');
  if (charEl){
    if (rate <= 12) {
      charEl.textContent = 'Ultra-Smooth (Torsi sangat halus, no wheelie)';
    } else if (rate <= 25) {
      charEl.textContent = 'Anti-Jengat Optimal (Roda depan menempel erat)';
    } else if (rate <= 45) {
      charEl.textContent = 'Agresif Lomba (Punchy launch, kontrol blade stabil)';
    } else {
      charEl.textContent = 'Sangat Keras / Rentan Jengat (Mirip lonjakan instan)';
    }
  }
}

function drawCurve(){
  if (!curveCtx || !curveCanvas) return;
  const w = curveCanvas.width, h = curveCanvas.height;
  curveCtx.fillStyle = '#050811';
  curveCtx.fillRect(0, 0, w, h);

  // Grid
  curveCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  curveCtx.lineWidth = 1;
  for (let y = 20; y < h - 20; y += 30) {
    curveCtx.beginPath();
    curveCtx.moveTo(40, y);
    curveCtx.lineTo(w - 20, y);
    curveCtx.stroke();
  }
  for (let x = 40; x < w - 20; x += 50) {
    curveCtx.beginPath();
    curveCtx.moveTo(x, 20);
    curveCtx.lineTo(x, h - 20);
    curveCtx.stroke();
  }

  const rate = profiles[currentTuningMode].accelRate || 18;
  const rampTimeMs = (255 / Math.max(1, rate)) * 5;
  const maxTimeMs = 200;
  const plotW = w - 65;

  // 1. Dashed instant red
  curveCtx.strokeStyle = '#ef4444';
  curveCtx.lineWidth = 1.5;
  curveCtx.setLineDash([4, 4]);
  curveCtx.beginPath();
  curveCtx.moveTo(40, h - 25);
  curveCtx.lineTo(44, 25);
  curveCtx.lineTo(w - 20, 25);
  curveCtx.stroke();
  curveCtx.setLineDash([]);

  // 2. Cyan ramped curve
  curveCtx.strokeStyle = '#00f3ff';
  curveCtx.lineWidth = 2.5;
  curveCtx.beginPath();
  curveCtx.moveTo(40, h - 25);
  const rampEndX = 40 + Math.min(plotW, (rampTimeMs / maxTimeMs) * plotW);
  curveCtx.lineTo(rampEndX, 25);
  curveCtx.lineTo(w - 20, 25);
  curveCtx.stroke();

  // Gradient fill
  curveCtx.fillStyle = 'rgba(0, 243, 255, 0.12)';
  curveCtx.beginPath();
  curveCtx.moveTo(40, h - 25);
  curveCtx.lineTo(rampEndX, 25);
  curveCtx.lineTo(w - 20, 25);
  curveCtx.lineTo(w - 20, h - 25);
  curveCtx.closePath();
  curveCtx.fill();

  // Endpoint
  curveCtx.fillStyle = '#00f3ff';
  curveCtx.beginPath();
  curveCtx.arc(rampEndX, 25, 4, 0, Math.PI * 2);
  curveCtx.fill();
}

function startLaunchSimulation(){
  if (!curveCtx || !curveCanvas) return;
  if (animReq) cancelAnimationFrame(animReq);
  const start = performance.now();
  const rate = profiles[currentTuningMode].accelRate || 18;
  const rampTimeMs = (255 / Math.max(1, rate)) * 5;
  const maxTimeMs = 200;
  const w = curveCanvas.width, h = curveCanvas.height;
  const plotW = w - 65;

  function frame(now){
    const elapsed = now - start;
    drawCurve();

    const curX = 40 + Math.min(plotW, (elapsed / maxTimeMs) * plotW);
    let curY = h - 25;
    if (elapsed < rampTimeMs) {
      const prog = elapsed / rampTimeMs;
      curY = (h - 25) - prog * (h - 50);
    } else {
      curY = 25;
    }

    curveCtx.fillStyle = '#ffffff';
    curveCtx.shadowColor = '#00f3ff';
    curveCtx.shadowBlur = 10;
    curveCtx.beginPath();
    curveCtx.arc(curX, curY, 5, 0, Math.PI * 2);
    curveCtx.fill();
    curveCtx.shadowBlur = 0;

    if (elapsed < 1200) {
      animReq = requestAnimationFrame(frame);
    }
  }
  animReq = requestAnimationFrame(frame);
}

function loadProfileIntoInputs(mode){
  const p = profiles[mode];
  if (!p) return;
  paramKeys.forEach(key => {
    const sEl = $(`#s_${key}`) || (key === 'accelRate' ? $('#sliderAccelRate') : null);
    const nEl = $(`#n_${key}`);
    if (p[key] !== undefined) {
      if (sEl) { sEl.value = p[key]; paintTrack(sEl); }
      if (nEl) { nEl.value = p[key]; }
    }
  });
  const selMode = $('#s_startMode');
  if (selMode && p.startMode) selMode.value = p.startMode;
  updateCurveStats();
  drawCurve();
}

function setTuningMode(mode, notifyRobot = true){
  currentTuningMode = mode;
  $('#btnModeTest')?.classList.toggle('active', mode === 'TEST');
  $('#btnModeComp')?.classList.toggle('active', mode === 'COMPETITION');
  $('#btnHeaderModeTest')?.classList.toggle('active', mode === 'TEST');
  $('#btnHeaderModeComp')?.classList.toggle('active', mode === 'COMPETITION');

  const txtStart = $('#txtStartBtn');
  if (txtStart) {
    txtStart.textContent = mode === 'TEST' ? 'MULAI [TEST]' : 'MULAI [LOMBA]';
  }

  loadProfileIntoInputs(mode);
  if (notifyRobot) {
    sendCmd({ cmd: 'set_spd_mode', mode: mode });
  }
  const label = mode === 'TEST' ? 'TEST (Aman / Meja Pelan)' : 'COMPETITION (Lomba / Full Power)';
  toast(`Mode Robot: ${label}`, 'info');
}

function bindTuning(){
  initCurveCanvas();

  // Mode Switcher
  $('#btnModeTest').addEventListener('click', () => setTuningMode('TEST'));
  $('#btnModeComp').addEventListener('click', () => setTuningMode('COMPETITION'));

  // Dual binding sliders and number inputs
  paramKeys.forEach(key => {
    const sEl = $(`#s_${key}`) || (key === 'accelRate' ? $('#sliderAccelRate') : null);
    const nEl = $(`#n_${key}`);

    if (sEl && nEl) {
      sEl.addEventListener('input', () => {
        const val = parseInt(sEl.value, 10);
        nEl.value = val;
        profiles[currentTuningMode][key] = val;
        paintTrack(sEl);
        if (key === 'accelRate') { updateCurveStats(); drawCurve(); }
        markDirty();
      });

      nEl.addEventListener('input', () => {
        const val = parseInt(nEl.value, 10);
        if (!isNaN(val)) {
          sEl.value = val;
          profiles[currentTuningMode][key] = val;
          paintTrack(sEl);
          if (key === 'accelRate') { updateCurveStats(); drawCurve(); }
          markDirty();
        }
      });
    }
  });

  // Strategy dropdown
  const selMode = $('#s_startMode');
  if (selMode) {
    selMode.addEventListener('change', e => {
      profiles[currentTuningMode].startMode = e.target.value;
      markDirty();
    });
  }

  // Presets
  $$('.btn-chip[data-accel]').forEach(b => {
    b.addEventListener('click', () => {
      const val = parseInt(b.dataset.accel, 10);
      profiles[currentTuningMode].accelRate = val;
      const sEl = $('#sliderAccelRate'), nEl = $('#n_accelRate');
      if (sEl) { sEl.value = val; paintTrack(sEl); }
      if (nEl) { nEl.value = val; }
      updateCurveStats();
      drawCurve();
      markDirty();
    });
  });

  // Simulation Launch Button
  const simBtn = $('#btnSimulateLaunch');
  if (simBtn) simBtn.addEventListener('click', () => startLaunchSimulation());

  // Save Profile to Robot NVM
  $('#btnSaveAllNVM').addEventListener('click', () => {
    const payload = {
      cmd: 'save_profile',
      mode: currentTuningMode,
      ...profiles[currentTuningMode]
    };
    if (sendCmd(payload)){
      toast(`Profil ${currentTuningMode} disimpan ke NVM robot!`, 'ok');
      markClean();
    }
  });

  // Load Profile from Robot NVM
  $('#btnLoadNVM').addEventListener('click', () => {
    if (sendCmd({ cmd: 'get_profile', mode: currentTuningMode })){
      toast(`Meminta data profil ${currentTuningMode} dari NVM robot...`, 'info');
    }
  });

  // Gyro Controls on Tuning Header
  $('#btnTuningGyroToggle')?.addEventListener('click', toggleGyroLogic);
  $('#btnTuningCalGyro')?.addEventListener('click', triggerCalibrateGyro);

  // Preset Controls Event Listeners
  $('#presetSelect')?.addEventListener('change', e => {
    updatePresetUIState(findPresetById(e.target.value));
  });
  $('#btnLoadPreset')?.addEventListener('click', applySelectedPreset);
  $('#btnSavePresetNew')?.addEventListener('click', openSavePresetModal);
  $('#btnUpdatePreset')?.addEventListener('click', updateCurrentPreset);
  $('#btnDeletePreset')?.addEventListener('click', deleteCurrentPreset);
  $('#btnExportPresets')?.addEventListener('click', exportPresetsJson);
  $('#inputImportPresets')?.addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      importPresetsJson(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Modal Save Preset Events
  $('#btnCancelPresetModal')?.addEventListener('click', closeSavePresetModal);
  $('#btnClosePresetModal')?.addEventListener('click', closeSavePresetModal);
  $('#btnConfirmSavePreset')?.addEventListener('click', confirmSavePreset);
  $('#inputPresetName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmSavePreset();
    if (e.key === 'Escape') closeSavePresetModal();
  });
  $('#modalPresetSave')?.addEventListener('click', e => {
    if (e.target.id === 'modalPresetSave') closeSavePresetModal();
  });

  populatePresetDropdown();
  loadProfileIntoInputs(currentTuningMode);
}

/* ============================================================
   PRESET MANAGEMENT LOGIC
   ============================================================ */
const BUILTIN_PRESETS = [
  {
    id: 'aggro_comp',
    name: '🚀 Aggressive Competition (Full Power 255)',
    tag: 'LOMBA RESMI',
    desc: 'Maksimal daya serang 255 PWM, putar serang 180, edge escape cepat, launch agresif (aksel 40).',
    builtIn: true,
    values: {
      attackFull: 255, attackOuter: 230, attackInner: 160, turnInPlace: 180, searchSpin: 100,
      dodgeOuter: 180, dodgeInner: -70,
      edgeBackup: 230, edgeEvade: 190, tiltEscape: 255, rearThreat: 255, sideEvade: 180, pushbackJink: 210,
      accelRate: 40,
      startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
    }
  },
  {
    id: 'heavy_pusher',
    name: '🛡️ Heavy Pusher / Adu Banteng (Torsi Penuh)',
    tag: 'ADU DORONG',
    desc: 'Torsi dorongan rapat (inner 200), pushback jink 240, tilt escape 255, ramp rate stabil (aksel 28).',
    builtIn: true,
    values: {
      attackFull: 255, attackOuter: 245, attackInner: 200, turnInPlace: 160, searchSpin: 90,
      dodgeOuter: 150, dodgeInner: -40,
      edgeBackup: 240, edgeEvade: 200, tiltEscape: 255, rearThreat: 255, sideEvade: 200, pushbackJink: 240,
      accelRate: 28,
      startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
    }
  },
  {
    id: 'speed_flanker',
    name: '⚡ Speed Flanker (Elak Cepat & Sergap Samping)',
    tag: 'TAKTIK FLANK',
    desc: 'Start sapu samping (sweepL), manuver dodge tajam (-90 pivot), manuver lincah (turn 210, aksel 45).',
    builtIn: true,
    values: {
      attackFull: 240, attackOuter: 220, attackInner: 140, turnInPlace: 210, searchSpin: 120,
      dodgeOuter: 220, dodgeInner: -90,
      edgeBackup: 220, edgeEvade: 210, tiltEscape: 240, rearThreat: 240, sideEvade: 220, pushbackJink: 180,
      accelRate: 45,
      startMode: 'sweepL', startDelayMs: 1200, startTurnMs: 500
    }
  },
  {
    id: 'spin_strike',
    name: '🌪️ Spin & Strike (Pencari Cepat Arena Luas)',
    tag: 'SCAN CEPAT',
    desc: 'Putaran pencarian 140 PWM, turn in place 230, sergap kilat saat mendeteksi musuh di dohyo luas.',
    builtIn: true,
    values: {
      attackFull: 255, attackOuter: 210, attackInner: 150, turnInPlace: 230, searchSpin: 140,
      dodgeOuter: 190, dodgeInner: -60,
      edgeBackup: 210, edgeEvade: 180, tiltEscape: 230, rearThreat: 255, sideEvade: 210, pushbackJink: 190,
      accelRate: 38,
      startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
    }
  },
  {
    id: 'table_test',
    name: '🧪 Table Test / Lab Aman (Pelan & Presisi)',
    tag: 'PENGUJIAN AMAN',
    desc: 'PWM rendah 55, manuver pelan untuk uji meja lab, kalibrasi ToF, dan sensor garis aman.',
    builtIn: true,
    values: {
      attackFull: 55, attackOuter: 50, attackInner: 45, turnInPlace: 90, searchSpin: 45,
      dodgeOuter: 60, dodgeInner: -30,
      edgeBackup: 80, edgeEvade: 70, tiltEscape: 90, rearThreat: 70, sideEvade: 60, pushbackJink: 70,
      accelRate: 18,
      startMode: 'dash', startDelayMs: 1500, startTurnMs: 400
    }
  }
];

const PRESET_STORAGE_KEY = 'sumobot_tuning_presets_v1';

function getCustomPresets(){
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    console.error('Gagal membaca presets dari localStorage:', e);
    return [];
  }
}

function saveCustomPresets(list){
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(list));
  } catch(e) {
    console.error('Gagal menyimpan presets ke localStorage:', e);
    toast('Gagal menyimpan preset ke memori browser', 'err');
  }
}

function getAllPresets(){
  const customs = getCustomPresets();
  return [...BUILTIN_PRESETS, ...customs];
}

function findPresetById(id){
  return getAllPresets().find(p => p.id === id);
}

function updatePresetUIState(preset){
  const tagEl = $('#presetBadgeTag');
  const descEl = $('#presetBadgeDesc');
  const btnUpd = $('#btnUpdatePreset');
  const btnDel = $('#btnDeletePreset');

  if (!preset) {
    if (tagEl) tagEl.textContent = 'PRESET';
    if (descEl) descEl.textContent = 'Pilih preset dari daftar di atas.';
    if (btnUpd) btnUpd.disabled = true;
    if (btnDel) btnDel.disabled = true;
    return;
  }

  if (tagEl) {
    tagEl.textContent = preset.builtIn ? (preset.tag || 'BAWAAN') : 'KUSTOM';
    tagEl.style.color = preset.builtIn ? 'var(--cyan)' : '#10b981';
    tagEl.style.borderColor = preset.builtIn ? 'rgba(0,243,255,.3)' : 'rgba(16,185,129,.4)';
    tagEl.style.background = preset.builtIn ? 'rgba(0,243,255,.12)' : 'rgba(16,185,129,.12)';
  }
  if (descEl) {
    descEl.textContent = preset.desc || 'Preset konfigurasi parameter robot.';
  }

  // Built-in presets cannot be updated (overwritten) or deleted
  if (btnUpd) btnUpd.disabled = !!preset.builtIn;
  if (btnDel) btnDel.disabled = !!preset.builtIn;
}

function populatePresetDropdown(selectIdToSet){
  const sel = $('#presetSelect');
  if (!sel) return;

  const currentVal = selectIdToSet || sel.value || 'aggro_comp';
  sel.innerHTML = '';

  const grpBuiltIn = document.createElement('optgroup');
  grpBuiltIn.label = '⭐ PRESET BAWAAN SISTEM';
  BUILTIN_PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    grpBuiltIn.appendChild(opt);
  });
  sel.appendChild(grpBuiltIn);

  const customs = getCustomPresets();
  if (customs.length > 0) {
    const grpCustom = document.createElement('optgroup');
    grpCustom.label = '💾 PRESET KUSTOM ANDA';
    customs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `💾 ${p.name}`;
      grpCustom.appendChild(opt);
    });
    sel.appendChild(grpCustom);
  }

  // Set active selection
  const exists = getAllPresets().some(p => p.id === currentVal);
  sel.value = exists ? currentVal : BUILTIN_PRESETS[0].id;
  updatePresetUIState(findPresetById(sel.value));
}

function applySelectedPreset(){
  const sel = $('#presetSelect');
  if (!sel) return;
  const p = findPresetById(sel.value);
  if (!p || !p.values) {
    toast('Preset tidak valid atau tidak ditemukan!', 'err');
    return;
  }

  // Copy values to current tuning profile
  profiles[currentTuningMode] = {
    ...profiles[currentTuningMode],
    ...JSON.parse(JSON.stringify(p.values))
  };

  loadProfileIntoInputs(currentTuningMode);
  markDirty();
  updatePresetUIState(p);

  const cleanName = p.name.replace(/^[^\w\s]+/, '').trim();
  toast(`Preset "${cleanName}" dimuat ke mode [${currentTuningMode}]!`, 'ok');
}

function openSavePresetModal(){
  const modal = $('#modalPresetSave');
  const inpName = $('#inputPresetName');
  const inpDesc = $('#inputPresetDesc');
  const baseModeBadge = $('#modalPresetBaseMode');

  if (!modal) return;
  if (baseModeBadge) baseModeBadge.textContent = `${currentTuningMode} (${currentTuningMode === 'TEST' ? 'Aman / Meja' : 'Lomba Resmi'})`;
  if (inpName) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    inpName.value = `Tuning ${currentTuningMode} - ${timeStr}`;
    setTimeout(() => inpName.focus(), 100);
  }
  if (inpDesc) inpDesc.value = '';
  modal.classList.remove('hidden');
}

function closeSavePresetModal(){
  const modal = $('#modalPresetSave');
  if (modal) modal.classList.add('hidden');
}

function confirmSavePreset(){
  const inpName = $('#inputPresetName');
  const inpDesc = $('#inputPresetDesc');
  const name = (inpName?.value || '').trim();
  if (!name) {
    toast('Nama preset tidak boleh kosong!', 'warn');
    inpName?.focus();
    return;
  }

  const desc = (inpDesc?.value || '').trim() || `Preset dibuat dari mode ${currentTuningMode}`;
  const newId = 'custom_' + Date.now();
  const newPreset = {
    id: newId,
    name: name,
    desc: desc,
    builtIn: false,
    timestamp: Date.now(),
    mode: currentTuningMode,
    values: JSON.parse(JSON.stringify(profiles[currentTuningMode]))
  };

  const customs = getCustomPresets();
  customs.push(newPreset);
  saveCustomPresets(customs);

  populatePresetDropdown(newId);
  closeSavePresetModal();
  toast(`Preset "${name}" berhasil disimpan!`, 'ok');
}

function updateCurrentPreset(){
  const sel = $('#presetSelect');
  if (!sel) return;
  const p = findPresetById(sel.value);
  if (!p) return;
  if (p.builtIn) {
    toast('Preset bawaan sistem dilindungi dan tidak dapat ditimpa. Gunakan "+ PRESET BARU" untuk menyimpannya.', 'warn');
    return;
  }

  if (!confirm(`Perbarui preset "${p.name}" dengan parameter tuning aktif saat ini?`)) return;

  const customs = getCustomPresets();
  const idx = customs.findIndex(item => item.id === p.id);
  if (idx === -1) return;

  customs[idx].values = JSON.parse(JSON.stringify(profiles[currentTuningMode]));
  customs[idx].timestamp = Date.now();
  saveCustomPresets(customs);

  updatePresetUIState(customs[idx]);
  toast(`Preset "${p.name}" berhasil diperbarui!`, 'ok');
}

function deleteCurrentPreset(){
  const sel = $('#presetSelect');
  if (!sel) return;
  const p = findPresetById(sel.value);
  if (!p) return;
  if (p.builtIn) {
    toast('Preset bawaan sistem tidak dapat dihapus!', 'warn');
    return;
  }

  if (!confirm(`Yakin ingin menghapus preset "${p.name}"? Tindakan ini tidak dapat dibatalkan.`)) return;

  let customs = getCustomPresets();
  customs = customs.filter(item => item.id !== p.id);
  saveCustomPresets(customs);

  populatePresetDropdown(BUILTIN_PRESETS[0].id);
  toast(`Preset "${p.name}" telah dihapus.`, 'info');
}

function exportPresetsJson(){
  const customs = getCustomPresets();
  if (customs.length === 0) {
    toast('Belum ada preset kustom untuk diexport. Simpan preset kustom terlebih dahulu!', 'warn');
    return;
  }
  const dataToExport = {
    appName: 'Sumobot Studio',
    version: '1.0',
    exportDate: new Date().toISOString(),
    presets: customs
  };

  const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `sumobot_tuning_presets_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Berhasil mengexport ${customs.length} preset kustom ke JSON!`, 'ok');
}

function importPresetsJson(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      let incoming = [];
      if (Array.isArray(data)) {
        incoming = data;
      } else if (data && Array.isArray(data.presets)) {
        incoming = data.presets;
      } else if (data && data.values) {
        incoming = [data];
      } else {
        throw new Error('Format file JSON tidak dikenali');
      }

      const customs = getCustomPresets();
      let importedCount = 0;
      let lastId = null;

      incoming.forEach(item => {
        if (!item.values || typeof item.values !== 'object') return;
        const name = (item.name || 'Preset Import').replace(/^💾\s*/, '');
        const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        customs.push({
          id: id,
          name: name,
          desc: item.desc || 'Preset hasil impor JSON',
          builtIn: false,
          timestamp: Date.now(),
          values: item.values
        });
        lastId = id;
        importedCount++;
      });

      if (importedCount === 0) {
        toast('Tidak ditemukan preset valid dalam file JSON!', 'warn');
        return;
      }

      saveCustomPresets(customs);
      populatePresetDropdown(lastId);
      toast(`Berhasil mengimpor ${importedCount} preset!`, 'ok');
    } catch(err) {
      console.error(err);
      toast('Gagal memproses file JSON: ' + (err.message || err), 'err');
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   9. KAMERA LAPTOP + MEDIARECORDER
   ============================================================ */
const cam = { stream:null, devices:[], mr:null, chunks:[], recording:false, url:null, mime:'', enabled:false };
let recStartTime = 0;

async function camRefreshDevices(){
  cam.devices = (await navigator.mediaDevices.enumerateDevices())
                  .filter(d => d.kind === 'videoinput');
  const sel = $('#cameraSelect');
  if (!sel) return;
  sel.innerHTML = '';
  cam.devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || ('Kamera ' + (i + 1));
    sel.appendChild(o);
  });
}
async function camStartPreview(deviceId){
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId:{ exact:deviceId }, width:{ ideal:1280 }, height:{ ideal:720 } }
                    : { width:{ ideal:1280 }, height:{ ideal:720 } },
    audio: false
  });
  const v = $('#cameraLivePreview');
  if (v) v.srcObject = cam.stream;
  const off = $('#camOff');
  if (off) off.classList.add('hidden');
  cam.enabled = true;
  updateCamUI();
}
async function camEnable(){
  try{
    // Minta izin agar label perangkat terbaca di enumerateDevices()
    const s = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
    s.getTracks().forEach(t => t.stop());
    await camRefreshDevices();
    const sel = $('#cameraSelect');
    const devId = sel?.value || (cam.devices.length ? cam.devices[0].deviceId : undefined);
    if (devId) await camStartPreview(devId);
    else if (cam.devices.length) await camStartPreview(cam.devices[0].deviceId);
    cam.enabled = true;
    updateCamUI();
    toast('Kamera aktif — ' + cam.devices.length + ' perangkat ditemukan', 'ok');
  } catch(e){
    const off = $('#camOff');
    if (off) off.textContent = 'KAMERA TIDAK TERSEDIA';
    cam.enabled = false;
    updateCamUI();
    toast('Kamera tidak tersedia: ' + e.message, 'warn');
  }
}
function camDisable(){
  if (cam.recording){
    toast('Hentikan rekaman terlebih dahulu sebelum mematikan kamera', 'warn');
    return;
  }
  if (cam.stream){
    cam.stream.getTracks().forEach(t => t.stop());
    cam.stream = null;
  }
  const v = $('#cameraLivePreview');
  if (v) v.srcObject = null;
  cam.enabled = false;
  const off = $('#camOff');
  if (off) {
    off.classList.remove('hidden');
    off.textContent = 'KAMERA NONAKTIF (KLIK AKTIFKAN)';
  }
  updateCamUI();
  toast('Kamera laptop dimatikan (Off)', 'info');
}
async function camToggle(){
  const isLive = !!(cam.stream && cam.stream.getVideoTracks().some(t => t.readyState === 'live'));
  if (isLive){
    camDisable();
  } else {
    await camEnable();
  }
}
function updateCamUI(){
  const isLive = !!(cam.stream && cam.stream.getVideoTracks().some(t => t.readyState === 'live'));
  const btn = $('#btnCamToggle');
  const txt = $('#txtCamToggle');
  const pill = $('#camStatusPill');

  if (txt) txt.textContent = isLive ? 'MATIKAN' : 'AKTIFKAN';
  if (btn) {
    btn.classList.toggle('btn-outline-danger', isLive);
    btn.title = isLive ? 'Matikan webcam laptop (Hemat Daya/Privasi)' : 'Aktifkan webcam laptop';
  }
  if (pill){
    pill.textContent = isLive ? 'ON' : 'OFF';
    pill.classList.toggle('on', isLive);
  }
}
function pickMime(){
  if (!window.MediaRecorder) return '';
  const list = ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm','video/mp4'];
  for (const m of list)
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function camStartRec(){
  if (!cam.stream || !cam.stream.getVideoTracks().some(t => t.readyState === 'live')){
    toast('Kamera laptop nonaktif — Blackbox Flash ESP32 tetap direkam', 'info');
    return;
  }
  if (!window.MediaRecorder){ toast('MediaRecorder tidak didukung browser', 'warn'); return; }
  try{
    cam.mime = pickMime(); cam.chunks = [];
    cam.mr = new MediaRecorder(cam.stream, cam.mime ? { mimeType:cam.mime } : undefined);
    cam.mr.ondataavailable = e => { if (e.data && e.data.size) cam.chunks.push(e.data); };
    cam.mr.onstop = () => {
      const blob = new Blob(cam.chunks, { type: cam.mime || 'video/webm' });
      if (cam.url) URL.revokeObjectURL(cam.url);
      cam.url = URL.createObjectURL(blob);
      cam.recording = false;
      loadReplayVideo(cam.url, 'rekaman-kamera.webm');
      $('#recReady')?.classList.remove('hidden');
      toast('Video match siap — buka tab PREVIEW & REPLAY', 'ok', 4500);
      updateRecUI();
    };
    cam.mr.start(250);
    cam.recording = true;
  } catch(e){ toast('Gagal mulai rekam kamera: ' + e.message, 'warn'); }
}
function camStopRec(){
  if (cam.mr && cam.mr.state !== 'inactive'){ try { cam.mr.stop(); } catch {} }
  else { cam.recording = false; }
  updateRecUI();
}
function bindCam(){
  $('#btnCamToggle')?.addEventListener('click', camToggle);
  $('#cameraSelect')?.addEventListener('change', async e => {
    if (cam.recording){ toast('Tidak bisa ganti kamera saat merekam', 'warn'); return; }
    try { await camStartPreview(e.target.value); }
    catch(err){ toast('Gagal buka kamera: ' + err.message, 'warn'); }
  });
  // Coba deteksi awal (jika izin sudah pernah diberikan)
  (async () => {
    if (!navigator.mediaDevices) return;
    try{
      const d = await navigator.mediaDevices.enumerateDevices();
      if (d.some(x => x.kind === 'videoinput' && x.label)){
        await camRefreshDevices();
        if (cam.devices.length) await camStartPreview(cam.devices[0].deviceId).catch(() => {});
      }
    } catch {}
  })();
}

/* ============================================================
   10. BLACKBOX — REKAM / FETCH / CSV / CLEAR
   ============================================================ */
function updateRecUI(){
  const on = loggingActive || cam.recording;
  $('#recBadge')?.classList.toggle('on', on);
  $('#camRecDot')?.classList.toggle('on', cam.recording);

  // Topbar Header Record Button
  const btnHeadRec = $('#btnHeaderRecord'), txtHeadRec = $('#txtHeaderRecord');
  if (btnHeadRec) {
    btnHeadRec.classList.toggle('recording', on);
    if (txtHeadRec) txtHeadRec.textContent = on ? 'STOP REKAM' : 'REKAM DATA';
  }

  // Blackbox Tab Buttons
  const btnStart = $('#btnLogStart'), btnStop = $('#btnLogStop');
  if (btnStart) btnStart.disabled = loggingActive;
  if (btnStop)  btnStop.disabled  = !loggingActive;

  // Dashboard Quick Record Buttons
  const btnDashStart = $('#btnDashLogStart'), btnDashStop = $('#btnDashLogStop');
  if (btnDashStart) btnDashStart.disabled = loggingActive;
  if (btnDashStop)  btnDashStop.disabled  = !loggingActive;

  const dashInd = $('#dashRecIndicator');
  if (dashInd) dashInd.classList.toggle('active', on);

  updateCamUI();
}
function startLogging(){
  if (loggingActive) return;
  if (!link.mode){ toast('Hubungkan robot / aktifkan Simulasi dulu', 'warn'); return; }
  blackboxRows.length = 0; fetching = false;
  captureActive = true; loggingActive = true;
  recStartTime = performance.now();
  sendCmd({ cmd:'log_start' });
  camStartRec();
  updateRecUI(); refreshCounters();
  toast('Merekam: blackbox + kamera sinkron', 'ok');
}
function stopLogging(sendRobotCmd = true, isEstop = false){
  if (!loggingActive && !cam.recording){
    if (sendRobotCmd && isEstop) sendCmd({ cmd:'estop' });
    return;
  }
  loggingActive = false; captureActive = false; fetching = false;
  if (sendRobotCmd){
    sendCmd(isEstop ? { cmd:'estop' } : { cmd:'log_stop' });
  }
  camStopRec();
  updateRecUI(); refreshCounters();
  if (!cam.mr && !isEstop)
    toast('Rekaman dihentikan — data replay tersedia dari buffer live', 'info');
}
function refreshCounters(){
  const dur = blackboxRows.length ? blackboxRows[blackboxRows.length - 1].t : 0;
  $('#recBuf').textContent = `${blackboxRows.length} baris · ${fmtMs(dur)}`;
  rpRefreshInfo();
}
function downloadCsv(){
  if (!blackboxRows.length){ toast('Belum ada data untuk diunduh', 'warn'); return; }
  const head = 'tMs,state,pwmL,pwmR,edgeMask,fl,fc,fr,ml,mr,rr,pitch,roll,accel';
  const lines = blackboxRows.map(r => [
    r.t, (STATES[r.st] || { name:r.st }).name,
    r.pl, r.pr, r.em, ...r.tof,
    r.pit.toFixed(1), r.rol.toFixed(1), r.acc.toFixed(2)
  ].join(','));
  const blob = new Blob([head + '\n' + lines.join('\n')], { type:'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'blackbox.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('CSV diunduh (' + blackboxRows.length + ' baris)', 'ok');
}
function bindBlackbox(){
  // Tombol di tab Blackbox
  $('#btnLogStart')?.addEventListener('click', startLogging);
  $('#btnLogStop')?.addEventListener('click', () => stopLogging(false));

  // Tombol pintas di tab Dashboard
  $('#btnDashLogStart')?.addEventListener('click', startLogging);
  $('#btnDashLogStop')?.addEventListener('click', () => stopLogging(false));

  $('#btnLogFetch')?.addEventListener('click', () => {
    if (!link.mode){ toast('Hubungkan robot dulu', 'warn'); return; }
    blackboxRows.length = 0; fetching = true;
    sendCmd({ cmd:'log_fetch' });
    refreshCounters();
    toast('Menarik data blackbox dari flash…');
  });
  $('#btnCsv')?.addEventListener('click', downloadCsv);

  // Hapus flash: konfirmasi dua-tahap (tanpa confirm())
  let armed = false, armT = null;
  const btn = $('#btnLogClear'), lbl = $('#clearLabel');
  const disarm = () => { armed = false; btn?.classList.remove('armed'); if (lbl) lbl.textContent = 'HAPUS FLASH'; };
  btn?.addEventListener('click', () => {
    if (!armed){
      armed = true; btn.classList.add('armed'); if (lbl) lbl.textContent = 'YAKIN? KLIK LAGI';
      clearTimeout(armT); armT = setTimeout(disarm, 3000);
      return;
    }
    clearTimeout(armT); disarm();
    blackboxRows.length = 0;
    sendCmd({ cmd:'log_clear' });
    refreshCounters();
    toast('File /blackbox.csv dihapus', 'warn');
  });

  $('#btnGoPreview').addEventListener('click', () => switchTab('tab-preview'));
}

/* ============================================================
   11. REPLAY — video sebagai master clock telemetri
   ============================================================ */
const rp = {
  video:null, ready:false, videoDur:0, dataDur:0,
  offset:0, manualT:0, manualPlay:false, speed:1,
  scrubbing:false, ownUrl:null
};
function masterDur(){ return Math.max(rp.ready ? rp.videoDur : 0, rp.dataDur); }

function rowAt(t){
  const a = blackboxRows;
  if (!a.length) return null;
  let lo = 0, hi = a.length - 1, res = a[0];
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    if (a[mid].t <= t){ res = a[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}
function loadReplayVideo(url, name){
  rp.video.src = url;
  $('#videoEmpty').classList.add('hidden');
  $('#vidName').textContent = name || 'video';
  rp.video.load();
}
function rpRefreshInfo(){
  rp.dataDur = blackboxRows.length ? blackboxRows[blackboxRows.length - 1].t : 0;
  $('#rpInfo').textContent = `${blackboxRows.length} baris data · durasi ${fmtMs(rp.dataDur)}`;
  $('#rpEmpty').classList.toggle('hidden', blackboxRows.length > 0);
  $('#vSeek').max = Math.max(1, Math.round(masterDur()));
  $('#vDur').textContent = fmtMs(masterDur());
}
function setVPlayIcon(playing){
  $('#btnVPlay').innerHTML =
    `<svg class="ic"><use href="#i-${playing ? 'pause' : 'play'}"/></svg>`;
}
function replayTick(dt){
  const dur = masterDur();
  let t;
  if (rp.ready && rp.video.src){
    t = rp.video.currentTime * 1000 + rp.offset;      // video = master clock
  } else {
    if (rp.manualPlay){
      rp.manualT += dt * rp.speed;
      if (rp.manualT >= dur){ rp.manualT = dur; rp.manualPlay = false; setVPlayIcon(false); }
    }
    t = rp.manualT;
  }
  t = clamp(t, 0, Math.max(dur, 1));
  if (!rp.scrubbing) $('#vSeek').value = Math.round(t);
  $('#vTime').textContent = fmtMs(t);
  const row = rowAt(t) || DEFROW;
  replayPanel.setRow(row);
  replayPanel.setClock(t);
  const playing = rp.ready && rp.video.src ? !rp.video.paused : rp.manualPlay;
  $('#syncChip').classList.toggle('live', playing);
}
function bindReplay(){
  rp.video = $('#replayVideo');
  rp.video.addEventListener('loadedmetadata', () => {
    rp.videoDur = rp.video.duration * 1000 || 0;
    rp.ready = true;
    rpRefreshInfo();
  });
  rp.video.addEventListener('play',  () => setVPlayIcon(true));
  rp.video.addEventListener('pause', () => setVPlayIcon(false));
  rp.video.addEventListener('ended', () => setVPlayIcon(false));

  $('#btnVPlay').addEventListener('click', () => {
    if (rp.ready && rp.video.src){
      rp.video.paused ? rp.video.play().catch(() => {}) : rp.video.pause();
    } else {
      if (!blackboxRows.length){ toast('Belum ada data blackbox', 'warn'); return; }
      if (rp.manualT >= masterDur()) rp.manualT = 0;
      rp.manualPlay = !rp.manualPlay;
      setVPlayIcon(rp.manualPlay);
    }
  });
  const seek = $('#vSeek');
  seek.addEventListener('pointerdown', () => rp.scrubbing = true);
  seek.addEventListener('input', e => {
    const t = +e.target.value;
    if (rp.ready && rp.video.src){
      rp.video.currentTime = clamp((t - rp.offset) / 1000, 0, rp.videoDur / 1000);
    } else rp.manualT = t;
    const row = rowAt(t) || DEFROW;
    replayPanel.setRow(row);
    replayPanel.setClock(t);
    $('#vTime').textContent = fmtMs(t);
  });
  seek.addEventListener('change', () => rp.scrubbing = false);

  $('#vSpeed').addEventListener('change', e => {
    rp.speed = +e.target.value;
    if (rp.video) rp.video.playbackRate = rp.speed;
  });

  // Sync offset (kalibrasi video vs blackbox)
  const offLbl = $('#offVal');
  const setOff = v => { rp.offset = clamp(v, -2000, 2000); offLbl.textContent = rp.offset + ' ms'; };
  $('#offMinus').addEventListener('click', () => setOff(rp.offset - 25));
  $('#offPlus') .addEventListener('click', () => setOff(rp.offset + 25));
  $('#offReset').addEventListener('click', () => setOff(0));

  // Upload video eksternal (dua input, satu handler)
  const onFile = e => {
    const f = e.target.files[0]; if (!f) return;
    if (rp.ownUrl) URL.revokeObjectURL(rp.ownUrl);
    rp.ownUrl = URL.createObjectURL(f);
    loadReplayVideo(rp.ownUrl, f.name);
    $('#fileVideoName').textContent = f.name;
    toast('Video dimuat: ' + f.name, 'ok');
    switchTab('tab-preview');
    e.target.value = '';
  };
  $('#fileVideo').addEventListener('change', onFile);
  $('#fileVideo2').addEventListener('change', onFile);

  // Spasi = play/pause saat di tab preview
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' &&
        $('#tab-preview').classList.contains('active') &&
        !/INPUT|SELECT|TEXTAREA|VIDEO/.test(document.activeElement.tagName)){
      e.preventDefault();
      $('#btnVPlay').click();
    }
  });
}

/* ============================================================
   12. MODE SIMULASI — generator data dummy (40 Hz)
   ============================================================ */
const sim = {
  active:false, running:false,
  t:0, idx:0, acc:0, st:0, pl:0, pr:0, em:0,
  tof:[1150,1150,1150,1100,1100,1200], tgt:null,
  pit:0, rol:0, pitT:0,
  phase:'idle', phT:0, dir:1,
  enemyT:0, enemy:600, pushT:2000, tiltT:0, edgeBit:0,

  reset(){
    Object.assign(this, {
      t:0, idx:0, acc:0, st:0, pl:0, pr:0, em:0, pit:0, rol:0, pitT:0,
      phase:'idle', phT:0, dir:1, enemyT:0, enemy:600, pushT:2000, tiltT:0
    });
  },
  toggle(){
    this.active = !this.active;
    if (this.active){ this.reset(); setLink('sim'); toast('Mode simulasi aktif — data dummy 40 Hz', 'ok'); }
    else { this.running = false; if (link.mode === 'sim') setLink(null); toast('Simulasi dimatikan', 'info'); }
  },
  cmd(o){
    switch (o.cmd){
      case 'estop':        this.running = false; this.st = 0; this.pl = 0; this.pr = 0; this.em = 0; break;
      case 'combat_start': this.running = true; this.phase = 'wait'; this.phT = 0; break;
      case 'combat_stop':  this.running = false; this.st = 0; this.pl = 0; this.pr = 0; break;
      case 'save_profile': toast('Profil disimpan (simulasi)', 'ok'); break;
    }
  },
  step(dt){
    if (!this.active) return;
    if (this.running) this.behave(dt);
    this.acc += dt;
    const stepMs = 25;                                   // 40 Hz
    while (this.acc >= stepMs){
      this.acc -= stepMs;
      this.t += stepMs;
      handleMsg({ t:'log_data', idx:this.idx++, rows:[[
        this.t, this.st, this.pl, this.pr, this.em,
        ...this.tof,
        Math.round(this.pit * 10), Math.round(this.rol * 10), Math.round(0.98 * 100)
      ]]});
    }
  },
  behave(dt){
    this.phT += dt;
    const R = Math.random;
    const m = (l, r) => { this.pl = l; this.pr = r; };
    const set = p => { this.phase = p; this.phT = 0; };

    switch (this.phase){
      case 'wait':  this.st = 0; m(0, 0);
        if (this.phT > 1400) set('dash'); break;
      case 'dash':  this.st = 2; m(profile.startDashPwm, profile.startDashPwm);
        if (this.phT > 480) set('search'); break;
      case 'search':{
        this.st = 2;
        m(38 * this.dir, -30 * this.dir);
        this.enemyT -= dt;
        // Saat berputar mencari, musuh melintas di sisi samping kiri (ML) atau kanan (MR)
        const sideTgt = (this.enemyT < 800) ? 260 + R() * 80 : 1050;
        if (this.dir > 0) {
          this.tgt = [950, 880, 750, 1100, sideTgt, 1150]; // melintas di kanan (MR)
        } else {
          this.tgt = [750, 880, 950, sideTgt, 1100, 1150]; // melintas di kiri (ML)
        }
        if (this.enemyT <= 0){ this.enemy = 520 + R() * 160; set('track'); }
        break;
      }
      case 'track':{
        this.st = 3; m(42, 58);
        this.enemy -= dt * .35;
        this.tgt = [this.enemy*1.5, this.enemy*1.05, this.enemy*1.25, 950, 950, 1150];
        if (this.enemy <= 240) set('attack');
        else if (R() < dt/6000){ this.enemyT = 1800 + R()*2600; this.dir *= -1; set('search'); }
        break;
      }
      case 'attack':{
        this.st = 4; m(profile.attackPwm, profile.attackPwm);
        this.enemy = Math.max(95, this.enemy - dt * .75);
        this.tgt = [this.enemy*1.4, this.enemy, this.enemy*1.15, 900, 980, 1150];
        if (this.enemy <= 130) set('push');
        else if (R() < dt/5000){ this.enemyT = 1500 + R()*2500; set('search'); }
        break;
      }
      case 'push':{
        this.st = 6; m(profile.pushPwm, profile.pushPwm);
        this.enemy = 100 + Math.sin(this.t/90) * 18;
        this.tgt = [this.enemy*1.3, this.enemy, this.enemy*1.1, 880, 960, 1150];
        this.pitT = Math.sin(this.t/110) * 3.5;
        this.pushT -= dt;
        if (R() < dt/9000){                              // terangkat musuh -> TILT
          this.pitT = (R() < .5 ? -1 : 1) * (18 + R() * 9);
          this.tiltT = 500;
        }
        if (this.pushT <= 0){
          this.pushT = 1200 + R()*2600; this.enemyT = 1200 + R()*3200;
          this.dir *= -1; this.pitT = 0; set('search');
        }
        break;
      }
      case 'edge':{
        this.st = 5; m(-profile.reflexPwm, -profile.reflexPwm);
        this.tgt = [1100, 1100, 1100, 1000, 1000, 220 + R() * 80]; // musuh mengejar dari belakang (RR)
        if (this.phT > profile.edgeBackoffMs){ this.em = 0; set('dodge'); }
        break;
      }
      case 'dodge':{
        this.st = 1; m(-profile.dodgePwm * this.dir, profile.dodgePwm * this.dir);
        this.tgt = [1050, 1050, 1050, 280, 1050, 310];
        if (this.phT > 380) set('search');
        break;
      }
      default: this.st = 0; m(0, 0);
    }

    // Trigger EDGE acak saat menyerang / mendorong
    if ((this.phase === 'attack' || this.phase === 'dash' || this.phase === 'push') &&
        R() < dt/7000){
      this.edgeBit = 1 << ((R() * 4) | 0);
      this.em = this.edgeBit; this.pitT = 0; set('edge');
    }
    if (this.tiltT > 0){ this.tiltT -= dt; this.st = 7; m(-60, -60); }

    // Haluskan nilai ToF & IMU
    for (let i = 0; i < 6; i++){
      const tg = this.tgt ? this.tgt[i] : 1150;
      this.tof[i] += (tg - this.tof[i]) * Math.min(1, dt/120);
      this.tof[i] = Math.round(clamp(this.tof[i] + (R()*2-1)*14, 30, 1200));
    }
    this.pit += (this.pitT - this.pit) * Math.min(1, dt/100);
    this.rol *= (1 - Math.min(1, dt/200));
  }
};

/* ============================================================
   13. TAB, HEADER, LOOP UTAMA
   ============================================================ */
function switchTab(id){
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  $$('.tabpage').forEach(p => p.classList.toggle('active', p.id === id));
  if (id === 'tab-preview') requestAnimationFrame(() => replayPanel.viz.fit());
  if (id === 'tab-dashboard') livePanel.viz.fit();
}

function bindHeader(){
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.tab);
  });
  $('#btnBle').addEventListener('click', () => {
    link.mode === 'ble' ? (link.bleDev && link.bleDev.gatt.disconnect()) : bleConnect();
  });
  $('#btnSerial').addEventListener('click', () => {
    link.mode === 'serial' ? serialDisconnect() : serialConnect();
  });
  $('#btnSim').addEventListener('click', () => sim.toggle());

  $('#btnHeaderModeTest')?.addEventListener('click', () => setTuningMode('TEST'));
  $('#btnHeaderModeComp')?.addEventListener('click', () => setTuningMode('COMPETITION'));

  $('#btnQuickStart').addEventListener('click', () => {
    sendCmd({ cmd:'combat_start' });
    toast('Pertandingan Dimulai (Otonom Maju/Attack)', 'ok');
  });
  $('#btnQuickStop').addEventListener('click', () => {
    sendCmd({ cmd:'combat_stop' });
    toast('Pertandingan Dihentikan (Standby)', 'info');
  });

  // Global delegation for gyro toggle and calibration buttons
  document.addEventListener('click', e => {
    const tgl = e.target.closest('.btn-gyro-toggle');
    if (tgl) { e.preventDefault(); toggleGyroLogic(); return; }
    const cal = e.target.closest('.btn-gyro-cal');
    if (cal) { e.preventDefault(); triggerCalibrateGyro(); return; }
  });

  $('#btnHeaderRecord')?.addEventListener('click', () => {
    if (loggingActive || cam.recording) {
      stopLogging(true);
    } else {
      startLogging();
    }
  });
  let lastEstopTime = 0;
  $('#btnEstop').addEventListener('click', () => {
    const now = performance.now();
    if (now - lastEstopTime < 600) return; // Debounce 600ms anti-spam
    lastEstopTime = now;

    sendCmd({ cmd:'estop' });
    if (link.mode === 'sim'){ sim.running = false; sim.st = 0; sim.pl = 0; sim.pr = 0; }
    stopLogging(false, true); // hentikan kamera/UI tanpa kirim paket ganda
    document.body.classList.remove('estop-flash');
    void document.body.offsetWidth;       // restart animasi
    document.body.classList.add('estop-flash');
    toast('EMERGENCY STOP DIKIRIM', 'err');
  });
}

let lastT = performance.now();
function loop(now){
  const dt = Math.min(100, now - lastT);
  lastT = now;

  livePanel.viz.render(now);
  if ($('#tab-preview').classList.contains('active')){
    replayPanel.viz.render(now);
    replayTick(dt);
  }
  sim.step(dt);

  // Update live recording elapsed time on Dashboard
  if (loggingActive || cam.recording){
    const elTime = $('#dashRecTime');
    if (elTime){
      const elap = Math.max(0, performance.now() - recStartTime);
      elTime.textContent = fmtMs(elap);
    }
  }

  // Meter link
  if (now - hzLast > 500){
    $('#statHz').textContent = (pktWindow * 1000 / (now - hzLast)).toFixed(1) + ' Hz';
    pktWindow = 0; hzLast = now;
  }
  $('#statPk').textContent = pktCount + ' pkt';
  const age = lastPktAt ? now - lastPktAt : null;
  const ageEl = $('#statAge');
  if (age == null){ ageEl.textContent = '—'; ageEl.classList.remove('ok'); }
  else if (age < 500){ ageEl.textContent = 'LIVE'; ageEl.classList.add('ok'); }
  else { ageEl.textContent = 'idle ' + Math.round(age/1000) + 's'; ageEl.classList.remove('ok'); }

  // Refresh counter buffer (throttled)
  if (cntDirty && now - lastCnt > 300){
    lastCnt = now; cntDirty = false;
    refreshCounters();
  }
  requestAnimationFrame(loop);
}

/* ---------------- BOOT ---------------- */
bindTuning();
bindCam();
bindBlackbox();
bindReplay();
bindHeader();
updateRecUI();
rpRefreshInfo();
requestAnimationFrame(loop);