export interface DshProfileModelInfo {
  contextWindow?: number;
  label?: string;
  rawId: string;
}

export interface DshProfileModelCatalog {
  /** llm adapter rows merged across the profile layers. */
  models: DshProfileModelInfo[];
  /** The acp-agent row's route/model pins, when present. */
  acpAgent: { model?: string; provider?: string } | null;
}

interface Line {
  indent: number;
  text: string;
}

function isEntryHeader(text: string): boolean {
  return /^- id:\s*\S/.test(text);
}

function entryId(text: string): string {
  const match = text.match(/^- id:\s*['"]?([^'"\s]+)/);
  return match?.[1] ?? '';
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

/**
 * Best-effort extractor for the DSH cordis patch format. It only pulls model
 * catalog rows (`models:` lists with `- id:` items) and the acp-agent
 * route/model pins, ignoring everything else (including `!!js` tagged values).
 * Any structural surprise degrades to an empty catalog, not a failure.
 */
export function readDshProfileModelCatalog(content: string): DshProfileModelCatalog {
  const lines: Line[] = content
    .split(/\r?\n/)
    .map((raw) => {
      const indentMatch = raw.match(/^(\s*)/);
      return {
        indent: indentMatch?.[1].length ?? 0,
        text: raw.slice(indentMatch?.[1].length ?? 0),
      };
    })
    .filter((line) => line.text.trim().length > 0 && !line.text.trim().startsWith('#'));

  const models: DshProfileModelInfo[] = [];
  let acpAgent: { model?: string; provider?: string } | null = null;
  const seenModelIds = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    if (!isEntryHeader(header.text)) {
      continue;
    }

    const entryStart = index;
    let entryEnd = lines.length;
    for (let next = entryStart + 1; next < lines.length; next += 1) {
      if (isEntryHeader(lines[next].text) && lines[next].indent <= header.indent) {
        entryEnd = next;
        break;
      }
    }

    const region = lines.slice(entryStart, entryEnd);
    const id = entryId(header.text);
    const entryModels = extractModelsFromRegion(region);
    for (const model of entryModels) {
      if (seenModelIds.has(model.rawId)) {
        continue;
      }
      seenModelIds.add(model.rawId);
      models.push(model);
    }

    if (id === 'acp-agent') {
      acpAgent = extractAcpAgentPins(region);
    }

    index = entryEnd - 1;
  }

  models.sort((left, right) => left.rawId.localeCompare(right.rawId));
  return { acpAgent, models };
}

function extractModelsFromRegion(region: Line[]): DshProfileModelInfo[] {
  const results: DshProfileModelInfo[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < region.length; index += 1) {
    const line = region[index];
    if (!/^models:\s*$/.test(line.text)) {
      continue;
    }
    const modelsIndent = line.indent;

    for (let item = index + 1; item < region.length; item += 1) {
      const itemLine = region[item];
      if (itemLine.indent <= modelsIndent) {
        break;
      }
      if (itemLine.indent !== modelsIndent + 2 || !isEntryHeader(itemLine.text)) {
        continue;
      }

      const rawId = entryId(itemLine.text);
      if (!rawId || seen.has(rawId)) {
        continue;
      }

      let label: string | undefined;
      let contextWindow: number | undefined;
      for (let field = item + 1; field < region.length; field += 1) {
        const fieldLine = region[field];
        if (fieldLine.indent <= itemLine.indent) {
          break;
        }
        const nameMatch = fieldLine.text.match(/^name:\s*(.+)$/);
        if (nameMatch) {
          label = unquote(nameMatch[1]);
          continue;
        }
        const windowMatch = fieldLine.text.match(/^contextWindow:\s*(\d+)\s*$/);
        if (windowMatch) {
          contextWindow = Number(windowMatch[1]);
        }
      }

      seen.add(rawId);
      results.push({
        ...(label ? { label } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        rawId,
      });
    }
  }

  return results;
}

function extractAcpAgentPins(region: Line[]): { model?: string; provider?: string } | null {
  let provider: string | undefined;
  let model: string | undefined;

  for (const line of region) {
    const providerMatch = line.text.match(/^provider:\s*(.+)$/);
    if (providerMatch) {
      provider = unquote(providerMatch[1]);
      continue;
    }
    const modelMatch = line.text.match(/^model:\s*(.+)$/);
    if (modelMatch) {
      model = unquote(modelMatch[1]);
    }
  }

  if (provider === undefined && model === undefined) {
    return null;
  }
  return {
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
  };
}
