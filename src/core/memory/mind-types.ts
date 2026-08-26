/**
 * Types and schema for Dreaming V3 Mind & Habit Engine.
 */

export type MindCategory =
  | 'user_preference'   // Core user preference (e.g., language, brevity, tone)
  | 'coding_habit'      // Coding/development habit (e.g., pnpm, functional style, TDD)
  | 'project_rule'      // Project-specific architecture constraint (e.g., provider isolation)
  | 'correction_rule';  // Explicit user correction/lesson learned

export type MindTemporalState =
  | 'active'       // Currently valid and active
  | 'planned'      // Planned/upcoming state
  | 'completed'    // Completed/fulfilled milestone
  | 'stale';       // Stale or superseded

export type MindScope = 'global' | 'project';

/**
 * A durable, long-term mind entry that has been accepted or manually configured.
 */
export interface DurableMindEntry {
  id: string;
  category: MindCategory;
  scope: MindScope;
  state: MindTemporalState;
  content: string;
  confidence: number;          // 0.0 ~ 1.0 confidence level
  lastUsedAt: number;          // Timestamp when this rule was last recalled/used
  createdAt: number;
  updatedAt: number;
  matchPatterns?: string[];    // Glob/regex file path patterns (e.g. "src/providers/**")
  tags: string[];              // Keyword tags for dynamic recall (e.g. ["provider", "test"])
  rationale?: string;          // Source or reasoning
}

/**
 * A staging mind entry waiting for user review in the settings tab.
 */
export interface StagingMindEntry {
  id: string;
  category: MindCategory;
  scope: MindScope;
  content: string;
  rationale: string;           // Why the micro-dream inferred this rule
  sourceSessionId: string;
  createdAt: number;
  confidence: number;
}

export interface MindStoreData {
  version: number;
  entries: DurableMindEntry[];
}

export interface StagingStoreData {
  version: number;
  entries: StagingMindEntry[];
}
