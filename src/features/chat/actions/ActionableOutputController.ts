import { activeDocument, type App, type Editor, MarkdownView, Notice, type TFile } from 'obsidian';

import type { AmbientFocusContext } from '../../../core/context/types';
import { localeText } from '../../../i18n/i18n';
import { DiffReviewModal } from './DiffReviewModal';

interface WorkspaceWithLeaf {
  activeLeaf?: {
    view?: {
      editor?: Editor;
      file?: TFile;
    };
  };
}

export function getActiveMarkdownEditor(app: App): Editor | null {
  // 1. Direct active view
  const activeView = app.workspace?.getActiveViewOfType?.(MarkdownView);
  if (activeView?.editor) {
    return activeView.editor;
  }

  // 2. Most recent active leaf (before focus moved to sidebar)
  const mostRecent = app.workspace?.getMostRecentLeaf?.();
  if (mostRecent?.view instanceof MarkdownView && mostRecent.view.editor) {
    return mostRecent.view.editor;
  }

  // 3. Fallback: workspace activeLeaf
  const workspace = app.workspace as unknown as WorkspaceWithLeaf | undefined;
  if (workspace?.activeLeaf?.view?.editor) {
    return workspace.activeLeaf.view.editor;
  }

  // 4. Fallback: open markdown leaves matching getActiveFile()
  const activeFile = app.workspace?.getActiveFile?.();
  const markdownLeaves = app.workspace?.getLeavesOfType?.('markdown') ?? [];
  if (activeFile) {
    for (const leaf of markdownLeaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === activeFile.path && view.editor) {
        return view.editor;
      }
    }
  }

  // 5. Fallback: first available markdown editor in workspace
  for (const leaf of markdownLeaves) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.editor) {
      return view.editor;
    }
  }

  return null;
}

export function getActiveMarkdownFile(app: App): TFile | null {
  const activeFile = app.workspace?.getActiveFile?.();
  if (activeFile) return activeFile;

  const activeView = app.workspace?.getActiveViewOfType?.(MarkdownView);
  if (activeView?.file) return activeView.file;

  const mostRecent = app.workspace?.getMostRecentLeaf?.();
  if (mostRecent?.view instanceof MarkdownView && mostRecent.view.file) {
    return mostRecent.view.file;
  }

  const workspace = app.workspace as unknown as WorkspaceWithLeaf | undefined;
  if (workspace?.activeLeaf?.view?.file) return workspace.activeLeaf.view.file;

  const markdownLeaves = app.workspace?.getLeavesOfType?.('markdown') ?? [];
  for (const leaf of markdownLeaves) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file) {
      return view.file;
    }
  }

  return null;
}

export function getSelectedTextWithin(container: HTMLElement): string | null {
  const doc = container.ownerDocument ?? (typeof activeDocument !== 'undefined' ? activeDocument : null);
  const selection = doc?.defaultView?.getSelection?.() ?? (typeof window !== 'undefined' ? window.getSelection?.() : null);
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  try {
    const range = selection.getRangeAt(0);
    const common = range.commonAncestorContainer;

    const intersects =
      container.contains(common) ||
      container.contains(range.startContainer) ||
      container.contains(range.endContainer) ||
      (common.nodeType === 1 && (common as HTMLElement).contains(container));

    if (!intersects) {
      return null;
    }

    const text = selection.toString().trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export interface ActionableOutputOptions {
  isSelection?: boolean;
  customNotice?: string;
}

export function insertAtCursor(
  app: App,
  text: string,
  options?: ActionableOutputOptions,
): boolean {
  const editor = getActiveMarkdownEditor(app);
  if (!editor) {
    new Notice(localeText('未找到活动的编辑器来插入内容。', 'No active editor found to insert content.'));
    return false;
  }

  const cursor = editor.getCursor();
  editor.replaceRange(text, cursor);

  // Move cursor to the end of inserted content
  const lines = text.split('\n');
  const endLine = cursor.line + lines.length - 1;
  const endCh = lines.length === 1 ? cursor.ch + text.length : lines[lines.length - 1].length;
  editor.setCursor({ line: endLine, ch: endCh });

  const defaultNotice = options?.isSelection
    ? localeText('已插入选区到光标处', 'Inserted selection at cursor')
    : localeText('已插入到光标处', 'Inserted at cursor');
  new Notice(options?.customNotice ?? defaultNotice);
  return true;
}

export function insertCodeBlockAtCursor(app: App, code: string, lang?: string): boolean {
  const cleanCode = code.replace(/\r\n/g, '\n');
  const codeBlock = lang?.trim()
    ? `\`\`\`${lang.trim()}\n${cleanCode}\n\`\`\`\n`
    : `\`\`\`\n${cleanCode}\n\`\`\`\n`;

  return insertAtCursor(app, codeBlock, {
    isSelection: true,
    customNotice: localeText('已插入代码块到光标处', 'Inserted code block at cursor'),
  });
}

export function replaceSelection(
  app: App,
  text: string,
  focusContext?: AmbientFocusContext | null,
  options?: ActionableOutputOptions,
): boolean {
  const editor = getActiveMarkdownEditor(app);
  if (!editor) {
    new Notice(localeText('未找到活动的编辑器来替换内容。', 'No active editor found to replace content.'));
    return false;
  }

  const selection = editor.getSelection();
  if (selection && selection.length > 0) {
    editor.replaceSelection(text);
    const notice = options?.customNotice ?? (
      options?.isSelection
        ? localeText('已用选区替换笔记内容', 'Replaced with selection')
        : localeText('已替换选区内容', 'Replaced active selection')
    );
    new Notice(notice);
    return true;
  }

  if (focusContext?.range) {
    const from = { line: Math.max(0, focusContext.range.startLine - 1), ch: 0 };
    const to = { line: Math.min(editor.lineCount() - 1, focusContext.range.endLine), ch: 0 };
    editor.replaceRange(text, from, to);
    new Notice(options?.customNotice ?? localeText('已替换当前章节内容', 'Replaced focused section'));
    return true;
  }

  // Fallback: replace whole document or insert at cursor
  editor.setValue(text);
  new Notice(options?.customNotice ?? localeText('已替换文档内容', 'Replaced document content'));
  return true;
}

export async function createLinkedNote(
  app: App,
  text: string,
  titleHint?: string,
): Promise<string | null> {
  let title = titleHint?.trim();

  if (!title) {
    // Extract first markdown header
    const headerMatch = text.match(/^#+\s+(.+)$/m);
    if (headerMatch && headerMatch[1]) {
      title = headerMatch[1].trim();
    } else {
      // First non-empty line
      const firstLine = text.trim().split('\n')[0] ?? '';
      title = firstLine.replace(/^[#*`\- >]+/, '').trim();
    }
  }

  if (title && title.length > 40) {
    title = title.slice(0, 40).trim();
  }

  // Sanitize filename
  if (title) {
    title = title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
  }

  if (!title) {
    title = `Note-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  const activeFile = getActiveMarkdownFile(app);
  const parentFolder = activeFile?.parent?.path ?? '';
  const basePath = parentFolder ? `${parentFolder}/${title}` : title;

  let finalPath = `${basePath}.md`;
  let counter = 1;
  while (app.vault.getAbstractFileByPath(finalPath)) {
    finalPath = `${basePath} (${counter++}).md`;
  }

  try {
    const newFile = await app.vault.create(finalPath, text);

    // Open newly created note
    const leaf = app.workspace.getLeaf('tab');
    if (leaf) {
      await leaf.openFile(newFile);
    }

    new Notice(localeText(`已创建笔记：${newFile.basename}`, `Created note: ${newFile.basename}`));
    return newFile.path;
  } catch (error) {
    new Notice(localeText(`创建笔记失败：${String(error)}`, `Failed to create note: ${String(error)}`));
    return null;
  }
}

export function openDiffReview(
  app: App,
  newContent: string,
  oldContentOverride?: string,
): boolean {
  const editor = getActiveMarkdownEditor(app);
  const activeFile = getActiveMarkdownFile(app);

  const oldContent = oldContentOverride ?? editor?.getValue() ?? '';
  const filePath = activeFile?.path;

  const modal = new DiffReviewModal({
    app,
    filePath,
    oldContent,
    newContent,
    onApply: (appliedContent: string) => {
      if (editor) {
        editor.setValue(appliedContent);
        new Notice(localeText('已将更改应用到文档', 'Applied changes to document'));
      } else if (activeFile) {
        void app.vault.modify(activeFile, appliedContent).then(() => {
          new Notice(localeText('已将更改应用到文件', 'Applied changes to file'));
        });
      }
    },
  });

  modal.open();
  return true;
}
