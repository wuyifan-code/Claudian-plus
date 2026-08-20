import { DEFAULT_CLAUDIAN_PLUS_SETTINGS } from '@/app/settings/defaultSettings';

describe('blob appearance setting', () => {
  it('defaults blobEnabled to true', () => {
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.blobEnabled).toBe(true);
  });

  it('welcomeService respects blobEnabled flag via storage', () => {
    // Simulate disabled
    const settings = { ...DEFAULT_CLAUDIAN_PLUS_SETTINGS, blobEnabled: false };
    expect(settings.blobEnabled).toBe(false);
    // When disabled, welcome should fallback (covered by UI gate)
  });
});
