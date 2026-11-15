import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';

// Pure DOM/IPC fixtures: this suite never opens the user's EXE, database or UI.
const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const html = read('desktop/update-window.html');
const css = read('desktop/update-window.css');
const renderer = read('desktop/update-window.js');
const preload = read('desktop/update-preload.cjs');
const nativeLabels = createRequire(import.meta.url)('../desktop/update-labels.cjs');
const languages = ['az', 'en', 'ru', 'tr', 'zh'];
const phases = ['idle', 'checking', 'current', 'available', 'downloading', 'downloaded', 'installing', 'error'];
const base = { phase: 'idle', currentVersion: '0.6.2', language: 'az', enabled: true };

assert.match(html, /connect-src 'none'/);
assert.match(html, /default-src 'none'/);
assert.match(html, /script-src 'self'/);
assert.match(html, /style-src 'self'/);
assert.match(html, /img-src 'self'/);
assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|\bon\w+\s*=|<script[^>]*>\s*[^<\s]/i);
assert.doesNotMatch(html + css + renderer, /https?:\/\/|\bfetch\s*\(|\bXMLHttpRequest\b|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|\beval\s*\(/);
assert.match(html, /id="error" role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /\[hidden\]/);

const expectedNativeKeys = ['menu', 'check', 'windowTitle', 'adminRequired', 'confirmTitle', 'confirmMessage', 'install', 'cancel', 'errorTitle', 'backupFailed', 'shutdownFailed', 'installerFailed', 'recoveryMessage'].sort();
for (const language of languages) {
  assert.deepEqual(Object.keys(nativeLabels(language)).sort(), expectedNativeKeys);
  for (const value of Object.values(nativeLabels(language))) assert.equal(typeof value === 'string' && value.trim().length > 0, true);
}
assert.equal(nativeLabels('unsupported'), nativeLabels('az'));

let bridge;
const invocations = [];
const listeners = new Map();
const ipc = {
  invoke: (...args) => { invocations.push(args); return Promise.resolve({ ...base }); },
  on: (channel, listener) => { assert.equal(listeners.has(channel), false); listeners.set(channel, listener); },
  removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
};
vm.runInNewContext(preload, {
  require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'restaUpdate'); bridge = value; } }, ipcRenderer: ipc };
  },
}, { filename: 'update-preload.cjs' });
assert.deepEqual(Object.keys(bridge).sort(), ['getState', 'check', 'download', 'install', 'cancel', 'onState'].sort());
assert.equal(Object.isFrozen(bridge), true);
for (const [method, channel] of Object.entries({ getState: 'update:state', check: 'update:check', download: 'update:download', install: 'update:install', cancel: 'update:cancel' })) {
  await bridge[method]('untrusted-extra-argument');
  assert.deepEqual(invocations.at(-1), [channel]);
}
assert.throws(() => bridge.onState('not-a-function'), /callback/);
const callbacks = [];
const unsubscribe = bridge.onState((...args) => callbacks.push(args));
const channel = 'update:state-changed';
assert.equal(listeners.size, 1);
listeners.get(channel)({ secret: 'never forward the event' }, base);
assert.equal(callbacks.length, 1);
assert.equal(callbacks[0].length, 1);
assert.equal(callbacks[0][0], base);
unsubscribe();
unsubscribe();
assert.equal(listeners.size, 0);

class Element {
  constructor(id, attributes = '') {
    this.id = id;
    this.hidden = /\bhidden\b/.test(attributes);
    this.disabled = /\bdisabled\b/.test(attributes);
    this.textContent = '';
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = 0;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'value') this.value = undefined; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  focus() { this.document.activeElement = this; }
  click() { this.listeners.get('click')?.(); }
  set innerHTML(_value) { throw new Error('Unsafe HTML insertion'); }
}

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture({ initial = base, initialPromise, missingBridge = false } = {}) {
  const elements = new Map();
  for (const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) elements.set(tag[1], new Element(tag[1], tag[0]));
  const card = new Element('card');
  const doc = { documentElement: { lang: 'az' }, activeElement: null, title: '', getElementById: id => elements.get(id), querySelector: selector => { assert.equal(selector, '.update-card'); return card; } };
  for (const element of elements.values()) element.document = doc;
  const calls = [];
  const handlers = new Map();
  let broadcast;
  let unsubscribed = 0;
  const events = new Map();
  const api = {
    getState: () => initialPromise || Promise.resolve(initial),
    onState: callback => { broadcast = callback; return () => { unsubscribed += 1; }; },
  };
  for (const action of ['check', 'download', 'install', 'cancel']) api[action] = () => {
    calls.push(action);
    return handlers.has(action) ? handlers.get(action)() : Promise.resolve({ ...initial });
  };
  const win = { addEventListener: (event, callback) => events.set(event, callback), ...(missingBridge ? {} : { restaUpdate: api }) };
  const context = vm.createContext({ document: doc, window: win });
  // Expose the private dictionary only in the fixture to verify key parity.
  const fixtureSource = renderer.replace('  const phases = new Set(', '  globalThis.fixtureLabels = labels;\n  const phases = new Set(');
  vm.runInContext(fixtureSource, context, { filename: 'update-window.js' });
  await settle();
  return { elements, doc, card, calls, handlers, broadcast: next => broadcast(next), events, unsubscribed: () => unsubscribed, labels: context.fixtureLabels };
}

const ui = await fixture();
const keys = Object.keys(ui.labels.az).sort();
for (const language of languages) {
  assert.deepEqual(Object.keys(ui.labels[language]).sort(), keys, `Renderer translation key mismatch: ${language}`);
  for (const value of Object.values(ui.labels[language])) assert.equal(typeof value === 'string' && value.trim().length > 0, true);
  for (const phase of phases) {
    ui.broadcast({ ...base, language, phase, progress: 42.4, version: '0.6.3', notes: '<img src=x onerror=alert(1)>', ...(phase === 'error' ? { error: '<b>offline</b>' } : {}) });
    assert.equal(ui.doc.documentElement.lang, language);
    assert.equal(ui.doc.title, ui.labels[language].title);
    assert.equal(ui.elements.get('heading').textContent.length > 0, true);
    assert.equal(ui.elements.get('description').textContent.length > 0, true);
    assert.equal(ui.elements.get('check').hidden, !['idle', 'current', 'error'].includes(phase));
    assert.equal(ui.elements.get('download').hidden, phase !== 'available');
    assert.equal(ui.elements.get('install').hidden, phase !== 'downloaded');
    assert.equal(ui.elements.get('cancel').hidden, !['checking', 'downloading'].includes(phase));
    assert.equal(ui.elements.get('progress-block').hidden, phase !== 'downloading');
    assert.equal(ui.elements.get('notes-content').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(ui.elements.get('error').hidden, phase !== 'error');
  }
}
assert.equal(ui.elements.get('error').textContent, '<b>offline</b>');

ui.broadcast({ ...base, language: 'toString', phase: 'downloading', progress: -25 });
assert.equal(ui.doc.documentElement.lang, 'az');
assert.equal(ui.elements.get('progress').value, 0);
ui.broadcast({ ...base, phase: 'downloading', progress: 300 });
assert.equal(ui.elements.get('progress').value, 100);
ui.broadcast({ ...base, phase: 'downloading', progress: Infinity });
assert.equal(ui.elements.get('progress').value, undefined);
assert.equal(ui.elements.get('progress-value').textContent, ui.labels.az.progressUnknown);
ui.broadcast({ ...base, enabled: false });
assert.equal(ui.elements.get('check').disabled, true);
assert.equal(ui.elements.get('description').textContent, ui.labels.az.disabled);

// Pending actions are guarded, but a pending download remains cancellable.
const download = deferred();
ui.handlers.set('download', () => download.promise);
ui.handlers.set('cancel', () => Promise.resolve({ ...base }));
ui.broadcast({ ...base, phase: 'available' });
ui.elements.get('download').click();
ui.elements.get('download').click();
assert.equal(ui.calls.filter(value => value === 'download').length, 1);
ui.broadcast({ ...base, phase: 'downloading', progress: 8 });
assert.equal(ui.elements.get('cancel').disabled, false);
ui.elements.get('cancel').click();
await settle();
assert.equal(ui.calls.filter(value => value === 'cancel').length, 1);
download.resolve({ ...base });
await settle();
assert.equal(ui.elements.get('check').disabled, false);

ui.handlers.set('check', () => Promise.reject(new Error('internal stack and private path must not render')));
ui.elements.get('check').click();
await settle();
assert.equal(ui.elements.get('error').textContent, ui.labels.az.startupError);
assert.equal(ui.elements.get('check').disabled, false);
ui.broadcast({ ...base, phase: 'available' });
assert.equal(ui.elements.get('error').hidden, true);
ui.elements.get('download').focus();
ui.broadcast({ ...base, phase: 'downloaded' });
assert.equal(ui.doc.activeElement.id, 'install');
ui.broadcast({ ...base, phase: 'installing' });
assert.equal(['check', 'download', 'install', 'cancel'].every(id => ui.elements.get(id).hidden), true);

ui.broadcast({ ...base, phase: 'available', notes: 'x'.repeat(20000), error: 'e'.repeat(4000) });
assert.equal(ui.elements.get('notes-content').textContent.length, 10000);
assert.equal(ui.elements.get('error').textContent.length, 1200);
ui.events.get('beforeunload')();
assert.equal(ui.unsubscribed(), 1);

const delayed = deferred();
const race = await fixture({ initialPromise: delayed.promise });
race.broadcast({ ...base, phase: 'downloaded', version: '0.6.3' });
delayed.resolve(base);
await settle();
assert.equal(race.elements.get('install').hidden, false, 'Stale initial state overwrote a newer broadcast');
const offline = await fixture({ missingBridge: true });
assert.equal(offline.elements.get('check').disabled, true);
assert.equal(offline.elements.get('error').hidden, false);
assert.equal(offline.elements.get('error').textContent, offline.labels.az.startupError);

console.log('Desktop updater UI: CSP, narrow IPC, five languages, all phases, cancellation, races and plain-text safety passed.');
