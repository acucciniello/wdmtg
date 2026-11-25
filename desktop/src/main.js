// The desktop app. Sits in the menu bar / tray, tracks quietly, and shows the
// dashboard in a window when you ask for it.
import { app, BrowserWindow, Menu, Tray, nativeImage, powerMonitor, shell, systemPreferences } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './core/store.js';
import { Engine } from './core/engine.js';
import { createServer } from './core/server.js';
import { makeSampler, windowStatus } from './core/collectors/activeWindow.js';
import { seedDemo } from './core/demo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isMac = process.platform === 'darwin';
const demo = process.argv.includes('--demo');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let engine = null;
let baseUrl = null;
let quitting = false;

const macAccess = () => {
  if (!isMac) return true;
  try {
    return systemPreferences.getMediaAccessStatus('screen') === 'granted' && systemPreferences.isTrustedAccessibilityClient(false);
  } catch {
    return false;
  }
};

const PANES = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  disk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
};

function showWindow(hash = '') {
  if (win && !win.isDestroyed()) {
    if (hash) win.loadURL(baseUrl + hash);
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 380,
    minHeight: 520,
    title: 'Where did my time go',
    backgroundColor: '#f3f5f7',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // The window only ever shows our own local page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(baseUrl)) e.preventDefault(); });
  win.on('close', (e) => {
    // Closing the window keeps tracking going. Quit from the tray menu.
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.loadURL(baseUrl + hash);
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(here, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Where did my time go');
  const menu = () =>
    Menu.buildFromTemplate([
      { label: 'Open dashboard', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Pause tracking',
        type: 'checkbox',
        checked: engine.paused,
        click: (item) => { engine.setPaused(item.checked); tray.setContextMenu(menu()); },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]);
  tray.setContextMenu(menu());
  tray.on('click', () => { if (!isMac) showWindow(); });
  return menu;
}

app.on('second-instance', () => { if (baseUrl) showWindow(); });
app.on('window-all-closed', () => { /* keep tracking in the background */ });
app.on('activate', () => { if (baseUrl) showWindow(); });
app.on('before-quit', () => { quitting = true; engine?.stop(); });

app.whenReady().then(async () => {
  const store = new Store(demo ? ':memory:' : path.join(app.getPath('userData'), 'wdmtg.db'));
  if (demo) seedDemo(store);
  const firstRun = !store.get('installed_at');

  engine = new Engine({
    store,
    demo,
    version: app.getVersion(),
    sample: demo ? null : makeSampler(macAccess),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    windowStatus,
  });
  engine.extraStatus = () => ({ autoLaunch: app.getLoginItemSettings().openAtLogin });

  // Locked screen or closed lid: stop the clock until you are back.
  let away = false;
  const leave = () => { away = true; engine.tracker?.stopTimer(); engine.interrupt(); };
  const back = () => { away = false; if (!engine.paused) engine.tracker?.start(1000); engine.sync(); };
  powerMonitor.on('lock-screen', leave);
  powerMonitor.on('suspend', leave);
  powerMonitor.on('unlock-screen', back);
  powerMonitor.on('resume', () => { if (powerMonitor.getSystemIdleState(1) !== 'locked') back(); });

  let refreshTray = () => {};
  const server = createServer({
    engine,
    uiDir: path.join(here, 'ui'),
    actions: {
      'open-settings': ({ pane }) => {
        if (pane === 'accessibility' && isMac) systemPreferences.isTrustedAccessibilityClient(true); // adds us to the list
        if (PANES[pane]) shell.openExternal(PANES[pane]);
      },
      'connect-calls': async () => ({ ok: await engine.connectCalls() }),
      autolaunch: ({ on }) => app.setLoginItemSettings({ openAtLogin: Boolean(on), openAsHidden: true, args: ['--hidden'] }),
      pause: ({ paused }) => {
        engine.setPaused(Boolean(paused));
        if (!paused && away) engine.tracker?.stopTimer();
        refreshTray();
      },
      sync: () => engine.sync(),
    },
  });
  const port = await server.listen();
  baseUrl = `http://127.0.0.1:${port}/`;
  engine.start();

  const menu = buildTray();
  refreshTray = () => tray.setContextMenu(menu());

  const login = app.getLoginItemSettings();
  const startedHidden = login.wasOpenedAtLogin || login.wasOpenedAsHidden || process.argv.includes('--hidden');
  if (!startedHidden) showWindow(firstRun && !demo ? '#setup' : '');
  if (process.env.WDMTG_SMOKE) {
    // Used by automated checks: prove the app boots, tracks and serves, then exit.
    setTimeout(async () => {
      const status = await (await fetch(baseUrl + 'api/status')).json();
      const day = await (await fetch(baseUrl + 'api/day')).json();
      console.log('SMOKE ' + JSON.stringify({ port, tracking: status.tracking, segments: store.count('mac'), headline: day.headline, electron: process.versions.electron, node: process.versions.node }));
      quitting = true;
      app.quit();
    }, Number(process.env.WDMTG_SMOKE) || 6000);
  }
});
