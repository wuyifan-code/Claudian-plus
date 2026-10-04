/**
 * Claudian Plus Dream Memory V2 - Unified Memory System Types
 * Based on .context/memory-v2-design-2026-09-22.md
 */

export type MemoryKind = 'profile' | 'project_state' | 'lesson';

export type MemoryStatus =
  | 'candidate'
  | 'active'
  | 'contested'
  | 'superseded'
  | 'archived';

export type MemoryBasis = 'explicit' | 'observed' | 'inferred' | 'legacy';

export type EvidenceSourceClass = 'user' | 'tool_result' | 'assistant' | 'import';

export interface EvidenceRef {
  rootEventId: string;
  eventRevision: string;
  providerId: string;
  conversationId: string;
  messageId: string;
  span: { start: number; end: number };
  sourceClass: EvidenceSourceClass;
}

export interface MemoryScope {
  vaultId: string;
  projectId?: string;
  taskId?: string;
}

export interface MemoryRecord {
  id: string;
  revision: number;
  kind: MemoryKind;
  scope: MemoryScope;
  claimKey: string;
  content: string;
  status: MemoryStatus;
  basis: MemoryBasis;
  evidence: EvidenceRef[];
  observedAt: number;
  validFrom?: number;
  validUntil?: number;
  reviewAfter?: number;
  supersedes: string[];
  conditions?: string[];
  outcome?: 'succeeded' | 'failed' | 'unknown';
}

export interface EpisodeToolCall {
  name: string;
  args?: unknown;
  result?: unknown;
  status?: string;
}

export interface EpisodeRecord {
  id: string; // rootEventId
  revision: string;
  providerId: string;
  conversationId: string;
  messageId: string;
  timestamp: number;
  role: 'user' | 'assistant' | 'tool_result';
  content: string;
  scope: MemoryScope & { activeFilePath?: string };
  toolCalls?: EpisodeToolCall[];
}

export type DreamJobReason = 'turn_completion' | 'scheduled' | 'manual' | 'startup';

export type DreamJobStatus = 'queued' | 'running' | 'deferred' | 'succeeded' | 'failed';

export type DreamJobDeferredReason =
  | 'saving-mode'
  | 'daily-limit'
  | 'busy'
  | 'provider-unavailable';

export interface DreamJob {
  id: string;
  reason: DreamJobReason;
  status: DreamJobStatus;
  deferredReason?: DreamJobDeferredReason;
  stage: number;
  attempt: number;
  nextEligibleAt: number;
  lease?: {
    owner: string;
    expiresAt: number;
  };
  inputEventRange: {
    fromEventId?: string;
    toEventId?: string;
    eventCount: number;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CheckpointsState {
  lastAdjudicatedEventId?: string;
  lastAdjudicatedTimestamp?: number;
  adjudicatedEventCount: number;
  version: number;
}

export interface ForgetEntry {
  id: string;
  claimKey?: string;
  rootEventId?: string;
  contentHash?: string;
  reason: string;
  createdAt: number;
}

export type MemoryFeedbackType =
  | 'exposed'
  | 'referenced'
  | 'user_confirmed'
  | 'verified_outcome'
  | 'corrected'
  | 'dismissed';

export interface MemoryFeedbackRecord {
  id: string;
  memoryId: string;
  memoryRevision: number;
  turnId: string;
  type: MemoryFeedbackType;
  timestamp: number;
  details?: string;
}

export interface MemoryContextRequest {
  vaultId: string;
  projectId?: string;
  taskId?: string;
  userPrompt: string;
  activeFilePaths: string[];
  now: number;
  maxTokens: number;
}

export interface MemoryRecallEntry {
  id: string;
  revision: number;
  reason: string;
  kind: MemoryKind;
  claimKey: string;
  content: string;
}

export interface MemoryContextPacket {
  revision: string;
  forgetLedgerRevision: string;
  text: string;
  estimatedTokens: number;
  traceId: string;
  entries: MemoryRecallEntry[];
}

export type DreamProposalAction =
  | 'add'
  | 'merge'
  | 'supersede'
  | 'contest'
  | 'archive'
  | 'no_op';

export interface DreamProposal {
  action: DreamProposalAction;
  targetId?: string;
  kind: MemoryKind;
  claimKey: string;
  content: string;
  scope: MemoryScope;
  basis?: MemoryBasis;
  evidence: EvidenceRef[];
  conditions?: string[];
  outcome?: 'succeeded' | 'failed' | 'unknown';
  validFrom?: number;
  validUntil?: number;
  reviewAfter?: number;
}

export interface GenerationMetadata {
  revision: string;
  createdAt: number;
  recordCount: number;
  checksum: string;
}

export interface CurrentPointer {
  currentRevision: string;
  updatedAt: number;
  writerFencingToken: string;
}
