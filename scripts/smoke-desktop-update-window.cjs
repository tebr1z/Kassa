/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// Run with node_modules/electron/dist/electron.exe and this file. This is a
// separate application/profile with an in-memory update client: no POS server,
// local inventory database, real installer or network is started.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { createDesktopUpdater } = require('../desktop/updates.cjs');

const root = path.resolve(__dirname, '..');
const fixtureRoot = path.join(root, '.local-desktop-data', `updater-fixture-${randomUUID()}`);
const profile = path.join(fixtureRoot, 'electron-profile');
const screenshot = path.join(root, 'outputs', 'tests', 'desktop-update-window.png');
const languages = {
  az: { available: 'Yeni versiya hazırdır', current: 'Proqramınız yenidir', check: 'Yeniləmələri yoxla', download: 'Yüklə', notes: 'Şəkil və məhsul seçimlərinin sayta göndərilməsi təkmilləşdirildi.\nYeniləmələr artıq proqramın içindən yüklənir.' },
  en: { available: 'A new version is ready', current: 'You are up to date', check: 'Check for updates', download: 'Download', notes: 'Fixture update notes.' },
  ru: { available: 'Новая версия готова', current: 'У вас актуальная версия', check: 'Проверить обновления', download: 'Загрузить', notes: 'Примечания к тестовому обновлению.' },
  tr: { available: 'Yeni sürüm hazır', current: 'Uygulamanız güncel', check: 'Güncellemeleri denetle', download: 'İndir', notes: 'Deneme güncelleme notları.' },
  zh: { available: '新版本已就绪', current: '已是最新版本', check: '检查更新', download: '下载', notes: '测试更新说明。' },
};
let language = 'az';
let available = true;
let updater;
let win;
let updateCalls = 0;
let cancelled = 0;
let forbiddenCalls = 0;
let timeout;
const networkAttempts = [];
const failures = [];

function forbid(operation) {
  forbiddenCalls += 1;
  throw new Error(`Fixture must not ${operation}`);
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function waitFor(expression, message) {
  const limit = Date.now() + 8000;
  while (Date.now() < limit) {
    if (await win.webContents.executeJavaScript(expression)) return;
    await delay(25);
  }
  throw new Error(message);
}
async function snapshot() {
  return win.webContents.executeJavaScript(`(() => ({
    language: document.documentElement.lang,
    title: document.title,
    heading: document.getElementById('heading').textContent,
    check: document.getElementById('check').textContent,
    checkHidden: document.getElementById('check').hidden,
    checkDisabled: document.getElementById('check').disabled,
    download: document.getElementById('download').textContent,
    downloadHidden: document.getElementById('download').hidden,
    downloadDisabled: document.getElementById('download').disabled,
    notes: document.getElementById('notes-content').textContent,
    notesChildElements: document.getElementById('notes-content').childElementCount,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    nodeRequire: typeof window.require,
    nodeProcess: typeof window.process,
    bridge: Object.keys(window.restaUpdate).sort(),
    errors: document.getElementById('error').hidden ? '' : document.getElementById('error').textContent
  }))()`);
}

// Profile paths are confined to this checkout, never the user's BirKassa data.
if (path.dirname(fixtureRoot) !== path.join(root, '.local-desktop-data')) throw new Error('Invalid fixture directory');
app.setName('RestaMarket updater fixture');
app.setPath('userData', profile);
app.setPath('sessionData', path.join(profile, 'session'));
app.setPath('crashDumps', path.join(fixtureRoot, 'crash-dumps'));
app.setAppLogsPath(path.join(fixtureRoot, 'logs'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => failures.push(`Renderer exited: ${details.reason}`));
  contents.on('preload-error', (_event, _preload, error) => failures.push(`Preload failed: ${error.message}`));
  contents.on('console-message', details => {
    if (details.level === 'error') failures.push(`Renderer console: ${details.message}`);
  });
});

app.whenReady().then(async () => {
  timeout = setTimeout(() => { console.error('FAIL: updater window fixture timed out'); app.exit(1); }, 45_000);
  try {
    await fs.mkdir(profile, { recursive: true });
    const fixtureVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    const controllerApp = {
      isPackaged: app.isPackaged,
      getVersion: () => fixtureVersion,
      getPath: name => app.getPath(name),
      on: (...args) => app.on(...args),
      once: (...args) => app.once(...args),
      exit: () => forbid('exit as part of installer launch'),
    };
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      networkAttempts.push(details.url);
      callback({ cancel: true });
    });
    updater = createDesktopUpdater({
      app: controllerApp, BrowserWindow, ipcMain,
      dialog: { showMessageBox: async () => forbid('show an install confirmation'), showErrorBox: () => forbid('show an error dialog') },
      dataRoot: path.join(fixtureRoot, 'fake-data-no-database'),
      getLanguage: () => language,
      isAdmin: async () => true,
      enabled: true,
      clientFactory: () => ({
        async check() {
          updateCalls += 1;
          return { available, manifest: { version: available ? '0.6.3' : fixtureVersion, releaseNotes: Object.fromEntries(Object.entries(languages).map(([key, value]) => [key, value.notes])) } };
        },
        async download() { return forbid('download an installer'); },
        async revalidateDownloaded() { return forbid('read an installer'); },
        cancel() { cancelled += 1; },
      }),
      prepareInstall: async () => forbid('prepare installation or back up real data'),
      recoverAfterFailure: async () => forbid('perform application recovery'),
      launch: async () => forbid('launch an installer'),
    });
    await updater.open();
    [win] = BrowserWindow.getAllWindows();
    assert.ok(win);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    const preferences = win.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.webSecurity, true);
    await waitFor("document.getElementById('heading').textContent === 'Yeni versiya hazırdır'", 'Renderer did not receive available state');
    const state = await win.webContents.executeJavaScript('window.restaUpdate.getState()');
    assert.equal(state.phase, 'available');
    assert.equal(state.enabled, true);
    assert.equal(state.language, 'az');
    assert.equal(state.currentVersion, fixtureVersion);
    const initial = await snapshot();
    assert.deepEqual(initial.bridge, ['cancel', 'check', 'download', 'getState', 'install', 'onState']);
    assert.equal(initial.nodeRequire, 'undefined');
    assert.equal(initial.nodeProcess, 'undefined');

    await win.webContents.executeJavaScript("window.fixtureStateEvents=[]; window.fixtureUnsubscribe=window.restaUpdate.onState(state=>window.fixtureStateEvents.push(state.phase)); void 0;");
    for (const [next, expected] of Object.entries(languages)) {
      language = next;
      updater.changeLanguage();
      await waitFor(`document.documentElement.lang === ${JSON.stringify(next)}`, `Language did not change to ${next}`);
      const view = await snapshot();
      assert.equal(view.heading, expected.available, next);
      assert.equal(view.check, expected.check, next);
      assert.equal(view.download, expected.download, next);
      assert.equal(view.downloadHidden, false, next);
      assert.equal(view.downloadDisabled, false, next);
      assert.equal(view.notes, expected.notes, next);
      assert.equal(view.overflow, false, `${next}: horizontal overflow`);
      assert.equal(view.errors, '', next);
      available = false;
      const current = await win.webContents.executeJavaScript('window.restaUpdate.check()');
      assert.equal(current.phase, 'current', next);
      await waitFor(`document.getElementById('heading').textContent === ${JSON.stringify(expected.current)}`, `Current-state render failed for ${next}`);
      const currentView = await snapshot();
      assert.equal(currentView.checkHidden, false, next);
      assert.equal(currentView.checkDisabled, false, next);
      assert.equal(currentView.downloadHidden, true, next);
      available = true;
      assert.equal((await win.webContents.executeJavaScript('window.restaUpdate.check()')).phase, 'available');
      await waitFor(`document.getElementById('heading').textContent === ${JSON.stringify(expected.available)}`, `Available-state render failed for ${next}`);
    }

    // A real renderer cannot pass an arbitrary path through these parameterless
    // bridge methods. This extra argument is discarded by the actual preload.
    assert.equal((await win.webContents.executeJavaScript("window.restaUpdate.getState('file:///untrusted.exe')")).phase, 'available');
    assert.equal((await win.webContents.executeJavaScript('window.fixtureStateEvents.length')) > 5, true);
    const beforeUnsubscribe = await win.webContents.executeJavaScript('window.fixtureUnsubscribe();window.fixtureStateEvents.length');
    language = 'az'; updater.changeLanguage();
    await waitFor("document.documentElement.lang === 'az'", 'Could not restore Azerbaijani');
    assert.equal(await win.webContents.executeJavaScript('window.fixtureStateEvents.length'), beforeUnsubscribe);
    assert.equal((await snapshot()).notesChildElements, 0);

    // Render known fixture notes as text even if the mock manifest contains HTML.
    const originalNotes = languages.az.notes;
    languages.az.notes = '<img src=x onerror=alert(1)> plain fixture text';
    await win.webContents.executeJavaScript('window.restaUpdate.check()');
    await waitFor("document.getElementById('notes-content').textContent.startsWith('<img')", 'Plain-text notes not displayed');
    assert.equal((await snapshot()).notesChildElements, 0);
    languages.az.notes = originalNotes;
    await win.webContents.executeJavaScript('window.restaUpdate.check()');
    await waitFor(`document.getElementById('notes-content').textContent === ${JSON.stringify(originalNotes)}`, 'Could not restore screenshot notes');
    assert.equal(forbiddenCalls, 0);
    assert.equal(networkAttempts.length, 0, `Unexpected renderer network: ${networkAttempts.join(', ')}`);
    assert.deepEqual(failures, []);
    await fs.mkdir(path.dirname(screenshot), { recursive: true });
    await delay(100);
    await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG());
    assert.equal((await fs.stat(screenshot)).size > 1000, true);
    console.log(`PASS: real sandboxed Electron updater window; five languages; available/current states; narrow IPC; plaintext notes; unsubscribe; no network/DB/installer. Checks=${updateCalls}.`);
    console.log(`Screenshot: ${screenshot}`);
    console.log(`Isolated fixture profile: ${fixtureRoot}`);
  } catch (error) {
    console.error('FAIL: updater window fixture:', error.stack || error.message);
    console.error('Fixture renderer failures:', JSON.stringify(failures));
    if (win && !win.isDestroyed()) {
      console.error('Fixture DOM:', JSON.stringify(await snapshot().catch(error => ({ error: error.message }))));
      await fs.mkdir(path.dirname(screenshot), { recursive: true });
      await fs.writeFile(screenshot, (await win.webContents.capturePage()).toPNG());
    }
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    updater?.dispose();
    if (win && !win.isDestroyed()) win.destroy();
    assert.equal(cancelled >= 0, true);
    if (process.exitCode) app.exit(process.exitCode);
    else app.quit();
  }
});
