import {
  type KimiDiscoveredModel,
  normalizeKimiDiscoveredModels,
} from './models';

function sameKimiDiscoveredModels(
  left: KimiDiscoveredModel[],
  right: KimiDiscoveredModel[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((model, index) => (
    model.rawId === right[index]?.rawId
    && model.label === right[index]?.label
    && (model.description ?? '') === (right[index]?.description ?? '')
  ));
}

const KIMI_DISCOVERY_STATE = Symbol('kimiDiscoveryState');

interface KimiDiscoveryState {
  discoveredModels: KimiDiscoveredModel[];
}

type SettingsBag = Record<string | symbol, unknown>;

function ensureDiscoveryState(settings: Record<string, unknown>): KimiDiscoveryState {
  const bag = settings as SettingsBag;
  const existing = bag[KIMI_DISCOVERY_STATE];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const state = existing as Partial<KimiDiscoveryState>;
    state.discoveredModels ??= [];
    return state as KimiDiscoveryState;
  }

  const next: KimiDiscoveryState = {
    discoveredModels: [],
  };
  bag[KIMI_DISCOVERY_STATE] = next;
  return next;
}

function cloneDiscoveredModels(models: KimiDiscoveredModel[]): KimiDiscoveredModel[] {
  return models.map((model) => ({ ...model }));
}

export function getKimiDiscoveryState(settings: Record<string, unknown>): KimiDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    discoveredModels: cloneDiscoveredModels(state.discoveredModels),
  };
}

export function updateKimiDiscoveryState(
  settings: Record<string, unknown>,
  updates: Partial<KimiDiscoveryState>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextDiscoveredModels = 'discoveredModels' in updates
    ? normalizeKimiDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const changed = !sameKimiDiscoveredModels(state.discoveredModels, nextDiscoveredModels);

  if (!changed) {
    return false;
  }

  state.discoveredModels = cloneDiscoveredModels(nextDiscoveredModels);
  return true;
}

export function clearKimiDiscoveryState(settings: Record<string, unknown>): boolean {
  const state = ensureDiscoveryState(settings);
  if (state.discoveredModels.length === 0) {
    return false;
  }

  state.discoveredModels = [];
  return true;
}

export function seedKimiDiscoveryStateFromLegacyConfig(
  settings: Record<string, unknown>,
  legacyConfig: Record<string, unknown>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextDiscoveredModels = state.discoveredModels.length > 0
    ? state.discoveredModels
    : normalizeKimiDiscoveredModels(legacyConfig.discoveredModels);

  return updateKimiDiscoveryState(settings, { discoveredModels: nextDiscoveredModels });
}
