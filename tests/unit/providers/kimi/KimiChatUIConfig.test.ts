import { kimiChatUIConfig } from '@/providers/kimi/ui/KimiChatUIConfig';
import { KIMI_PROVIDER_ICON } from '@/shared/icons';

describe('KimiChatUIConfig', () => {
  it('exposes the Kimi provider icon', () => {
    expect(kimiChatUIConfig.getProviderIcon?.()).toBe(KIMI_PROVIDER_ICON);
  });

  it('exposes no permission-mode toggle (single default ACP mode)', () => {
    expect(kimiChatUIConfig.getPermissionModeToggle?.()).toBeNull();
  });

  it('owns only kimi selection ids', () => {
    const settings: Record<string, unknown> = { providerConfigs: {} };
    expect(kimiChatUIConfig.ownsModel('kimi:k3', settings)).toBe(true);
    expect(kimiChatUIConfig.ownsModel('kimi', settings)).toBe(true);
    expect(kimiChatUIConfig.ownsModel('claude-code/opus', settings)).toBe(false);
  });
});
