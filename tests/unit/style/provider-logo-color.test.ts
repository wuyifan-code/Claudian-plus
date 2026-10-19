/** @jest-environment jsdom */

import { readFileSync } from 'fs';
import { join } from 'path';

const STYLE_DIR = join(__dirname, '..', '..', '..', 'src', 'style');

/** Providers that keep their own brand colour in the header. */
const BRANDED_PROVIDERS = ['claude'];

/** Providers that must render the header mark in theme-adaptive black/white. */
const NEUTRAL_PROVIDERS = ['codex', 'opencode', 'pi', 'antigravity', 'kimi', 'dsh'];

describe('header provider mark colour contract', () => {
  let style: HTMLStyleElement;

  beforeAll(() => {
    style = document.createElement('style');
    style.textContent = [
      readFileSync(join(STYLE_DIR, 'base', 'variables.css'), 'utf-8'),
      readFileSync(join(STYLE_DIR, 'components', 'header.css'), 'utf-8'),
    ].join('\n');
    document.head.appendChild(style);
  });

  afterAll(() => {
    style.remove();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountLogo(providerId: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'claudian-plus-container';
    container.setAttribute('data-provider', providerId);

    const header = document.createElement('div');
    header.className = 'claudian-plus-header';
    const logo = document.createElement('span');
    logo.className = 'claudian-plus-logo';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-provider', providerId);
    logo.appendChild(svg);
    header.appendChild(logo);
    container.appendChild(header);
    document.body.appendChild(container);

    return logo;
  }

  it.each(NEUTRAL_PROVIDERS)('renders the %s header mark in the theme text colour', (providerId) => {
    const logo = mountLogo(providerId);
    expect(getComputedStyle(logo).color).toBe('var(--text-normal)');
  });

  it.each(BRANDED_PROVIDERS)('keeps the %s header mark on its own brand colour', (providerId) => {
    const logo = mountLogo(providerId);
    expect(getComputedStyle(logo).color).toBe('var(--claudian-plus-brand-claude)');
  });

  it('never falls back to the Claude brand for a provider without its own brand token', () => {
    // dsh has no --claudian-plus-brand-dsh token; the container default is Claude's
    // orange, which used to leak into the DeepSeek mark.
    const logo = mountLogo('dsh');
    expect(getComputedStyle(logo).color).not.toBe('var(--claudian-plus-brand)');
  });
});
