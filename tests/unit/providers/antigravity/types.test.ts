import type { Conversation } from '@/core/types';
import {
  ANTIGRAVITY_PROVIDER_CAPABILITIES,
  ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
  readAntigravitySessionState,
  writeAntigravitySessionState,
} from '@/providers/antigravity/types';

function createConversation(providerState?: Record<string, unknown>): Conversation {
  return {
    id: 'conversation-1',
    providerId: 'antigravity',
    title: 'Test',
    createdAt: 0,
    updatedAt: 0,
    sessionId: null,
    messages: [],
    ...(providerState ? { providerState } : {}),
  };
}

describe('antigravity session state helpers', () => {
  describe('readAntigravitySessionState', () => {
    it('returns null for a null conversation', () => {
      expect(readAntigravitySessionState(null)).toBeNull();
    });

    it('returns null when no provider state is present', () => {
      expect(readAntigravitySessionState(createConversation())).toBeNull();
    });

    it('reads a valid session binding back', () => {
      const conversation = createConversation();
      writeAntigravitySessionState(conversation, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-1',
        turnCount: 3,
      });

      expect(readAntigravitySessionState(conversation)).toEqual({
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-1',
        turnCount: 3,
      });
    });

    it('returns null for foreign or malformed state bags', () => {
      expect(readAntigravitySessionState(createConversation({ otherProvider: { x: 1 } }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({ antigravitySession: 'nope' }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({
        antigravitySession: { schemaVersion: 0, conversationId: 'conv', turnCount: 1 },
      }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({
        antigravitySession: {
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION + 1,
          conversationId: 'conv',
          turnCount: 1,
        },
      }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({
        antigravitySession: { schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION, conversationId: '', turnCount: 1 },
      }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({
        antigravitySession: {
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
          conversationId: 'conv',
          turnCount: -1,
        },
      }))).toBeNull();
      expect(readAntigravitySessionState(createConversation({
        antigravitySession: {
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
          conversationId: 'conv',
          turnCount: 1.5,
        },
      }))).toBeNull();
    });
  });

  describe('writeAntigravitySessionState', () => {
    it('merges into the provider bag without clobbering unrelated provider keys', () => {
      const conversation = createConversation({ otherProviderState: { keep: true } });
      const bag = writeAntigravitySessionState(conversation, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-2',
        turnCount: 1,
      });

      expect(bag).toEqual({
        otherProviderState: { keep: true },
        antigravitySession: {
          schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
          conversationId: 'conv-2',
          turnCount: 1,
        },
      });
      expect(conversation.providerState).toBe(bag);
    });

    it('round-trips through the reader', () => {
      const conversation = createConversation();
      writeAntigravitySessionState(conversation, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv-3',
        turnCount: 0,
      });
      expect(readAntigravitySessionState(conversation)?.conversationId).toBe('conv-3');
    });

    it('rejects malformed bindings instead of persisting garbage', () => {
      const conversation = createConversation();
      expect(() => writeAntigravitySessionState(conversation, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: '   ',
        turnCount: 0,
      })).toThrow(RangeError);
      expect(() => writeAntigravitySessionState(conversation, {
        schemaVersion: ANTIGRAVITY_SESSION_STATE_SCHEMA_VERSION,
        conversationId: 'conv',
        turnCount: -2,
      })).toThrow(RangeError);
    });
  });

  describe('ANTIGRAVITY_PROVIDER_CAPABILITIES', () => {
    it('stays conservative until protocol evidence lands', () => {
      expect(ANTIGRAVITY_PROVIDER_CAPABILITIES).toMatchObject({
        providerId: 'antigravity',
        supportsPersistentRuntime: false,
        supportsNativeHistory: false,
        supportsPlanMode: false,
        supportsRewind: false,
        supportsFork: false,
        supportsProviderCommands: false,
        supportsImageAttachments: false,
        supportsInstructionMode: false,
        supportsMcpTools: false,
        supportsTurnSteer: false,
        reasoningControl: 'none',
      });
    });
  });
});
