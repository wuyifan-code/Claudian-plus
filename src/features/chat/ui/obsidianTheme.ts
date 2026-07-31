export type ObsidianTheme = 'light' | 'dark';

function colorChannelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function themeFromCssColor(color: string): ObsidianTheme | null {
  const normalized = color.trim().toLowerCase();
  let channels: number[] | null = null;

  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)?.[1];
  if (hex) {
    const rgb = hex.length === 3
      ? hex.split('').map((channel) => Number.parseInt(channel + channel, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]
        .map((channel) => Number.parseInt(channel, 16));
    channels = rgb;
  } else {
    const rgb = normalized.match(
      /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
    );
    if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0.01)) {
      channels = rgb.slice(1, 4).map(Number);
    }
  }

  if (!channels || channels.some((channel) => !Number.isFinite(channel))) return null;

  const [red, green, blue] = channels.map(colorChannelToLinear);
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.32 ? 'light' : 'dark';
}

function getRenderedTheme(ownerDocument: Document): ObsidianTheme | null {
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow) return null;

  for (const root of [ownerDocument.body, ownerDocument.documentElement]) {
    if (!root) continue;
    const style = ownerWindow.getComputedStyle(root);
    const colors = [
      style.getPropertyValue('--background-primary'),
      style.backgroundColor,
    ];
    for (const color of colors) {
      const theme = themeFromCssColor(color);
      if (theme) return theme;
    }
  }

  return null;
}

export function getObsidianTheme(ownerDocument: Document): ObsidianTheme {
  const renderedTheme = getRenderedTheme(ownerDocument);
  if (renderedTheme) return renderedTheme;

  const themeRoots = [ownerDocument.body, ownerDocument.documentElement];

  for (const root of themeRoots) {
    if (root?.classList.contains('theme-light') || root?.dataset.theme === 'light') {
      return 'light';
    }
    if (root?.classList.contains('theme-dark') || root?.dataset.theme === 'dark') {
      return 'dark';
    }
  }

  return ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function observeObsidianTheme(
  ownerDocument: Document,
  onChange: (theme: ObsidianTheme) => void,
): () => void {
  const ownerWindow = ownerDocument.defaultView;
  const MutationObserverCtor = ownerDocument.defaultView?.MutationObserver;
  let currentTheme = getObsidianTheme(ownerDocument);

  const notifyIfChanged = (): void => {
    const nextTheme = getObsidianTheme(ownerDocument);
    if (nextTheme === currentTheme) return;
    currentTheme = nextTheme;
    onChange(nextTheme);
  };

  const observer = MutationObserverCtor
    ? new MutationObserverCtor(notifyIfChanged)
    : null;

  if (observer) {
    const observerOptions: MutationObserverInit = {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    };
    observer.observe(ownerDocument.documentElement, observerOptions);
    if (ownerDocument.body) observer.observe(ownerDocument.body, observerOptions);
  }

  const colorScheme = ownerWindow?.matchMedia?.('(prefers-color-scheme: light)');
  colorScheme?.addEventListener?.('change', notifyIfChanged);

  return () => {
    observer?.disconnect();
    colorScheme?.removeEventListener?.('change', notifyIfChanged);
  };
}
