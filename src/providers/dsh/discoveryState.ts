import {
  type DshDiscoveredModel,
  normalizeDshDiscoveredModels,
} from './models';

function sameDiscoveredModels(
  left: DshDiscoveredModel[],
  right: DshDiscoveredModel[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((model, index) => (
    model.rawId === right[index]?.rawId
    && (model.label ?? '') === (right[index]?.label ?? '')
    && (model.contextWindow ?? 0) === (right[index]?.contextWindow ?? 0)
  ));
}

interface DshDiscoveryState {
  discoveredModels: DshDiscoveredModel[];
}

function ensureDiscoveryState(settings: Record<string, unknown>): DshDiscoveryState {
  const existing = settings.dshDiscoveryState as Partial<DshDiscoveryState> | undefined;
  if (existing && Array.isArray(existing.discoveredModels)) {
    return existing as DshDiscoveryState;
  }

  const next: DshDiscoveryState = { discoveredModels: [] };
  settings.dshDiscoveryState = next;
  return next;
}

function cloneDiscoveredModels(models: DshDiscoveredModel[]): DshDiscoveredModel[] {
  return models.map((model) => ({ ...model }));
}

export function getDshDiscoveryState(settings: Record<string, unknown>): DshDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    discoveredModels: cloneDiscoveredModels(state.discoveredModels),
  };
}

export function updateDshDiscoveryState(
  settings: Record<string, unknown>,
  updates: { discoveredModels?: DshDiscoveredModel[] },
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextDiscoveredModels = updates.discoveredModels !== undefined
    ? normalizeDshDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const changed = !sameDiscoveredModels(state.discoveredModels, nextDiscoveredModels);
  if (changed) {
    state.discoveredModels = nextDiscoveredModels;
  }
  return changed;
}

export function clearDshDiscoveryState(settings: Record<string, unknown>): boolean {
  const state = ensureDiscoveryState(settings);
  if (state.discoveredModels.length === 0) {
    return false;
  }
  state.discoveredModels = [];
  return true;
}
