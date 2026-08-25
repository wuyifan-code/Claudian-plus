import { Menu } from 'obsidian';

import type { ActiveContextObserver } from '../../../core/context/ActiveContextObserver';
import type { AmbientContextSnapshot } from '../../../core/context/types';
import { localeText } from '../../../i18n/i18n';
import type { ComposerContextTray } from '../ui/ComposerContextTray';

export function formatAmbientChipLabel(snapshot: AmbientContextSnapshot): string | null {
  if (snapshot.mode === 'ignored') return null;

  const doc = snapshot.document;
  const focus = snapshot.focus;

  if (!doc && !focus) return null;

  const basename = doc?.basename ?? localeText('当前文档', 'Active Document');
  const prefix = snapshot.mode === 'pinned' ? '📌 ' : '';

  if (focus?.type === 'selection') {
    const range = focus.range ? `L${focus.range.startLine}-L${focus.range.endLine}` : '';
    const charCount = `${focus.content.length} ${localeText('字符', 'chars')}`;
    const details = [range, charCount].filter(Boolean).join(' · ');
    const tag = localeText('焦点: 选区', 'Focus: selection');
    return `${prefix}[${tag}] ${basename}${details ? ` (${details})` : ''}`;
  }

  if (focus?.type === 'section') {
    const heading = focus.heading || (focus.headingPath && focus.headingPath[focus.headingPath.length - 1]) || localeText('章节', 'Section');
    const tag = localeText('焦点: 章节', 'Focus: section');
    return `${prefix}[${tag}] ${basename} (${heading})`;
  }

  if (focus?.type === 'canvas_node') {
    const neighborCount = snapshot.graph?.canvasContext?.neighborNodes.length ?? 0;
    const tag = localeText('焦点: 画布', 'Focus: canvas');
    const countLabel = `${neighborCount + 1} ${localeText('个节点', 'nodes')}`;
    return `${prefix}[${tag}] ${basename} (${countLabel})`;
  }

  if (doc) {
    const tag = localeText('焦点: 文档', 'Focus: doc');
    return `${prefix}[${tag}] ${basename}`;
  }

  return null;
}

export function updateAmbientIndicator(
  contextTray: ComposerContextTray,
  observer: ActiveContextObserver,
  snapshot: AmbientContextSnapshot,
  onVisibilityChange?: () => void,
): void {
  const label = formatAmbientChipLabel(snapshot);

  if (!label || snapshot.mode === 'ignored') {
    contextTray.clearItems('ambient-context');
    onVisibilityChange?.();
    return;
  }

  const icon = snapshot.mode === 'pinned' ? 'pin' : 'crosshair';

  contextTray.setItems('ambient-context', [
    {
      id: 'ambient-context-pill',
      kind: 'ambient',
      label,
      icon,
      title: localeText('点击切换环境感知模式或锁定上下文', 'Click to change ambient focus mode or pin snapshot'),
      ariaLabel: label,
      onActivate: () => {
        showAmbientModeMenu(observer, snapshot);
      },
      onRemove: () => {
        observer.setMode('ignored');
      },
    },
  ]);

  onVisibilityChange?.();
}

function showAmbientModeMenu(observer: ActiveContextObserver, snapshot: AmbientContextSnapshot): void {
  const menu = new Menu();

  menu.addItem((item) => {
    item
      .setTitle(localeText('自动感知（跟随光标与活动视图）', 'Auto focus (follow cursor / leaf)'))
      .setIcon('sparkles')
      .setChecked(snapshot.mode === 'auto')
      .onClick(() => {
        observer.setMode('auto');
      });
  });

  menu.addItem((item) => {
    item
      .setTitle(
        snapshot.mode === 'pinned'
          ? localeText('取消锁定上下文', 'Unpin context')
          : localeText('锁定当前上下文', 'Pin active context'),
      )
      .setIcon('pin')
      .setChecked(snapshot.mode === 'pinned')
      .onClick(() => {
        if (snapshot.mode === 'pinned') {
          observer.unpin();
        } else {
          observer.pin();
        }
      });
  });

  menu.addItem((item) => {
    item
      .setTitle(localeText('忽略 / 静音上下文', 'Ignore / mute context'))
      .setIcon('eye-off')
      .setChecked(snapshot.mode === 'ignored')
      .onClick(() => {
        observer.setMode('ignored');
      });
  });

  const mouseEvent = window.event as MouseEvent | undefined;
  if (mouseEvent && 'clientX' in mouseEvent) {
    menu.showAtMouseEvent(mouseEvent);
  } else {
    menu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  }
}
