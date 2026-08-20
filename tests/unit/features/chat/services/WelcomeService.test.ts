import { ONBOARDING_MS, onboardingMood,WelcomeService } from '@/features/chat/services/WelcomeService';

describe('WelcomeService', () => {
  it('returns empty when no conversations', () => {
    const svc = new WelcomeService({ get: () => null, set: () => {} });
    expect(svc.getRecentConversations([])).toEqual([]);
  });

  it('returns 3 most recent sorted by lastActive desc', () => {
    const svc = new WelcomeService({ get: () => null, set: () => {} });
    const convs = [
      { id: 'a', title: 'A', updatedAt: 100 },
      { id: 'b', title: 'B', updatedAt: 300 },
      { id: 'c', title: 'C', updatedAt: 200 },
      { id: 'd', title: 'D', updatedAt: 400 },
      { id: 'e', title: 'E', updatedAt: 50 },
    ];
    const recent = svc.getRecentConversations(convs as unknown as Parameters<typeof svc.getRecentConversations>[0]);
    expect(recent.map((c) => c.id)).toEqual(['d', 'b', 'c']);
  });

  it('shouldShowOnboarding false when flag seen', () => {
    const svc = new WelcomeService({ get: () => '1', set: () => {} });
    expect(svc.shouldShowOnboarding()).toBe(false);
  });

  it('shouldShowOnboarding true on first install', () => {
    const svc = new WelcomeService({ get: () => null, set: () => {} });
    expect(svc.shouldShowOnboarding()).toBe(true);
  });

  it('markOnboardingSeen persists', () => {
    const store = new Map<string, string>();
    const svc = new WelcomeService({
      get: (k: string) => store.get(k) ?? null,
      set: (k: string, v: string) => store.set(k, v),
    });
    svc.markOnboardingSeen();
    expect(store.get('blob.onboardingSeen')).toBe('1');
    expect(svc.shouldShowOnboarding()).toBe(false);
  });

  it('onboardingMood(0)=idle, 1=curious, 2=idle, 3=happy', () => {
    expect(onboardingMood(0)).toBe('idle');
    expect(onboardingMood(1)).toBe('curious');
    expect(onboardingMood(2)).toBe('idle');
    expect(onboardingMood(3)).toBe('happy');
    expect(onboardingMood(5)).toBe('playful');
    expect(onboardingMood(7)).toBe('excited');
  });

  it('ONBOARDING_MS=1200', () => {
    expect(ONBOARDING_MS).toBe(1200);
  });
});
