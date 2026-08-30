import type { MindStore } from './MindStore';

/** A single memory entry extracted from user conversations. */
export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  source: 'user-explicit' | 'user-implicit';
  createdAt: number;
  updatedAt: number;
}

/** Result from the memory extraction process. */
export interface MemoryExtractionResult {
  entries: MemoryEntry[];
}

/** Options for the memory store. */
export interface MemoryStoreOptions {
  filePath: string;
  maxInjectionChars: number;
  getMindStore?: () => MindStore | null;
}

/** Default path for the memory file within the vault. */
export const DEFAULT_MEMORY_FILE_PATH = '.claudian-plus/memory.md';
export const LEGACY_MEMORY_FILE_PATH = '.claudian/memory.md';

/** Default maximum characters to inject into system prompt. */
export const DEFAULT_MEMORY_MAX_INJECTION_CHARS = 1500;

/** Per-layer sub-caps within the total injection budget. */
export const DEFAULT_MEMORY_MAX_GLOBAL_INJECTION_CHARS = 350;
export const DEFAULT_MEMORY_MAX_PROJECT_INJECTION_CHARS = 500;

/** Template header written when creating a new memory file. */
export const MEMORY_FILE_TEMPLATE = `# Claudian Plus Memory

This file stores long-term user preferences and context extracted from conversations.
You can edit this file directly to add, modify, or remove memories.

## User Preferences

## Project Context

`;
