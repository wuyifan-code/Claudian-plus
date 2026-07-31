export type ObsidianTheme = 'light' | 'dark';

export function getObsidianTheme(ownerDocument: Document): ObsidianTheme {
  return ownerDocument.body.classList.contains('theme-light') ? 'light' : 'dark';
}

export function observeObsidianTheme(
  ownerDocument: Document,
  onChange: (theme: ObsidianTheme) => void,
): () => void {
  const MutationObserverCtor = ownerDocument.defaultView?.MutationObserver;
  if (!MutationObserverCtor) return () => {};

  let currentTheme = getObsidianTheme(ownerDocument);
  const observer = new MutationObserverCtor(() => {
    const nextTheme = getObsidianTheme(ownerDocument);
    if (nextTheme === currentTheme) return;
    currentTheme = nextTheme;
    onChange(nextTheme);
  });
  observer.observe(ownerDocument.body, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}
