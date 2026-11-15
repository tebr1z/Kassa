import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// This suite loads only the controller into a VM with an in-memory Electron,
// client, clock and installer. It never starts the real EXE or touches its DB.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const desktop = path.join(root, 'desktop');
const source = readFileSync(path.join(desktop, 'updates.cjs'), 'utf8');
const words = require('../desktop/update-labels.cjs');
const trust = JSON.parse(readFileSync(path.join(desktop, 'update-trust.json'), 'utf8'));
const page = pathToFileURL(path.join(desktop, 'update-window.html')).href;
const channels = ['update:state', 'update:check', 'update:download', 'update:install', 'update:cancel'];
const directory = process.platform === 'win32' ? 'C:\\Program Files\\RestaMarket' : '/opt/RestaMarket installation';
const exe = path.join(directory, 'RestaMarket.exe');
const result = {
  available: true,
  file: path.join(root, 'fixture-only-update.exe'),
  manifest: { version: '0.6.3', releaseNotes: { az: 'Yeniləmə', en: 'Update', ru: 'Обновление', tr: 'Güncelleme', zh: '更新' } },
};
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ enabled = 'native', packaged = true, platform = 'win32', arch = 'x64' } = {}) {
  const events = [];
  const handlers = new Map();
  const removed = [];
  const windows = [];
  const timers = [];
  const errorBoxes = [];
  const confirmations = [];
  const broadcasts = [];
  const options = [];
  const effects = {
    admin: () => true,
    check: async () => result,
    download: async () => result,
    revalidate: async () => result,
    prepare: async () => {},
    recover: async () => {},
    confirm: async () => ({ response: 0 }),
    launch: async () => {},
  };
  let language = 'az';
  class Window extends EventEmitter {
    constructor(config) {
      super();
      this.config = config;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: 'about:blank' };
      this.webContents.send = (channel, state) => broadcasts.push({ channel, state });
      this.webContents.setWindowOpenHandler = handler => { this.popup = handler; };
      windows.push(this);
    }
    setMenu(value) { this.menu = value; }
    isDestroyed() { return this.destroyed; }
    show() { this.shown = (this.shown || 0) + 1; }
    focus() { this.focused = (this.focused || 0) + 1; }
    setTitle(title) { this.title = title; }
    async loadFile(file) { this.loadedFile = file; this.webContents.mainFrame.url = pathToFileURL(file).href; }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.destroyed = true; this.emit('closed'); }
      return event;
    }
  }
  const app = new EventEmitter();
  app.isPackaged = packaged;
  app.getVersion = () => '0.6.2';
  app.getPath = name => { assert.equal(name, 'exe'); return exe; };
  app.exit = code => { events.push(['exit', code]); };
  const client = {
    check: async () => { events.push(['check']); return effects.check(); },
    download: async () => { events.push(['download']); return effects.download(); },
    revalidateDownloaded: async () => { events.push(['revalidate']); return effects.revalidate(); },
    cancel: () => { events.push(['cancel']); },
  };
  const sandbox = {
    __dirname: desktop,
    module: { exports: {} },
    process: { platform, arch },
    require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:url') return { pathToFileURL };
      if (name === 'node:child_process') return { spawn: () => { throw new Error('Real spawn forbidden in this fixture'); } };
      if (name === './update-client.cjs') return { DesktopUpdateClient: class { constructor() { throw new Error('Real update client forbidden in this fixture'); } } };
      if (name === './update-labels.cjs') return words;
      if (name === './update-trust.json') return trust;
      throw new Error(`Unexpected controller dependency: ${name}`);
    },
    setTimeout(callback, delay) { const timer = { kind: 'timeout', callback, delay, unref() {} }; timers.push(timer); return timer; },
    setInterval(callback, delay) { const timer = { kind: 'interval', callback, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    clearInterval(timer) { if (timer) timer.cleared = true; },
  };
  vm.runInNewContext(source, sandbox, { filename: path.join(desktop, 'updates.cjs') });
  const configuration = {
    app, BrowserWindow: Window,
    dialog: {
      async showMessageBox(parent, config) { events.push(['confirm']); confirmations.push({ parent, config }); return effects.confirm(); },
      showErrorBox(title, message) { errorBoxes.push({ title, message }); },
    },
    ipcMain: { handle: (channel, handler) => { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); }, removeHandler: channel => { removed.push(channel); handlers.delete(channel); } },
    parent: { fixtureParent: true }, dataRoot: path.join(root, 'fixture-local-data-only'),
    getLanguage: () => language,
    isAdmin: async () => { events.push(['admin']); return effects.admin(); },
    prepareInstall: async version => { events.push(['prepare', version]); return effects.prepare(version); },
    recoverAfterFailure: async () => { events.push(['recover']); return effects.recover(); },
    clientFactory: value => { options.push(value); return client; },
    launch: async (...args) => { events.push(['launch', ...args]); return effects.launch(...args); },
  };
  if (enabled !== 'native') configuration.enabled = enabled;
  const controller = sandbox.module.exports.createDesktopUpdater(configuration);
  const currentWindow = () => windows.at(-1);
  const sender = () => ({ sender: currentWindow().webContents, senderFrame: currentWindow().webContents.mainFrame });
  const invoke = (channel, ...args) => handlers.get(`update:${channel}`)(sender(), ...args);
  return { controller, exports: sandbox.module.exports, events, effects, windows, timers, handlers, removed, errorBoxes, confirmations, broadcasts, options, app, client,
    currentWindow, sender, invoke, setLanguage(value) { language = value; },
    async open() { await controller.open(); await tick(); return currentWindow(); },
    async downloaded() { await this.open(); const state = await invoke('download'); assert.equal(state.phase, 'downloaded'); return state; },
    count(name) { return events.filter(([type]) => type === name).length; },
  };
}

// Window hardening, protocol isolation, identity checks and zero-argument IPC.
{
  const f = fixture();
  assert.deepEqual([...f.handlers.keys()].sort(), [...channels].sort());
  const win = await f.open();
  assert.equal(win.config.webPreferences.nodeIntegration, false);
  assert.equal(win.config.webPreferences.contextIsolation, true);
  assert.equal(win.config.webPreferences.sandbox, true);
  assert.equal(win.config.webPreferences.webSecurity, true);
  assert.equal(win.config.webPreferences.preload, path.join(desktop, 'update-preload.cjs'));
  assert.equal(win.loadedFile, path.join(desktop, 'update-window.html'));
  assert.equal(win.menu, null);
  assert.equal(win.popup().action, 'deny');
  for (const target of ['https://evil.example/', 'file:///tmp/elsewhere.html', `${page}?x=1`, `${page}#hash`]) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    win.webContents.emit('will-navigate', event, target);
    assert.equal(event.prevented, true);
  }
  const allowedNavigation = { prevented: false, preventDefault() { this.prevented = true; } };
  win.webContents.emit('will-navigate', allowedNavigation, page);
  assert.equal(allowedNavigation.prevented, false);
  for (const channel of channels) {
    const handle = f.handlers.get(channel);
    for (const event of [
      { sender: {}, senderFrame: win.webContents.mainFrame },
      { sender: win.webContents, senderFrame: { url: page } },
      { sender: win.webContents, senderFrame: undefined },
      { sender: win.webContents, senderFrame: { url: 'https://evil.example/' } },
    ]) await assert.rejects(async () => handle(event), /not allowed/);
    for (const argument of [undefined, 'https://evil.example/update.exe', { file: '/tmp/evil.exe' }, null]) await assert.rejects(async () => handle(f.sender(), argument), /not allowed/);
    win.webContents.mainFrame.url = `${page}?spoof=true`;
    await assert.rejects(async () => handle(f.sender()), /not allowed/);
    win.webContents.mainFrame.url = page;
  }
  const state = await f.invoke('state');
  state.phase = 'installing';
  assert.equal((await f.invoke('state')).phase, 'available');
  assert.equal(f.options[0].feedUrl, trust.feedUrl);
  assert.equal(f.options[0].publicKey, trust.publicKey);
  assert.equal(f.options[0].cacheDir, path.join(root, 'fixture-local-data-only', '.private', 'updates'));
  f.setLanguage('ru'); f.controller.changeLanguage();
  assert.equal(win.title, words('ru').windowTitle);
  assert.equal((await f.invoke('state')).language, 'ru');
  await f.controller.open();
  assert.equal(f.windows.length, 1);
  assert.equal(win.focused, 1);
  const staleHandler = f.handlers.get('update:state');
  const staleEvent = f.sender();
  win.close();
  await f.open();
  await assert.rejects(async () => staleHandler(staleEvent), /not allowed/);
  const event = f.sender();
  f.controller.dispose();
  await assert.rejects(async () => staleHandler(event), /not allowed/);
  assert.deepEqual([...f.removed].sort(), [...channels].sort());
  assert.equal(f.timers.every(timer => timer.cleared), true);
}

// Disabled / unsupported / smoke callers cannot create update windows or timers.
for (const config of [{ enabled: false }, { enabled: undefined, packaged: false }, { enabled: undefined, platform: 'linux' }, { enabled: undefined, arch: 'arm64' }]) {
  const f = fixture(config);
  await f.controller.open();
  assert.equal(f.windows.length, 0);
  assert.equal(f.timers.length, 0);
  assert.equal(f.count('check'), 0);
  assert.equal(f.count('admin'), 0);
  f.controller.dispose();
}
{
  const f = fixture(); f.effects.admin = () => false;
  await f.controller.open();
  assert.equal(f.windows.length, 0);
  assert.equal(f.errorBoxes[0].message, words('az').adminRequired);
  assert.equal(f.count('check'), 0);
  f.controller.dispose();
}

// Manual operations are authorized independently, not merely at window open.
for (const action of ['check', 'download']) {
  const f = fixture(); await f.open();
  f.effects.admin = () => false;
  const before = f.count(action);
  const state = await f.invoke(action);
  assert.equal(state.phase, 'error');
  assert.equal(state.error, words('az').adminRequired);
  assert.equal(f.count(action), before);
  assert.equal(f.count('launch'), 0);
  f.controller.dispose();
}
{
  const f = fixture(); f.effects.admin = () => { throw new Error('private admin lookup details'); };
  await f.controller.open();
  assert.equal(f.windows.length, 0);
  assert.equal(f.errorBoxes[0].message, words('az').adminRequired);
  f.controller.dispose();
}
{
  const f = fixture();
  const authorization = deferred(); f.effects.admin = () => authorization.promise;
  const opening = f.controller.open();
  f.controller.dispose(); authorization.resolve(true); await opening;
  assert.equal(f.windows.length, 0, 'Disposal during authorization must not open a window');
}
{
  const f = fixture(); await f.open();
  const authorization = deferred(); f.effects.admin = () => authorization.promise;
  const before = f.count('check'); const checking = f.invoke('check');
  f.controller.dispose(); authorization.resolve(true); await checking;
  assert.equal(f.count('check'), before, 'Disposal during authorization must not start a check');
}

// Progress and cancelled downloads are broadcast without exposing client details.
{
  const f = fixture(); await f.open();
  const download = deferred(); f.effects.download = () => download.promise;
  const operation = f.invoke('download'); await tick();
  assert.equal((await f.invoke('state')).phase, 'downloading');
  f.options[0].onProgress({ percent: 47, receivedBytes: 47, totalBytes: 100 });
  assert.equal((await f.invoke('state')).progress, 47);
  await f.invoke('cancel');
  assert.equal(f.count('cancel'), 1);
  download.reject(Object.assign(new Error('not shown'), { code: 'UPDATE_CANCELLED' }));
  const state = await operation;
  assert.equal(state.phase, 'available');
  assert.equal(state.error, undefined);
  assert.equal(f.count('launch'), 0);
  f.controller.dispose();
}
{
  const f = fixture(); await f.open();
  f.effects.check = async () => { throw new Error('private database password /path/not/public'); };
  assert.equal((await f.invoke('check')).error, words('az').recoveryMessage);
  f.effects.check = async () => { throw Object.assign(new Error('cancel'), { code: 'UPDATE_CANCELLED' }); };
  const state = await f.invoke('check'); assert.equal(state.phase, 'idle'); assert.equal(state.error, undefined);
  f.controller.dispose();
}

// Authorization must not open a concurrency gap before check/download lock.
for (const action of ['check', 'download']) {
  const f = fixture(); await f.open();
  const authorization = deferred(); f.effects.admin = () => authorization.promise;
  const operation = deferred(); f.effects[action] = () => operation.promise;
  const before = f.count(action);
  const first = f.invoke(action); const second = f.invoke(action);
  authorization.resolve(true); await tick();
  assert.equal(f.count(action) - before, 1, `Concurrent ${action} passed the authorization gap`);
  operation.resolve(result); await Promise.all([first, second]);
  f.controller.dispose();
}

// Installation: native confirmation defaults to cancel; admin is checked again;
// authenticated file verification occurs on both sides of backup/shutdown.
{
  const f = fixture(); await f.downloaded();
  const start = f.events.length;
  await f.invoke('install');
  const operations = f.events.slice(start).map(([name]) => name);
  assert.equal(operations.join(','), 'admin,confirm,admin,revalidate,prepare,revalidate,launch,exit');
  const confirmation = f.confirmations[0];
  assert.equal(confirmation.parent, f.currentWindow());
  assert.equal(confirmation.config.defaultId, 1);
  assert.equal(confirmation.config.cancelId, 1);
  assert.equal(confirmation.config.noLink, true);
  assert.equal(confirmation.config.buttons[0], words('az').install);
  assert.equal(confirmation.config.buttons[1], words('az').cancel);
  assert.deepEqual(f.events.find(([name]) => name === 'launch').slice(1), [result.file, path.dirname(exe)]);
  assert.equal(f.events.find(([name]) => name === 'prepare')[1], '0.6.3');
  assert.equal(f.events.find(([name]) => name === 'exit')[1], 0);
  assert.equal(f.currentWindow().close().prevented, true);
  f.app.emit('before-quit');
  assert.equal(f.handlers.size, channels.length, 'Updater must stay active while installation is in progress');
  const cancelled = f.count('cancel'); await f.invoke('cancel');
  assert.equal(f.count('cancel'), cancelled, 'Cancellation must not interrupt prepared installation');
  f.controller.dispose();
}
{
  const f = fixture(); await f.downloaded();
  f.effects.confirm = async () => ({ response: 1 });
  assert.equal((await f.invoke('install')).phase, 'downloaded');
  for (const operation of ['prepare', 'revalidate', 'launch', 'recover', 'exit']) assert.equal(f.count(operation), 0);
  f.controller.dispose();
}
{
  const f = fixture(); await f.downloaded();
  f.effects.confirm = async () => { f.effects.admin = () => false; return { response: 0 }; };
  const state = await f.invoke('install');
  assert.equal(state.error, words('az').adminRequired);
  for (const operation of ['prepare', 'revalidate', 'launch', 'recover', 'exit']) assert.equal(f.count(operation), 0);
  f.controller.dispose();
}
{
  const f = fixture(); await f.downloaded();
  f.effects.admin = () => false;
  assert.equal((await f.invoke('install')).error, words('az').adminRequired);
  assert.equal(f.count('confirm'), 0);
  assert.equal(f.count('launch'), 0);
  f.controller.dispose();
}
{
  const f = fixture(); await f.downloaded();
  const answer = deferred(); f.effects.confirm = () => answer.promise;
  const first = f.invoke('install'); await tick();
  await f.invoke('install'); assert.equal(f.count('confirm'), 1);
  answer.resolve({ response: 0 }); await first;
  assert.equal(f.count('launch'), 1); assert.equal(f.count('exit'), 1);
  f.controller.dispose();
}

// Every verification / backup / shutdown / spawn failure fails closed. Recovery
// is attempted exactly when preparation may already have changed local state.
for (const failure of ['first-revalidate', 'prepare-backup', 'prepare-shutdown', 'second-revalidate', 'launch']) {
  const f = fixture(); await f.downloaded();
  let verifications = 0;
  const privateError = new Error(`private failure ${failure}: C:/Users/private/secret`);
  f.effects.revalidate = async () => { verifications += 1; if ((failure === 'first-revalidate' && verifications === 1) || (failure === 'second-revalidate' && verifications === 2)) throw privateError; return result; };
  f.effects.prepare = async () => { if (failure.startsWith('prepare-')) throw privateError; };
  f.effects.launch = async () => { if (failure === 'launch') throw privateError; };
  const state = await f.invoke('install');
  assert.equal(state.error, words('az').recoveryMessage);
  assert.equal(f.count('exit'), 0, failure);
  assert.equal(f.count('recover'), failure === 'first-revalidate' ? 0 : 1, failure);
  assert.equal(f.count('launch'), failure === 'launch' ? 1 : 0, failure);
  assert.equal(state.phase === 'error' || state.phase === 'downloaded', true);
  // A recoverable attempt must not leave the downloaded latch permanently
  // blocking checks/downloads until the whole EXE is restarted.
  f.effects.check = async () => result;
  f.effects.download = async () => result;
  f.effects.revalidate = async () => result;
  f.effects.prepare = async () => {};
  f.effects.launch = async () => {};
  assert.equal((await f.invoke('check')).phase, 'available', `${failure}: could not retry check`);
  assert.equal((await f.invoke('download')).phase, 'downloaded', `${failure}: could not retry download`);
  assert.equal(f.currentWindow().close().prevented, false);
  f.controller.dispose();
}

// Offline periodic checks do not show dialogs or turn a working app into an
// update error. Background availability does not open a window either.
{
  const f = fixture();
  const timeout = f.timers.find(timer => timer.kind === 'timeout');
  const interval = f.timers.find(timer => timer.kind === 'interval');
  assert.equal(timeout.delay, 30_000);
  assert.equal(interval.delay, 6 * 60 * 60 * 1000);
  f.effects.check = async () => { throw new Error('offline private network diagnostics'); };
  timeout.callback(); await tick();
  assert.equal(f.windows.length, 0); assert.equal(f.errorBoxes.length, 0); assert.equal(f.count('admin'), 0);
  f.effects.check = async () => result; interval.callback(); await tick();
  assert.equal(f.windows.length, 0); assert.equal(f.errorBoxes.length, 0);
  await f.open();
  const before = await f.invoke('state');
  f.effects.check = async () => { throw new Error('offline'); };
  interval.callback(); await tick();
  const after = await f.invoke('state');
  assert.equal(after.phase, before.phase); assert.equal(after.error, undefined);
  assert.equal(f.errorBoxes.length, 0);
  f.app.emit('before-quit'); assert.equal(f.handlers.size, 0);
}

// Windows NSIS requires /D to be LAST and unquoted, even with spaces. Nothing
// from the renderer is used as a command; spawn never uses a shell.
{
  const f = fixture();
  const args = f.exports.installerArguments(directory);
  assert.equal(args.at(-1), `/D=${directory}`);
  assert.equal(args.at(-1).includes('"'), false);
  assert.equal(args.includes('/S'), true);
  assert.equal(args.includes('--updated'), true);
  assert.equal(args.includes('--force-run'), true);
  for (const invalid of ['relative/path', `${directory}\nanything`, `${directory}\rany`, `${directory}"`, `${directory}\0`]) assert.throws(() => f.exports.installerArguments(invalid), /Invalid installation directory/);
  let spawned;
  let child;
  const spawn = (...parameters) => { spawned = parameters; child = new EventEmitter(); child.unref = () => { child.unreferenced = true; }; return child; };
  const launch = f.exports.launchInstaller(result.file, directory, spawn);
  assert.equal(spawned[0], result.file);
  assert.equal(spawned[1].at(-1), `/D=${directory}`);
  assert.equal(spawned[2].shell, false);
  assert.equal(spawned[2].detached, true);
  assert.equal(spawned[2].stdio, 'ignore');
  assert.equal(spawned[2].windowsHide, true);
  assert.equal(spawned[2].windowsVerbatimArguments, true);
  child.emit('spawn'); await launch; assert.equal(child.unreferenced, true);
  const failed = f.exports.launchInstaller(result.file, directory, spawn);
  child.emit('error', new Error('fixture spawn failure'));
  await assert.rejects(() => failed, /fixture spawn failure/);
  f.controller.dispose();
}

console.log('Desktop updater controller: local-window IPC boundary, admin gates, native confirmation, double verification, failure recovery, offline background and Windows installer arguments passed. No network, database or installer was used.');
