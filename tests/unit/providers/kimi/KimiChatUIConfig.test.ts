import { kimiChatUIConfig } from '@/providers/kimi/ui/KimiChatUIConfig';
import { KIMI_PROVIDER_ICON } from '@/shared/icons';

describe('KimiChatUIConfig', () => {
  it('exposes the Kimi provider icon', () => {
    expect(kimiChatUIConfig.getProviderIcon?.()).toBe(KIMI_PROVIDER_ICON);
  });

  it('exposes the Safe/YOLO permission-mode toggle', () => {
    expect(kimiChatUIConfig.getPermissionModeToggle?.()).toEqual({
      activeLabel: 'YOLO',
      activeValue: 'yolo',
      inactiveLabel: 'Safe',
      inactiveValue: 'normal',
    });
  });

  it('owns only kimi selection ids', () => {
    const settings: Record<string, unknown> = { providerConfigs: {} };
    expect(kimiChatUIConfig.ownsModel('kimi:k3', settings)).toBe(true);
    expect(kimiChatUIConfig.ownsModel('kimi', settings)).toBe(true);
    expect(kimiChatUIConfig.ownsModel('claude-code/opus', settings)).toBe(false);
  });
});
