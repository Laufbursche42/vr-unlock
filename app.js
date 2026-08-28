// Laufbursche Viron Tool: a Web Bluetooth client for the Viron / MiniRobot / XBOT BLE protocol.
// Copyright (c) 2026 Laufbursche (https://github.com/Laufbursche42)
// A self-contained Web Bluetooth client. The protocol layer is Viron: register read/write over a
// 55 AA frame with a 16-bit
// one's-complement checksum, plaintext. Everything about the protocol is from static analysis of the
// MiniRobot app (com.loby.balance.car.google 11.3.7) plus the plaintext controller firmware, cross
// checked in Ghidra. Runs in a Web Bluetooth browser: Bluefy on iOS, Chrome/Edge on Android/desktop.

'use strict';

const BUILD = 'v7';   // logged on load so a tester's log reveals which deployed build is running

// --------------------------- hex helpers ---------------------------

function hexToBytes(h) { h = (h || '').replace(/[^0-9a-fA-F]/g, ''); const a = []; for (let i = 0; i + 1 < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16)); return a; }
function bytesToHex(b) { return [...b].map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' '); }

// --------------------------- Viron frame (belegt: Bluetooth::SendFramePack 0x55c828) ---------------------------
// Standard frame (header 55 AA):  55 AA <len+2> cmd type addr payload...  cks_lo cks_hi
// values are 16-bit little-endian; checksum = ~(sum of bytes from the length byte to the last payload
// byte) & 0xFFFF, little-endian. The controller verifies exactly this (Ghidra FUN_0801e590).

function buildFrame(cmd, type, addr, payload) {
  const body = [cmd & 0xff, type & 0xff, addr & 0xff, ...payload.map(x => x & 0xff)];
  const lenByte = (payload.length + 2) & 0xff;
  let sum = lenByte; for (const b of body) sum = (sum + b) & 0xffff;
  const cks = (~sum) & 0xffff;
  return new Uint8Array([0x55, 0xAA, lenByte, ...body, cks & 0xff, (cks >> 8) & 0xff]);
}
// The app has three write-command frames that differ ONLY in the command byte, type is always 0x03,
// value is a 16-bit little-endian short (belegt in Ghidra):
//   SendWriteCmd    -> cmd 0x06   (e.g. limit toggle on variant 0, normal-speed 0x73)
//   SendWriteCmd2   -> cmd 0x0A   (e.g. max speed 0x7d, limit toggle on the common variant)
//   SendWriteCmd_HB -> cmd 0x20   (e.g. per-mode limit speed 0xf0/0xef/0xf1/0xf3)
function frameWriteCmd(addr, val)  { return buildFrame(0x06, 0x03, addr & 0xff, [val & 0xff, (val >> 8) & 0xff]); }
function frameWriteCmd2(addr, val) { return buildFrame(0x0A, 0x03, addr & 0xff, [val & 0xff, (val >> 8) & 0xff]); }
function frameWriteHB(addr, val)   { return buildFrame(0x20, 0x03, addr & 0xff, [val & 0xff, (val >> 8) & 0xff]); }
function frameWrite(addr, val)     { return frameWriteCmd(addr, val); }   // alias used by the free command
// Read request: best-effort (write path is belegt, the read form is inferred). cmd 6, type 1, count.
function frameRead(addr, count) { return buildFrame(0x06, 0x01, addr & 0xff, [(count || 1) & 0xff]); }

// Self-test: the verified example frame "Limit off" (reg 0x72 = 0) must be 55 AA 04 06 03 72 00 00 80 FF.
let FRAME_OK = false;
(function frameSelfTest() {
  FRAME_OK = bytesToHex(frameWrite(0x72, 0)) === '55 AA 04 06 03 72 00 00 80 FF';
})();

// --------------------------- BLE transport constants (belegt: BluetoothService.java) ---------------------------

const TRANSPORTS = {
  nordic: { name: 'Nordic UART', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  ae00:   { name: 'AE00',        service: '0000ae00-0000-1000-8000-00805f9b34fb', write: '0000ae01-0000-1000-8000-00805f9b34fb', notify: '0000ae02-0000-1000-8000-00805f9b34fb' },
  ffe0:   { name: 'FFE0/FFF3',   service: '0000ffe0-0000-1000-8000-00805f9b34fb', write: '0000fff3-0000-1000-8000-00805f9b34fb', notify: '0000fff4-0000-1000-8000-00805f9b34fb' },
  fff0a:  { name: 'FFF0/FFF3',   service: '0000fff0-0000-1000-8000-00805f9b34fb', write: '0000fff3-0000-1000-8000-00805f9b34fb', notify: '0000fff7-0000-1000-8000-00805f9b34fb' },
  fff0b:  { name: 'FFF0/FFF2',   service: '0000fff0-0000-1000-8000-00805f9b34fb', write: '0000fff2-0000-1000-8000-00805f9b34fb', notify: '0000fff1-0000-1000-8000-00805f9b34fb' },
};
const TRANSPORT_ORDER = ['nordic', 'ae00', 'ffe0', 'fff0a', 'fff0b'];
const ALL_SERVICES = [...new Set(TRANSPORT_ORDER.map(k => TRANSPORTS[k].service))];
const SCAN_PREFIX = 'M0Robot';   // the Viron advertises with this name part (Fremdbericht)

const LS_THEME = 'vru_theme', LS_DEVICE = 'vru_device', LS_OPEN = 'vru_open', LS_STOCK = 'vru_stock';

// --------------------------- state ---------------------------

let device = null, server = null, writeChar = null, notifyChar = null, usedTransport = TRANSPORTS.nordic;
let connected = false, connecting = false;
let speedUnlocked = false;   // local lock/unlock state; the toggle shows the action for the other state
const reg = {};   // last seen register store: dec register -> 16-bit value

// --------------------------- UI helpers ---------------------------

function $(id) { return document.getElementById(id); }

const logLines = [];
function ts() {
  const d = new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
}
function log(m, cls) {
  const line = '[' + ts() + '] ' + m;
  logLines.push(line);
  const el = $('log'); if (!el) return;
  const span = document.createElement('div');
  if (cls) span.className = cls;
  span.textContent = line;
  el.insertBefore(span, el.firstChild);
}
function logDiagnosticHeader() {
  const nav = (typeof navigator !== 'undefined') ? navigator : {};
  log('=== vr-unlock diagnostic ===');
  log('build: ' + BUILD);
  log('time: ' + new Date().toISOString());
  log('userAgent: ' + (nav.userAgent || '(unknown)'));
  log('platform: ' + (nav.platform || '(unknown)'));
  log('webBluetooth: ' + (nav.bluetooth ? 'yes' : 'no'));
  log('frame self-test (limit off = 55 AA 04 06 03 72 00 00 80 FF): ' + (FRAME_OK ? 'OK' : 'FAILED'), FRAME_OK ? 'log-ok' : 'log-err');
  log('============================');
}
async function copyLog() {
  const text = logLines.join('\n');
  let ok = false;
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
  if (!ok) ok = copyLogFallback(text);
  log(ok ? 'log copied (' + logLines.length + ' lines)' : 'log copy failed, please select the log text manually', ok ? 'log-ok' : 'log-err');
}
function copyLogFallback(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.className = 'copy-offscreen';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}

// Help "?" icons: each card can show its explanation in a modal.
const HELP = { tempo: ['tempoTitle', 'tempoHelp'], settings: ['settingsTitle', 'settingsHelp'], read: ['readTitle', 'readHelp'], fine: ['fineTitle', 'fineHelp'], free: ['freeTitle', 'freeHelp'], disclaimer: ['footDisclaimer', 'disclaimerText'] };
function openHelp(key) {
  const m = HELP[key]; if (!m) return;
  const dlg = $('help'); if (!dlg) return;
  const ti = $('help-title'); if (ti) ti.textContent = t(m[0]);
  const bo = $('help-body'); if (bo) bo.textContent = t(m[1]);
  if (dlg.showModal) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
}
function closeHelp() { const dlg = $('help'); if (!dlg) return; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
// Open the help dialog with arbitrary title/body (used by the per-setting "?" icons).
function openHelpText(title, body) {
  const dlg = $('help'); if (!dlg) return;
  const ti = $('help-title'); if (ti) ti.textContent = title;
  const bo = $('help-body'); if (bo) bo.textContent = body;
  if (dlg.showModal) { try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } } else dlg.setAttribute('open', '');
}

function clearLog() {
  logLines.length = 0;
  const el = $('log'); if (el) el.textContent = '';
  logDiagnosticHeader();
  log('log cleared');
}
function setTile(id, val) { const el = $(id); if (el) el.textContent = (val == null ? '-' : val); }
function resetTiles() { ['t-speed', 't-batt', 't-limit', 't-mode', 't-throttle', 't-fw'].forEach(id => setTile(id, null)); const inf = $('tempo-info'); if (inf) inf.textContent = ''; }
function refreshTiles() {
  setTile('t-speed', reg[0x22] != null ? (reg[0x22] * 0.21944).toFixed(0) + ' km/h' : null);
  setTile('t-batt', reg[0x26]);
  setTile('t-limit', reg[0x1e] != null ? reg[0x1e] + ' km/h' : null);
  setTile('t-mode', reg[0x7e]);
  setTile('t-throttle', reg[0x72] != null ? t(reg[0x72] ? 'valOn' : 'valOff') : null);
  setTile('t-fw', reg[0x4e]);
  updateTempoInfo();
}
function statusLabel(s) {
  const map = { disconnected: 'stDisconnected', connecting: 'stConnecting', linking: 'stLinking', connected: 'stConnected', 'no-service': 'stNoService', 'no-char': 'stNoChar' };
  return t(map[s] || 'stDisconnected') || s;
}
function setStatus(s) {
  const el = $('status'); if (el) { el.dataset.state = s; el.textContent = statusLabel(s); }
  const cb = $('btn-conn');
  if (cb) {
    const on = (s === 'connecting' || s === 'linking' || s === 'connected');
    cb.textContent = on ? t('btnDisconnect') : t('btnConnect');
    cb.dataset.act = on ? 'disconnect' : 'connect';
  }
}
function setControlsEnabled(on) {
  ['open-in', 'stock-in', 'btn-toggle', 'btn-read', 'btn-read-caps', 'btn-max', 'btn-gear', 'btn-cmd', 'btn-raw']
    .forEach(id => { const el = $(id); if (el) el.disabled = !on; });
  document.querySelectorAll('.setbtn, .setinput').forEach(el => { el.disabled = !on; });
  updateToggleButton();
}
function updateToggleButton() {
  const b = $('btn-toggle'); if (!b) return;
  b.textContent = speedUnlocked ? t('btnLock') : t('btnUnlock');
}

// --------------------------- command acknowledgements ---------------------------

const ACK_TIMEOUT_MS = 3000;
const pendingAcks = new Map();
function armAck(key, label) {
  const prev = pendingAcks.get(key);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pendingAcks.delete(key);
    log('  no confirmation for "' + label + '" within ' + (ACK_TIMEOUT_MS / 1000) + 's (scooter sent no matching echo).', 'log-err');
  }, ACK_TIMEOUT_MS);
  pendingAcks.set(key, { label, timer });
}
function resolveAck(key, echoHex) {
  const p = pendingAcks.get(key);
  if (!p) return false;
  clearTimeout(p.timer);
  pendingAcks.delete(key);
  log('  confirmed: scooter acknowledged "' + p.label + '" (echo ' + echoHex + ').', 'log-ok');
  return true;
}
function clearAcks() { pendingAcks.forEach(p => clearTimeout(p.timer)); pendingAcks.clear(); }

// --------------------------- transmit + commands ---------------------------

async function writeFrame(bytes) {
  const wc = writeChar;
  if (!wc) throw new Error('not connected');
  if (wc.writeValueWithoutResponse) return wc.writeValueWithoutResponse(bytes);
  if (wc.writeValueWithResponse) return wc.writeValueWithResponse(bytes);
  return wc.writeValue(bytes);
}
async function transmit(bytes, label, ackKey) {
  if (!connected || !writeChar) { log('not connected', 'log-err'); return; }
  try {
    log('TX  ' + bytesToHex(bytes) + '   (' + label + ')', 'log-tx');
    if (ackKey) armAck(ackKey, label);
    await writeFrame(bytes);
    log('sent.', 'log-ok');
  } catch (e) { log('send failed: ' + e, 'log-err'); }
}
function parseHexAddr(s) { return parseInt(String(s).replace(/^0x/i, ''), 16) & 0xff; }

function cmdRead(addr) { transmit(frameRead(addr, 1), 'read 0x' + addr.toString(16), 'reg:' + addr); }
async function cmdReadCaps() { for (let a = 0xc2; a <= 0xc7; a++) { await transmit(frameRead(a, 1), 'read 0x' + a.toString(16), 'reg:' + a); await new Promise(r => setTimeout(r, 120)); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- plain-language speed: two values (open / throttled) and one Unlock/Lock toggle ---
function clampKmh(v, def) { v = parseInt(v, 10); if (isNaN(v)) v = def; return Math.max(6, Math.min(60, v)); }
function openVal() { return clampKmh(($('open-in') || {}).value, 25); }
function stockVal() { return clampKmh(($('stock-in') || {}).value, 20); }
// The app writes the per-mode limit-speed register (onTouchLimitSpeed1): drive mode 0x7e -> register
// 0 -> 0xf0, 1 -> 0xef, else -> 0xf1, sent via the HB frame (cmd 0x20). belegt.
function speedRegForMode() {
  const mode = reg[0x7e];
  if (mode === 0) return 0xf0;
  if (mode === 1) return 0xef;
  return 0xf1;
}
async function applySpeed(kmh, throttleOn) {
  // 1) speed limit on/off, register 0x72 (like onClickLimit; the common variant uses cmd 0x0A)
  await transmit(frameWriteCmd2(0x72, throttleOn ? 1 : 0), 'limit ' + (throttleOn ? 'on' : 'off') + ' (reg 0x72, cmd 0x0A)', 'reg:' + 0x72);
  if (!connected) return;
  await sleep(80);
  // 2) the km/h value to the per-mode limit-speed register, exactly like the app (HB frame, cmd 0x20)
  const r = speedRegForMode();
  await transmit(frameWriteHB(r, kmh), 'speed ' + kmh + ' km/h (reg 0x' + r.toString(16) + ', cmd 0x20)', 'reg:' + r);
}
async function doToggle() {
  if (speedUnlocked) { log('lock -> ' + stockVal() + ' km/h', 'log-ok'); await applySpeed(stockVal(), true); speedUnlocked = false; }
  else { log('unlock -> ' + openVal() + ' km/h', 'log-ok'); await applySpeed(openVal(), false); speedUnlocked = true; }
  updateToggleButton();
}

// --- shortcut deep-link (?do=fast / ?do=slow) ---
let pendingDeepAction = null;
function parseDeepLink() {
  try {
    let a = (new URLSearchParams(location.search).get('do') || '').toLowerCase();
    if (!a && location.hash) a = (new URLSearchParams(location.hash.replace(/^#/, '')).get('do') || '').toLowerCase();
    if (a === 'slow' || a === 'fast') { pendingDeepAction = a; log('shortcut: ' + a + ' requested'); }
  } catch (e) {}
}
function maybeRunDeepAction() {
  if (!pendingDeepAction || !connected) return;
  const a = pendingDeepAction; pendingDeepAction = null;
  if (a === 'fast') { log('shortcut: unlock -> ' + openVal() + ' km/h'); applySpeed(openVal(), false); speedUnlocked = true; }
  else { log('shortcut: lock -> ' + stockVal() + ' km/h'); applySpeed(stockVal(), true); speedUnlocked = false; }
  updateToggleButton();
}
async function tryAutoReconnect() {
  if (!navigator.bluetooth || !navigator.bluetooth.getDevices) return;
  try {
    const devs = await navigator.bluetooth.getDevices();
    if (!devs || !devs.length) return;
    const savedId = localStorage.getItem(LS_DEVICE);
    let dev = (savedId && devs.find(d => d.id === savedId)) || devs.find(d => (d.name || '').startsWith('M0')) || null;
    if (!dev) return;
    log('auto-reconnect: ' + (dev.name || dev.id));
    await connectGatt(dev);
  } catch (e) { log('auto-reconnect skipped: ' + e); }
}

// --- automatic read-out on connect: the user does not press "read", the app does it and builds on it ---
async function autoReadConfig() {
  const info = $('tempo-info'); if (info) info.textContent = t('tempoReading');
  const addrs = [0x7e, 0x82, 0x72, 0x7d, 0x22, 0x26, 0x4e, 0x1d, 0x1e, 0x15, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7];
  log('reading the scooter configuration (' + addrs.length + ' registers) ...');
  for (const a of addrs) { if (!connected) return; await transmit(frameRead(a, 1), 'auto-read 0x' + a.toString(16)); await sleep(90); }
  setTimeout(() => { updateTempoInfo(); renderSettings(); }, 1500);
  maybeRunDeepAction();
}
function controllerMax() {
  const vals = [reg[0xc2], reg[0xc4], reg[0xc6]].filter(v => typeof v === 'number' && v > 0 && v < 200);
  return vals.length ? Math.max(...vals) : null;
}
function updateTempoInfo() {
  const info = $('tempo-info'); if (!info) return;
  if (!connected) { info.textContent = ''; return; }
  const mx = controllerMax();
  if (mx) {
    info.textContent = t('tempoAllows').replace('%s', mx);
    const w = $('open-in'); if (w) { w.max = String(Math.max(mx, 60)); if (!w.dataset.touched) w.value = String(mx); }
  } else if (info.textContent !== t('tempoReading')) {
    info.textContent = t('tempoUnknown');
  }
}
function cmdMaxSpeed(val) { transmit(frameWriteCmd2(0x7d, val & 0xffff), 'max speed ' + val + ' (reg 0x7d, cmd 0x0A)', 'reg:' + 0x7d); }
function cmdGear(addr, val) { transmit(frameWriteHB(addr, val & 0xffff), 'limit speed ' + val + ' (reg 0x' + addr.toString(16) + ', cmd 0x20)', 'reg:' + addr); }
function cmdFree(addr, val) { transmit(frameWriteCmd(addr, val & 0xffff), 'SendWriteCmd(0x' + addr.toString(16) + ', ' + val + ', cmd 0x06)', 'reg:' + addr); }
function cmdRaw(hexStr) {
  const bytes = hexToBytes(hexStr);
  if (!bytes.length) { log('raw frame is empty.', 'log-err'); return; }
  transmit(new Uint8Array(bytes), 'raw frame');
}

// --------------------------- data-driven settings (belegt: all onClick/onTouch handlers) ---------------------------
// Each row replicates one app handler: register + frame type + value. frame: 'cmd' 0x06, 'cmd2' 0x0A,
// 'hb' 0x20. kind: 'lockpair' two buttons, 'toggle' on/off full value, 'bit' read-modify-write one bit,
// 'value' number + write.
const FRAME_FN = { cmd: frameWriteCmd, cmd2: frameWriteCmd2, hb: frameWriteHB };
const SETTINGS = [
  { grp: { de: 'Sicherheit', en: 'Security' }, kind: 'lockpair', de: 'Wegfahrsperre (Diebstahlschutz)', en: 'Immobilizer (anti-theft)', unlock: 0x70, lock: 0x71, frame: 'cmd',
    hde: 'Der Diebstahlschutz. Sperren blockiert das Anfahren, Entsperren gibt den Scooter wieder frei. Das hat nichts mit dem Tempo zu tun.', hen: 'The anti-theft lock. Lock blocks moving off, Unlock releases the scooter again. This has nothing to do with speed.' },
  { grp: { de: 'Sicherheit', en: 'Security' }, kind: 'toggle', de: 'Elektronische Sperre', en: 'Electronic lock', reg: 0xf6, frame: 'hb',
    hde: 'Eine zusätzliche elektronische Sperre, die manche Modelle haben. An blockiert, Aus gibt frei.', hen: 'An extra electronic lock some models have. On blocks, Off releases.' },
  { grp: { de: 'Fahren', en: 'Riding' }, kind: 'bit', de: 'Nullstart', en: 'Zero-start', base: 0x7d, mask: 0x0001, frame: 'hb',
    hde: 'An: der Motor zieht erst ab Schritttempo an, du musst kurz anschieben (gesetzlich vorgeschrieben). Aus: der Motor zieht aus dem Stand an.', hen: 'On: the motor only engages above walking pace, you have to kick off first (legally required). Off: the motor pulls from standstill.' },
  { grp: { de: 'Fahren', en: 'Riding' }, kind: 'value', de: 'Motortyp', en: 'Motor type', reg: 0x6e, frame: 'cmd2',
    hde: 'Interner Motortyp-Index. Nur ändern, wenn du genau weißt, welchen Motor dein Scooter hat. Ein falscher Wert kann die Fahrt stören.', hen: 'Internal motor-type index. Only change it if you know exactly which motor your scooter has. A wrong value can disturb the ride.' },
  { grp: { de: 'Fahren', en: 'Riding' }, kind: 'value', de: 'Akkukapazität', en: 'Battery capacity', reg: 0x21, frame: 'hb',
    hde: 'Die im Scooter hinterlegte Akkugröße. Sie beeinflusst die Reichweiten- und Prozentanzeige, nicht die echte Kapazität des Akkus.', hen: 'The battery size stored in the scooter. It affects the range and percentage display, not the real capacity of the battery.' },
  { grp: { de: 'Licht und Warnungen', en: 'Light and warnings' }, kind: 'toggle', de: 'Scheinwerfer', en: 'Headlight', reg: 0xf2, frame: 'hb',
    hde: 'Das Frontlicht an- oder ausschalten.', hen: 'Turn the front light on or off.' },
  { grp: { de: 'Licht und Warnungen', en: 'Light and warnings' }, kind: 'bit', de: 'Nabenlicht', en: 'Hub light', base: 0xd3, mask: 0x20, frame: 'cmd2',
    hde: 'Das Zusatzlicht an der Nabe oder am Trittbrett an- oder ausschalten.', hen: 'Turn the extra light at the hub or deck on or off.' },
  { grp: { de: 'Licht und Warnungen', en: 'Light and warnings' }, kind: 'bit', de: 'Rückwärts-zu-schnell-Warnung', en: 'Reverse-too-fast warning', base: 0xd3, mask: 0x10, frame: 'cmd2',
    hde: 'Warnt, wenn der Scooter zu schnell rückwärts rollt. An schaltet die Warnung ein.', hen: 'Warns when the scooter rolls backwards too fast. On enables the warning.' },
  { grp: { de: 'Licht und Warnungen', en: 'Light and warnings' }, kind: 'bit', de: 'Sperr-Warnung', en: 'Lock warning', base: 0xd3, mask: 0x08, frame: 'cmd2',
    hde: 'Gibt eine Warnung aus, wenn jemand den gesperrten Scooter bewegt.', hen: 'Gives a warning when someone moves the locked scooter.' },
  { grp: { de: 'Licht und Warnungen', en: 'Light and warnings' }, kind: 'bit', de: 'Sperre schaltet ab', en: 'Lock shut-down', base: 0xd3, mask: 0x04, frame: 'cmd2',
    hde: 'Wenn die Sperre aktiv ist, schaltet der Antrieb ganz ab statt nur zu bremsen.', hen: 'When the lock is active, the drive shuts down completely instead of only braking.' },
  { grp: { de: 'Feineinstellung Fahrgefühl', en: 'Ride feel' }, kind: 'value', de: 'Lenkempfindlichkeit (0 bis 100)', en: 'Steering sensitivity (0 to 100)', reg: 0xa1, frame: 'cmd2',
    hde: 'Wie stark der Scooter aufs Lenken beziehungsweise Gewichtsverlagern reagiert. Höher = giftiger und wendiger, niedriger = ruhiger und stabiler. Bereich 0 bis 100.', hen: 'How strongly the scooter reacts to steering or leaning. Higher = sharper and more agile, lower = calmer and more stable. Range 0 to 100.' },
  { grp: { de: 'Feineinstellung Fahrgefühl', en: 'Ride feel' }, kind: 'value', de: 'Gasannahme (0 bis 100)', en: 'Throttle response (0 to 100)', reg: 0xa2, frame: 'cmd2',
    hde: 'Wie direkt der Scooter aufs Gas reagiert. Höher = spontaner und ruppiger Antritt, niedriger = sanfter und weicher. Bereich 0 bis 100.', hen: 'How directly the scooter reacts to the throttle. Higher = snappier and rougher pull-away, lower = gentler and smoother. Range 0 to 100.' },
];
function sendSetting(reg, val, frame, label) { transmit(FRAME_FN[frame](reg, val & 0xffff), label, 'reg:' + reg); }
function settingLabel(s) { return (lang === 'en' ? s.en : s.de); }
// current on/off state of a setting from the last-read register, or null if unknown
function settingState(s) {
  if (s.kind === 'bit') return reg[s.base] != null ? !!(reg[s.base] & s.mask) : null;
  if (s.kind === 'toggle') return reg[s.reg] != null ? reg[s.reg] !== 0 : null;
  return null;
}
function makeSeg(labels, onClick, activeIdx) {
  const seg = document.createElement('div'); seg.className = 'seg';
  labels.forEach((txt, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'setbtn'; b.textContent = txt;
    b.disabled = !connected;
    if (i === activeIdx) b.classList.add('active');
    b.onclick = () => { onClick(i); if (activeIdx !== -1) { [...seg.children].forEach(c => c.classList.remove('active')); b.classList.add('active'); } };
    seg.appendChild(b);
  });
  return seg;
}
function renderSettings() {
  const box = $('settings-body'); if (!box) return;
  box.textContent = '';
  let lastGrp = null;
  SETTINGS.forEach(s => {
    const grp = lang === 'en' ? s.grp.en : s.grp.de;
    if (grp !== lastGrp) { const h = document.createElement('div'); h.className = 'set-grp'; h.textContent = grp; box.appendChild(h); lastGrp = grp; }
    const row = document.createElement('div'); row.className = 'srow';
    const lab = document.createElement('div'); lab.className = 'srow-label';
    const txt = document.createElement('span'); txt.textContent = settingLabel(s); lab.appendChild(txt);
    if (s.hde || s.hen) { const q = document.createElement('button'); q.type = 'button'; q.className = 'help-btn'; q.textContent = '?'; q.setAttribute('aria-label', 'Info'); q.onclick = () => openHelpText(settingLabel(s), lang === 'en' ? s.hen : s.hde); lab.appendChild(q); }
    row.appendChild(lab);
    if (s.kind === 'value') {
      const grp2 = document.createElement('div'); grp2.className = 'vgrp';
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.max = '65535'; inp.value = (reg[s.reg] != null ? reg[s.reg] : 0); inp.className = 'setinput'; inp.disabled = !connected;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'setbtn wbtn'; b.textContent = t('btnWrite'); b.disabled = !connected;
      b.onclick = () => sendSetting(s.reg, parseInt(inp.value, 10) || 0, s.frame, settingLabel(s) + ' = ' + inp.value + ' (reg 0x' + s.reg.toString(16) + ')');
      grp2.appendChild(inp); grp2.appendChild(b); row.appendChild(grp2);
    } else if (s.kind === 'lockpair') {
      row.appendChild(makeSeg([t('btnUnlock'), t('btnLock')], i => {
        if (i === 0) sendSetting(s.unlock, 1, s.frame, settingLabel(s) + ': unlock (reg 0x' + s.unlock.toString(16) + ')');
        else sendSetting(s.lock, 1, s.frame, settingLabel(s) + ': lock (reg 0x' + s.lock.toString(16) + ')');
      }, -1));
    } else {   // toggle or bit -> An/Aus segmented, active side reflects the read state
      const st = settingState(s);
      const active = st === true ? 0 : st === false ? 1 : -1;
      row.appendChild(makeSeg([t('valOn'), t('valOff')], i => {
        const state = (i === 0);
        if (s.kind === 'bit') { const cur = reg[s.base] || 0; const v = state ? (cur | s.mask) : (cur & ~s.mask & 0xffff); reg[s.base] = v; sendSetting(s.base, v, s.frame, settingLabel(s) + ' ' + (state ? 'on' : 'off') + ' (reg 0x' + s.base.toString(16) + ' bit)'); }
        else { reg[s.reg] = state ? 1 : 0; sendSetting(s.reg, state ? 1 : 0, s.frame, settingLabel(s) + ' ' + (state ? 'on' : 'off') + ' (reg 0x' + s.reg.toString(16) + ')'); }
      }, active));
    }
    box.appendChild(row);
  });
}

// --------------------------- inbound frames (belegt: Bluetooth::ParseFrame 0x55b9a8) ---------------------------

function handleFrame(b) {
  if (!b || b.length < 8) return;
  if (b[0] !== 0x55 || b[1] !== 0xAA) { log('  note: frame does not start with 55 AA; not decoding (raw hex above).'); return; }
  const lenByte = b[2];
  const frameLen = lenByte + 6;   // combiningFrame: payload(byte2) + 6 for the 55 AA path
  const cmd = b[3], type = b[4], addr = b[5];
  let sum = 0; for (let i = 2; i < frameLen - 2 && i < b.length - 2; i++) sum = (sum + b[i]) & 0xffff;
  const cks = (~sum) & 0xffff;
  const rxCks = b[frameLen - 2] | (b[frameLen - 1] << 8);
  const chkOk = (cks === rxCks);
  log('  frame: cmd=' + cmd + ' type=' + type + ' addr=0x' + addr.toString(16) + ' checksum ' + (chkOk ? 'ok' : 'MISMATCH'));
  resolveAck('reg:' + addr, bytesToHex(b));
  if (cmd === 6) {
    let r = addr, hit = [];
    for (let i = 6; i + 1 < frameLen - 1; i += 2) { const v = b[i] | (b[i + 1] << 8); reg[r] = v; hit.push('0x' + r.toString(16) + '=' + v); r++; }
    if (hit.length) log('  registers: ' + hit.join(', '), 'log-ok');
    refreshTiles();
  }
}

// --------------------------- connect / disconnect ---------------------------

function charProps(c) { const p = c.properties || {}; return ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter(k => p[k]).join(',') || '-'; }

async function pickAndConnect() {
  if (!navigator.bluetooth) { log('Web Bluetooth not available. Use Bluefy (iOS) or Chrome/Edge.', 'log-err'); return; }
  try {
    // The Viron models do not share one known advertised name, so the chooser shows all devices
    // (like the manufacturer app, which scans unfiltered). The service is resolved after connecting.
    log('opening the device chooser (all Bluetooth devices; pick your scooter, usually named ' + SCAN_PREFIX + ') ...');
    device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ALL_SERVICES });
    log('selected: ' + (device.name || '(no name)') + ' [' + device.id + ']');
    await connectGatt(device);
  } catch (e) { log('scan/connect cancelled: ' + e, 'log-err'); }
}

async function scanAllDevicesDiagnostic() {
  if (!navigator.bluetooth) { log('Web Bluetooth not available. Use Bluefy (iOS) or Chrome (Android/desktop).', 'log-err'); return; }
  let dev = null;
  try {
    log('DIAG: showing ALL Bluetooth devices. Pick your scooter, even if the name looks wrong or missing.', 'log-ok');
    dev = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ALL_SERVICES });
  } catch (e) { log('DIAG cancelled: ' + e, 'log-err'); return; }
  log('DIAG selected: name="' + (dev.name || '(no name)') + '"  id=' + dev.id);
  try {
    log('DIAG: connecting to read the GATT services ...');
    const srv = await dev.gatt.connect();
    let svcs = [];
    try { svcs = await srv.getPrimaryServices(); } catch (e) { log('DIAG getPrimaryServices error: ' + e, 'log-err'); }
    if (!svcs || !svcs.length) { log('DIAG: none of the known services is present (Nordic 6E40.., AE00, FFE0, FFF0).', 'log-err'); }
    else for (const s of svcs) {
      log('DIAG service ' + s.uuid, 'log-ok');
      try { const chs = await s.getCharacteristics(); for (const c of chs) log('DIAG   char ' + c.uuid + '  [' + charProps(c) + ']'); }
      catch (e) { log('DIAG   (characteristics unreadable: ' + e + ')'); }
    }
    try { dev.gatt.disconnect(); } catch (e) {}
    log('DIAG done. Copy the log and send it. For the full picture use nRF Connect on Android.', 'log-ok');
  } catch (e) { log('DIAG connect failed: ' + e, 'log-err'); }
}

async function resolveService(srv) {
  for (const key of TRANSPORT_ORDER) {
    const cand = TRANSPORTS[key];
    const svc = await srv.getPrimaryService(cand.service).catch(() => null);
    if (!svc) continue;
    const wc = await svc.getCharacteristic(cand.write).catch(() => null);
    const nc = await svc.getCharacteristic(cand.notify).catch(() => null);
    if (wc && nc) { usedTransport = cand; writeChar = wc; notifyChar = nc; return svc; }
  }
  return null;
}

async function connectGatt(dev) {
  if (connecting) { log('connect already in progress'); return; }
  connecting = true;
  try {
    if (device && device !== dev) { try { device.removeEventListener('gattserverdisconnected', onDisconnected); } catch (e) {} }
    device = dev;
    device.removeEventListener('gattserverdisconnected', onDisconnected);
    device.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus('connecting');
    connected = false;
    server = await device.gatt.connect();
    const svc = await resolveService(server);
    if (!svc) { try { device.gatt.disconnect(); } catch (e) {} setStatus('no-service'); log('no known service found (Nordic UART / AE00 / FFE0 / FFF0).', 'log-err'); return; }
    await notifyChar.startNotifications();
    notifyChar.removeEventListener('characteristicvaluechanged', onCharacteristicValue);
    notifyChar.addEventListener('characteristicvaluechanged', onCharacteristicValue);
    connected = true;
    setStatus('connected');
    setControlsEnabled(true);
    const info = $('devinfo');
    if (info) info.textContent = t('devPrefix') + ' ' + (device.name || '(no name)') + '  -  ' + usedTransport.name + ', notify active.';
    try { if (device.id) localStorage.setItem(LS_DEVICE, device.id); } catch (e) {}
    log('connected: ' + (device.name || '(no name)') + ' [' + device.id + ']', 'log-ok');
    log('transport ' + usedTransport.name + '  service ' + usedTransport.service, 'log-ok');
    log('char  write=' + writeChar.uuid + '  notify=' + notifyChar.uuid, 'log-ok');
    autoReadConfig();
  } catch (e) {
    setStatus('disconnected');
    log('connect failed: ' + e, 'log-err');
  } finally { connecting = false; }
}

function onDisconnected(ev) {
  if (ev && ev.target && ev.target !== device) return;
  connected = false;
  speedUnlocked = false;
  clearAcks();
  setStatus('disconnected');
  setControlsEnabled(false);
  resetTiles();
  const info = $('devinfo'); if (info) info.textContent = '';
  log('disconnected.', 'log-err');
}
function disconnectBle() {
  const d = device;
  if (d) { try { d.removeEventListener('gattserverdisconnected', onDisconnected); } catch (e) {} }
  try { if (d && d.gatt && d.gatt.connected) d.gatt.disconnect(); } catch (e) {}
  device = null; server = null; writeChar = null; notifyChar = null;
  connected = false;
  speedUnlocked = false;
  clearAcks();
  setStatus('disconnected');
  setControlsEnabled(false);
  resetTiles();
  const info = $('devinfo'); if (info) info.textContent = '';
}
function onCharacteristicValue(ev) {
  try {
    const b = new Uint8Array(ev.target.value.buffer);
    log('RX  ' + bytesToHex(b), 'log-rx');
    handleFrame(b);
  } catch (e) { log('RX parse error: ' + e, 'log-err'); }
}

// --------------------------- language ---------------------------

let lang = 'de';
function table() { return (window.I18N && window.I18N[lang]) || {}; }
function t(key) { const v = table()[key]; return (typeof v === 'string') ? v : ''; }

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(n => {
    const v = t(n.getAttribute('data-t'));
    if (/[<&]/.test(v)) n.innerHTML = v; else n.textContent = v;   // scan-ok: our own translation table
  });
  { const el = $('link-guide'); if (el) el.href = docFile('GUIDE'); }
  { const el = $('link-readme'); if (el) el.href = docFile('README'); }
  { const el = $('link-license'); if (el) el.href = docFile('LICENSE'); }
  { const el = $('link-privacy'); if (el) el.href = docFile('PRIVACY'); }
  { const el = $('link-trademarks'); if (el) el.href = docFile('TRADEMARKS'); }
  { const el = $('langs'); if (el) el.setAttribute('aria-label', t('langGroup')); }
  { const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    const el = $('btn-theme');
    if (el) { el.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); el.title = el.getAttribute('aria-label'); } }
  { const el = $('build-ver'); if (el) el.textContent = t('buildLabel') + ' ' + BUILD; }
  document.querySelectorAll('#langs button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
  { const el = $('status'); setStatus(el ? el.dataset.state : 'disconnected'); }
  updateToggleButton();
  renderSettings();
}
function initLangSwitch() {
  document.querySelectorAll('#langs button').forEach(b => {
    b.addEventListener('click', () => { lang = b.dataset.lang; applyLang(); });
  });
}

// --------------------------- theme ---------------------------

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const b = $('btn-theme');
  if (b) {
    b.innerHTML = dark ? '&#9728;' : '&#9790;';   // scan-ok: a fixed character, not user input
    b.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark'));
    b.title = b.getAttribute('aria-label');
  }
  try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch (e) {}
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(LS_THEME); } catch (e) {}
  applyTheme(saved !== 'light');
  const b = $('btn-theme');
  if (b) b.addEventListener('click', () => { applyTheme(document.documentElement.getAttribute('data-theme') === 'light'); });
}

// --------------------------- document viewer ---------------------------

const DOC_TITLES = {
  'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide',
  'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy',
  'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense',
  'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks',
  'README.md': 'footReadme',
};
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().trim().replace(/[^\w\sÀ-ɏ-]/g, '').replace(/ /g, '-');

function mdToHtml(src) {
  const inline = s => escHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, text, href) => {
      if (DOC_TITLES[href]) return `<a href="${href}" data-docfile="${href}">${text}</a>`;
      if (href.startsWith('#')) return `<a href="${href}" data-anchor="${href.slice(1)}">${text}</a>`;
      return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    });
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let listKind = null, li = null, para = [], inFence = false;
  const sink = () => (li ? li.parts : out);
  const flushPara = () => { if (para.length) { sink().push('<p>' + inline(para.join(' ')) + '</p>'); para = []; } };
  const closeNested = () => { if (li && li.nested) { li.parts.push('</ul>'); li.nested = false; } };
  const closeLi = () => { if (!li) return; flushPara(); closeNested(); out.push('<li>' + li.parts.join('\n') + '</li>'); li = null; };
  const closeList = () => { closeLi(); if (listKind) { out.push('</' + listKind + '>'); listKind = null; } };
  const block = () => { flushPara(); closeList(); };
  const openList = kind => { flushPara(); if (listKind !== kind) { closeList(); out.push('<' + kind + '>'); listKind = kind; } else closeLi(); };
  const cells = l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const body = l.trim();
    const indented = /^ {2,}\S/.test(l);
    if (inFence) { if (body.startsWith('```')) { sink().push('</code></pre>'); inFence = false; } else sink().push(escHtml(l)); continue; }
    if (body.startsWith('```')) { if (li) { flushPara(); closeNested(); } else block(); sink().push('<pre><code>'); inFence = true; continue; }
    if (body === '') { if (li && /^ {2,}\S/.test(lines[i + 1] || '')) flushPara(); else block(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(body)) { block(); out.push('<hr>'); continue; }
    if (body.startsWith('|') && /^\|[\s:|-]+\|?\s*$/.test((lines[i + 1] || '').trim())) {
      if (li) { flushPara(); closeNested(); } else block();
      sink().push('<div class="doc-table"><table><thead><tr>' + cells(body).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>');
      i++;
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        sink().push('<tr>' + cells(lines[++i].trim()).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>');
      }
      sink().push('</tbody></table></div>');
      continue;
    }
    let m;
    if ((m = body.match(/^(#{1,4})\s+(.*)$/))) { block(); const n = m[1].length; out.push(`<h${n} id="${slug(m[2])}">${inline(m[2])}</h${n}>`); continue; }
    if ((m = body.match(/^>\s?(.*)$/))) { if (li) { flushPara(); closeNested(); } else block(); sink().push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
    if (indented && li && (m = body.match(/^[-*]\s+(.*)$/))) { flushPara(); if (!li.nested) { li.parts.push('<ul class="nested">'); li.nested = true; } li.parts.push('<li>' + inline(m[1]) + '</li>'); continue; }
    if ((m = body.match(/^[-*]\s+(.*)$/)) && !indented) { openList('ul'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if ((m = body.match(/^\d+\.\s+(.*)$/)) && !indented) { openList('ol'); li = { parts: [inline(m[1])], nested: false }; continue; }
    if (li && !indented) closeList();
    if (li) closeNested();
    para.push(body);
  }
  if (inFence) sink().push('</code></pre>');
  block();
  return out.join('\n').replace(/<pre><code>\n/g, '<pre><code>');
}

const docCache = {};
const docFile = name => {
  if (name === 'GUIDE') return `GUIDE.${lang}.md`;
  if (name === 'README') return 'README.md';
  return lang === 'de' ? `${name}.de.md` : `${name}.md`;
};
function openDoc(name, anchor, titleKey) { openDocFile(docFile(name), anchor, titleKey); }
function openDocFile(file, anchor, titleKey) {
  const dlg = $('doc'), body = $('doc-body');
  if (!dlg || !body) return;
  const mark = (lang === 'de' && !file.includes('.de.') && file !== 'README.md') ? ' ' + t('docEnglish') : '';
  $('doc-title').textContent = (t(titleKey || DOC_TITLES[file] || '') || file) + mark;
  if (typeof dlg.showModal === 'function') dlg.showModal();
  const show = html => {
    body.innerHTML = html;   // scan-ok: markdown of our own documents, rendered by mdToHtml which escapes first
    const h1 = body.querySelector('h1');
    if (h1) { $('doc-title').textContent = h1.textContent.trim() + mark; h1.remove(); }
    body.scrollTop = 0;
    if (!anchor) return;
    const target = body.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(anchor) : anchor));
    if (target) body.scrollTop = target.offsetTop - body.offsetTop;
  };
  if (docCache[file]) { show(docCache[file]); return; }
  body.innerHTML = '<p>' + escHtml(t('docLoading')) + '</p>';   // scan-ok: escaped
  fetch(file + '?v=' + BUILD)
    .then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.text(); })
    .then(txt => { docCache[file] = mdToHtml(txt); show(docCache[file]); })
    .catch(e => { body.innerHTML = '<p>' + escHtml(t('docFail')) + '</p><pre class="err">' + escHtml(file + ': ' + (e && e.message ? e.message : e)) + '</pre>'; });   // scan-ok: escaped
}
function wireDocViewer() {
  document.addEventListener('click', e => {
    if (!e.target.closest) return;
    const jump = e.target.closest('[data-anchor]');
    if (jump) {
      e.preventDefault();
      const body = $('doc-body');
      const target = body && body.querySelector('#' + CSS.escape(jump.getAttribute('data-anchor')));
      if (target) body.scrollTop = target.offsetTop - body.offsetTop;
      return;
    }
    const disc = e.target.closest('[data-open-disclaimer]');
    if (disc) { e.preventDefault(); openHelp('disclaimer'); return; }
    const a = e.target.closest('[data-doc], [data-docfile]');
    if (!a) return;
    e.preventDefault();
    const anchor = a.getAttribute('data-doc-anchor') || '';
    const file = a.getAttribute('data-docfile');
    const titleKey = a.getAttribute('data-t') || '';
    if (file) openDocFile(file, anchor, titleKey); else openDoc(a.getAttribute('data-doc'), anchor, titleKey);
  });
  ['doc-x', 'doc-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => { const d = $('doc'); if (d) d.close(); }); });
}

// --------------------------- init ---------------------------

window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.help-btn').forEach(btn => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', e => { e.preventDefault(); openHelp('disclaimer'); }); }
  logDiagnosticHeader();
  initLangSwitch();
  initTheme();
  wireDocViewer();
  applyLang();
  setStatus('disconnected');

  $('btn-conn').addEventListener('click', () => { if ($('btn-conn').dataset.act === 'disconnect') disconnectBle(); else pickAndConnect(); });
  $('btn-toggle').addEventListener('click', doToggle);
  { try { const o = localStorage.getItem(LS_OPEN); if (o && $('open-in')) $('open-in').value = o; } catch (e) {} }
  { try { const s = localStorage.getItem(LS_STOCK); if (s && $('stock-in')) $('stock-in').value = s; } catch (e) {} }
  { const o = $('open-in'); if (o) o.addEventListener('input', () => { o.dataset.touched = '1'; try { localStorage.setItem(LS_OPEN, o.value); } catch (e) {} }); }
  { const s = $('stock-in'); if (s) s.addEventListener('input', () => { try { localStorage.setItem(LS_STOCK, s.value); } catch (e) {} }); }
  $('btn-read').addEventListener('click', () => cmdRead(parseHexAddr($('read-addr').value)));
  $('btn-read-caps').addEventListener('click', cmdReadCaps);
  $('btn-max').addEventListener('click', () => cmdMaxSpeed(parseInt($('max-in').value, 10) || 0));
  $('btn-gear').addEventListener('click', () => cmdGear(parseHexAddr($('gear-reg').value), parseInt($('gear-val').value, 10) || 0));
  $('btn-cmd').addEventListener('click', () => cmdFree(parseHexAddr($('cmd-addr').value), parseInt($('cmd-val').value, 10) || 0));
  $('btn-raw').addEventListener('click', () => cmdRaw($('raw-hex').value));
  { const b = $('btn-copy-log'); if (b) b.addEventListener('click', copyLog); }
  { const b = $('btn-diag'); if (b) b.addEventListener('click', scanAllDevicesDiagnostic); }
  { const b = $('btn-clear-log'); if (b) b.addEventListener('click', clearLog); }

  setControlsEnabled(false);
  if (!navigator.bluetooth) log('Web Bluetooth not available. On iOS use the Bluefy browser.', 'log-err');
  parseDeepLink();
  if (pendingDeepAction) tryAutoReconnect();
});
