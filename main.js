// Smallest Pixel Pet — main process
// Owns the transparent overlay window and the Smallest Pulse STT WebSocket.
// The API key stays here (Node side); the renderer only ships raw PCM over IPC.

const {
  app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage,
  systemPreferences, session, globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// ---------- config ----------
function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const API_KEY = process.env.SMALLEST_API_KEY;
const LANGUAGE = process.env.PET_LANGUAGE || 'en';
const STT_URL = 'wss://api.smallest.ai/waves/v1/stt/live';
const WINDOW_HEIGHT = 420;

let win = null;
let tray = null;
let ws = null;
let muted = false;
let showHud = true;
let reconnectTimer = null;
let backoff = 1000;
let lastStatus = { state: 'starting' };

// ---------- STT socket ----------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setStatus(s) {
  lastStatus = s;
  send('status', s);
  refreshTray();
}

function connect() {
  clearTimeout(reconnectTimer);
  if (!API_KEY || API_KEY === 'your_key_here') {
    setStatus({ state: 'error', msg: 'Add SMALLEST_API_KEY to .env' });
    return;
  }
  const url = new URL(STT_URL);
  url.searchParams.set('model', 'pulse');
  url.searchParams.set('language', LANGUAGE);
  url.searchParams.set('encoding', 'linear16');
  url.searchParams.set('sample_rate', '16000');

  setStatus({ state: 'connecting' });
  const sock = new WebSocket(url.toString(), {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  ws = sock;

  sock.on('open', () => {
    backoff = 1000;
    setStatus({ state: muted ? 'muted' : 'listening' });
  });

  sock.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString());
      send('transcript', msg);
    } catch (_) { /* ignore non-JSON */ }
  });

  sock.on('unexpected-response', (_req, res) => {
    const msg = res.statusCode === 401 || res.statusCode === 403
      ? 'API key rejected (check .env)'
      : `Server said ${res.statusCode}`;
    setStatus({ state: 'error', msg });
    sock.terminate();
  });

  sock.on('error', (err) => {
    if (lastStatus.state !== 'error') setStatus({ state: 'error', msg: err.message });
  });

  sock.on('close', () => {
    if (ws !== sock) return;
    ws = null;
    if (lastStatus.state !== 'error') setStatus({ state: 'reconnecting' });
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
}

// PCM from renderer: 16 kHz mono Int16 little-endian chunks.
ipcMain.on('audio', (_e, buf) => {
  if (muted || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(Buffer.from(buf));
});

// The window is click-through except when the mouse is over the cat.
ipcMain.on('mouse-ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.handle('cursor', () => {
  const p = screen.getCursorScreenPoint();
  const b = win.getBounds();
  return { x: p.x - b.x, y: p.y - b.y };
});

ipcMain.handle('get-status', () => ({ ...lastStatus, muted, showHud }));

// ---------- window ----------
function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    x: wa.x,
    y: wa.y + wa.height - WINDOW_HEIGHT,
    width: wa.width,
    height: WINDOW_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    send('status', lastStatus);
    send('settings', { muted, showHud });
  });
}

// ---------- tray ----------
function trayIcon() {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(__dirname, 'iconTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 });
}

function statusLabel() {
  if (muted) return 'Mic muted';
  switch (lastStatus.state) {
    case 'listening': return 'Listening · Smallest Pulse';
    case 'connecting': return 'Connecting to Smallest…';
    case 'reconnecting': return 'Reconnecting…';
    case 'error': return `Error: ${lastStatus.msg || 'unknown'}`;
    default: return 'Starting…';
  }
}

function toggleMute() {
  muted = !muted;
  send('settings', { muted, showHud });
  setStatus({ state: muted ? 'muted' : (ws && ws.readyState === WebSocket.OPEN ? 'listening' : lastStatus.state) });
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`Pixel Pet — ${statusLabel()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: statusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Mute microphone', type: 'checkbox', checked: muted, accelerator: 'CommandOrControl+Shift+M', click: toggleMute },
    {
      label: 'Show transcript HUD', type: 'checkbox', checked: showHud,
      click: () => { showHud = !showHud; send('settings', { muted, showHud }); refreshTray(); },
    },
    { label: 'Reconnect', click: () => { if (ws) ws.terminate(); else connect(); } },
    {
      label: 'Commands',
      submenu: [
        'sit', 'stand / up', 'run (left / right)', 'walk', 'stop / stay', 'jump',
        'lie down', 'sleep / wake up', 'come here', 'turn around', 'dance', 'meow',
        'good kitty',
      ].map((l) => ({ label: l, enabled: false })),
    },
    { type: 'separator' },
    { label: 'Quit Pixel Pet', role: 'quit' },
  ]));
}

// ---------- boot ----------
app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media');
  if (process.platform === 'darwin') {
    try { await systemPreferences.askForMediaAccess('microphone'); } catch (_) {}
  }

  createWindow();
  tray = new Tray(trayIcon());
  refreshTray();
  globalShortcut.register('CommandOrControl+Shift+M', toggleMute);
  connect();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (ws) {
    try { ws.send(JSON.stringify({ type: 'close_stream' })); } catch (_) {}
    ws.terminate();
  }
});

app.on('window-all-closed', () => app.quit());
