/**
 * Micro-dream prompt contract.
 *
 * Session-end micro-dreams analyze the conversation trajectory and synthesize
 * memory proposals that land in the V2 candidate review queue. The model
 * output is machine-parseable JSON, so every part of this contract is kept
 * symmetric with `parseMicroDreamResponse`.
 */

import type { MindCategory, MindScope } from '../memory/mind-types';

function extractJsonBlock(responseText: string): string | null {
  const match = responseText.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

export interface MicroDreamRuleProposal {
  category: MindCategory;
  scope: MindScope;
  content: string;
  rationale: string;
  confidence: number;
}

export interface MicroDreamResult {
  rules: MicroDreamRuleProposal[];
}

export const EMPTY_MICRO_DREAM_RESULT: MicroDreamResult = {
  rules: [],
};

export const MICRO_DREAM_SYSTEM_PROMPT = `You are the Micro-Dream Mind Engine of Claudian Plus.
Your task is to analyze the recent conversation session and synthesize durable user habits, project architectural conventions, and explicit user corrections.

**Classification Rules:**
1. "user_preference": Universal personal preference (e.g. language, brevity, formatting style). scope should be "global".
2. "coding_habit": Technical/engineering habit (e.g. pnpm, functional TypeScript, TDD). scope can be "global" or "project".
3. "project_rule": Vault/Project-specific architectural constraint or directory rules. scope MUST be "project".
4. "correction_rule": Explicit corrections where the user corrected the assistant on a mistake or taboo. scope can be "global" or "project".

**Guidelines:**
- Only extract stable, high-confidence rules (confidence 0.6 - 1.0).
- Ignore one-off conversation chatter, transient bug fixing details, and trivial pleasantries.
- Provide a brief rationale explaining the source or evidence.
- Format the output strictly as JSON.

**Output JSON Structure:**
{
  "rules": [
    {
      "category": "user_preference",
      "scope": "global",
      "content": "Prefers concise code without excessive comments",
      "rationale": "User instructed: 'Keep code concise and avoid comments explaining the obvious'",
      "confidence": 0.95
    }
  ]
}`;

export interface MicroDreamPromptInput {
  trajectoryText: string;
  existingRulesText: string;
  projectContext?: string;
  maxChars?: number;
}

export function buildMicroDreamPrompt(input: MicroDreamPromptInput): string {
  const cap = input.maxChars ?? 6000;
  const boundedTrajectory = input.trajectoryText.length > cap
    ? `${input.trajectoryText.slice(0, cap)}...`
    : input.trajectoryText;

  return [
    'Analyze the following session trajectory and extract durable mind rules.',
    '',
    '=== SESSION TRAJECTORY ===',
    boundedTrajectory || '(empty)',
    '',
    '=== CURRENT ACTIVE RULES ===',
    input.existingRulesText || '(none)',
    '',
    input.projectContext ? `=== PROJECT CONTEXT ===\n${input.projectContext}\n` : '',
    'Return durable rules following the system prompt schema.',
  ].join('\n');
}

export function parseMicroDreamResponse(responseText: string): MicroDreamResult {
  const jsonBlock = extractJsonBlock(responseText);
  if (!jsonBlock) {
    return EMPTY_MICRO_DREAM_RESULT;
  }

  try {
    const parsed = JSON.parse(jsonBlock) as { rules?: unknown[] };
    if (!Array.isArray(parsed.rules)) {
      return EMPTY_MICRO_DREAM_RESULT;
    }

    const validCategories: MindCategory[] = [
      'user_preference',
      'coding_habit',
      'project_rule',
      'correction_rule',
    ];
    const rules: MicroDreamRuleProposal[] = [];

    for (const raw of parsed.rules) {
      if (raw && typeof raw === 'object') {
        const item = raw as Record<string, unknown>;
        const category = String(item.category ?? '').trim() as MindCategory;
        const scope = (item.scope === 'global' ? 'global' : 'project');
        const content = String(item.content ?? '').trim();
        const rationale = String(item.rationale ?? '').trim();
        const confidence = typeof item.confidence === 'number'
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.8;

        if (validCategories.includes(category) && content) {
          rules.push({
            category,
            scope,
            content,
            rationale: rationale || 'Inferred from session',
            confidence,
          });
        }
      }
    }

    return { rules };
  } catch {
    return EMPTY_MICRO_DREAM_RESULT;
  }
}
