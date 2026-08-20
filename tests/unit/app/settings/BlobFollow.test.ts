import { DEFAULT_CLAUDIAN_PLUS_SETTINGS } from '@/app/settings/defaultSettings';

describe('blob follow setting', () => {
  it('defaults to true', () => {
    expect(DEFAULT_CLAUDIAN_PLUS_SETTINGS.blobFollowPointer).toBe(true);
  });
});
