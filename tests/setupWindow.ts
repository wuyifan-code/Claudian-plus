type TestWindow = typeof globalThis & {
  cancelAnimationFrame?: (handle: number) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

// Register built-in providers after each test module has been evaluated.
// Importing providers at setup-file time eagerly loads every concrete runtime
// before a test's `jest.mock(...)` declarations can take effect. That made
// tests which mock CLI/process boundaries spawn the host's real executables.
// Keeping registration in a lifecycle hook preserves the production contract
// while allowing per-suite mocks to replace provider modules safely.
beforeAll(() => {
  // A few subprocess unit suites intentionally replace `node:child_process`
  // with a minimal mock. Provider registration imports the Codex WSL resolver,
  // which legitimately needs `execFile`; do not eagerly load that unrelated
  // provider graph into a test that is isolating spawn behavior.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const childProcess = require('node:child_process') as {
    execFile?: unknown;
    spawn?: unknown;
  };
  if (typeof childProcess.execFile !== 'function' || jest.isMockFunction(childProcess.spawn)) {
    return;
  }
  // Likewise, settings/provider registration imports UI classes such as
  // Modal. Suites that intentionally provide a narrow Obsidian mock should
  // not be forced to implement the whole UI surface just to run a core test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const obsidian = require('obsidian') as { Modal?: unknown };
  if (typeof obsidian.Modal !== 'function') {
    return;
  }
  // Some feature suites replace ProviderRegistry with a deliberately narrow
  // mock. Registration is a production bootstrap concern and must not make
  // those unit tests implement every registry method just to load the setup.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const registryModule = require('../src/core/providers/ProviderRegistry') as {
    ProviderRegistry?: { register?: unknown };
  };
  if (typeof registryModule.ProviderRegistry?.register !== 'function') {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerBuiltInProviders } = require('../src/providers') as {
    registerBuiltInProviders: () => void;
  };
  registerBuiltInProviders();
});

const testWindow = globalThis as TestWindow;

if (!testWindow.requestAnimationFrame) {
  testWindow.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    Number(setTimeout(() => callback(Date.now()), 0))
  );
}

if (!testWindow.cancelAnimationFrame) {
  testWindow.cancelAnimationFrame = (handle: number): void => {
    clearTimeout(handle);
  };
}

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
    writable: true,
  });
}

// Polyfill Obsidian DOM helpers for jsdom-based tests.
const SVG_NS = 'http://www.w3.org/2000/svg';

function applyDomElementInfo(el: Element, info: unknown): void {
  if (!info) return;
  if (typeof info === 'string') {
    el.classList.add(...info.split(/\s+/).filter(Boolean));
    return;
  }
  const opts = info as Record<string, unknown>;
  if (opts.cls) {
    const classes = Array.isArray(opts.cls) ? opts.cls : String(opts.cls).split(/\s+/);
    el.classList.add(...classes.filter(Boolean) as string[]);
  }
  if (opts.text && 'textContent' in el) {
    (el as HTMLElement).textContent = String(opts.text);
  }
  if (opts.attr) {
    for (const [key, value] of Object.entries(opts.attr as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      el.setAttribute(key, String(value));
    }
  }
  if (opts.title && 'setAttribute' in el) {
    el.setAttribute('title', String(opts.title));
  }
}

(globalThis as typeof globalThis & { createDiv?: typeof createDiv }).createDiv = function createDiv(
  info?: unknown,
  callback?: (el: HTMLDivElement) => void,
): HTMLDivElement {
  const el = document.createElement('div');
  applyDomElementInfo(el, info);
  if (callback) callback(el);
  return el;
};

(globalThis as typeof globalThis & { createEl?: typeof createEl }).createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  info?: unknown,
  callback?: (el: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyDomElementInfo(el, info);
  if (callback) callback(el);
  return el;
};

(globalThis as typeof globalThis & { createSpan?: typeof createSpan }).createSpan = function createSpan(
  info?: unknown,
  callback?: (el: HTMLSpanElement) => void,
): HTMLSpanElement {
  const el = document.createElement('span');
  applyDomElementInfo(el, info);
  if (callback) callback(el);
  return el;
};

(globalThis as typeof globalThis & { createSvg?: typeof createSvg }).createSvg = function createSvg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  info?: unknown,
  callback?: (el: SVGElementTagNameMap[K]) => void,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  applyDomElementInfo(el, info);
  if (callback) callback(el);
  return el;
};

(globalThis as typeof globalThis & { createFragment?: typeof createFragment }).createFragment = function createFragment(
  callback?: (el: DocumentFragment) => void,
): DocumentFragment {
  const el = document.createDocumentFragment();
  if (callback) callback(el);
  return el;
};

if (globalThis.HTMLElement && !Reflect.has(globalThis.HTMLElement.prototype, 'createDiv')) {
  globalThis.HTMLElement.prototype.createDiv = function (this: HTMLElement, info?, callback?) {
    const el = createDiv(info, callback);
    this.appendChild(el);
    return el;
  };
  globalThis.HTMLElement.prototype.createEl = function (this: HTMLElement, tag, info?, callback?) {
    const el = createEl(tag, info, callback);
    this.appendChild(el);
    return el;
  };
  globalThis.HTMLElement.prototype.createSpan = function (this: HTMLElement, info?, callback?) {
    const el = createSpan(info, callback);
    this.appendChild(el);
    return el;
  };
  globalThis.HTMLElement.prototype.createSvg = function (this: HTMLElement, tag, info?, callback?) {
    const el = createSvg(tag, info, callback);
    this.appendChild(el);
    return el;
  };
}

if (globalThis.SVGElement && !Reflect.has(globalThis.SVGElement.prototype, 'createSvg')) {
  globalThis.SVGElement.prototype.createSvg = function (this: SVGElement, tag, info?, callback?) {
    const el = createSvg(tag, info, callback);
    this.appendChild(el);
    return el;
  };
}
