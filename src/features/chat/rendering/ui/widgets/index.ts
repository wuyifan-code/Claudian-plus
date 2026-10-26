/**
 * Single registry for every generated-UI component.
 *
 * Adding a component means adding a builder module and one entry here; the
 * prompt catalog is checked against this map by the registry-parity test, so
 * the catalog and the renderer cannot drift apart.
 */

import type { WidgetBuilder } from './context';
import { DATA_WIDGETS } from './data';
import { INPUT_WIDGETS } from './inputs';
import { LAYOUT_WIDGETS } from './layout';
import { LEARNING_WIDGETS } from './learning';
import { OBSIDIAN_WIDGETS } from './obsidian';
import { STRUCTURE_WIDGETS } from './structure';
import { TEXT_WIDGETS } from './text';

export const WIDGETS: Record<string, WidgetBuilder> = {
  ...LAYOUT_WIDGETS,
  ...TEXT_WIDGETS,
  ...DATA_WIDGETS,
  ...INPUT_WIDGETS,
  ...STRUCTURE_WIDGETS,
  ...LEARNING_WIDGETS,
  ...OBSIDIAN_WIDGETS,
};
