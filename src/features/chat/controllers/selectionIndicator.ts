import type { ComposerContextSlot, ComposerContextTray } from '../ui/ComposerContextTray';

export interface SelectionIndicatorChip {
  id: string;
  label: string;
  icon: string;
}

/**
 * Renders or clears a selection chip in the composer context tray.
 * Selection controllers share this tray plumbing.
 */
export function setSelectionIndicator(
  contextTray: ComposerContextTray,
  slot: ComposerContextSlot,
  chip: SelectionIndicatorChip | null,
  onRemove: () => void,
  onVisibilityChange?: () => void,
): void {
  if (chip) {
    contextTray.setItems(slot, [{
      id: chip.id,
      kind: 'selection',
      label: chip.label,
      icon: chip.icon,
      ariaLabel: chip.label,
      onRemove,
    }]);
  } else {
    contextTray.clearItems(slot);
  }
  onVisibilityChange?.();
}
