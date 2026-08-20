// Reuse upstream ONBOARDING from tables.js
const UPSTREAM_ONBOARDING = [
  'curious',
  'happy',
  'playful',
  'excited',
  'listening',
  'proud',
  'laughing',
  'shy',
] as const;

export const ONBOARDING_MS = 1200;

export function onboardingMood(n: number): string {
  if (n % 2 === 0) return 'idle';
  const idx = Math.floor((n - 1) / 2) % UPSTREAM_ONBOARDING.length;
  return UPSTREAM_ONBOARDING[idx];
}

export interface WelcomeStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface ConversationLike {
  id: string;
  title: string;
  updatedAt: number;
  providerId?: string;
  preview?: string;
}

const ONBOARDING_KEY = 'blob.onboardingSeen';

export class WelcomeService {
  constructor(private readonly storage: WelcomeStorage) {}

  getRecentConversations(conversations: ConversationLike[]): ConversationLike[] {
    if (!conversations || conversations.length === 0) return [];
    return [...conversations]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3);
  }

  shouldShowOnboarding(): boolean {
    const seen = this.storage.get(ONBOARDING_KEY);
    return seen !== '1';
  }

  markOnboardingSeen(): void {
    this.storage.set(ONBOARDING_KEY, '1');
  }
}
