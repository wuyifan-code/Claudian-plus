import type { App, EventRef } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';

import { t } from '../../i18n/i18n';

interface FileMenuViewHost {
  appendToActiveInput(text: string): boolean;
}

export interface FileMenuHost {
  readonly app: App;
  activateView(): Promise<void>;
  getView(): FileMenuViewHost | null;
  registerEvent(eventRef: EventRef): void;
  sendPromptToChat(prompt: string): Promise<void>;
}

export async function addFileToClaudianPlus(host: FileMenuHost, file: TFile): Promise<boolean> {
  try {
    await host.activateView();
    const appended = host.getView()?.appendToActiveInput(`@${file.path} `) ?? false;
    if (!appended) new Notice(t('chat.fileMenu.notReady'));
    return appended;
  } catch {
    new Notice(t('chat.fileMenu.failed'));
    return false;
  }
}

export async function addFolderToClaudianPlus(host: FileMenuHost, folder: TFolder): Promise<boolean> {
  try {
    await host.activateView();
    const appended = host.getView()?.appendToActiveInput(`@${folder.path}/ `) ?? false;
    if (!appended) new Notice(t('chat.fileMenu.notReady'));
    return appended;
  } catch {
    new Notice(t('chat.fileMenu.failed'));
    return false;
  }
}

export async function askAboutFile(host: FileMenuHost, file: TFile): Promise<void> {
  await host.sendPromptToChat(
    `I'd like to discuss file "${file.path}"\n\nRead the file and tell me about what it contains and how it connects to my vault.`
  );
}

export async function summarizeFile(host: FileMenuHost, file: TFile): Promise<void> {
  await host.sendPromptToChat(
    `Provide a concise summary of the file "${file.path}".\n\nInclude key topics, structure, and how it relates to other notes.`
  );
}

export async function suggestTagsForFile(host: FileMenuHost, file: TFile): Promise<void> {
  await host.sendPromptToChat(
    `Analyze "${file.path}" and suggest relevant tags and metadata for its frontmatter.\n\nSuggest tags and any other useful properties (status, type, etc.) based on the content.`
  );
}

export function registerFileMenu(host: FileMenuHost): void {
  const workspace = host.app.workspace;
  if (typeof workspace.on !== 'function') return;
  host.registerEvent(workspace.on('file-menu', (menu, file) => {
    if (file instanceof TFolder) {
      menu.addItem(item => item
        .setTitle('Add folder to Claudian Plus')
        .setIcon('folder-open')
        .onClick(() => {
          void addFolderToClaudianPlus(host, file);
        }));
      return;
    }
    if (!(file instanceof TFile)) return;

    // Skip directories by checking for markdown/other files
    menu.addItem(item => item
      .setTitle(t('chat.fileMenu.add'))
      .setIcon('message-square-plus')
      .onClick(() => {
        void addFileToClaudianPlus(host, file);
      }));

    // Only show Agent actions for markdown files
    if (file.extension === 'md') {
      menu.addItem(item => item
        .setTitle('Ask Claudian Plus about this file')
        .setIcon('help-circle')
        .onClick(() => {
          askAboutFile(host, file).catch(() => new Notice('Failed to send ask command'));
        }));

      menu.addItem(item => item
        .setTitle('Summarize with Claudian Plus')
        .setIcon('align-left')
        .onClick(() => {
          summarizeFile(host, file).catch(() => new Notice('Failed to send summarize command'));
        }));

      menu.addItem(item => item
        .setTitle('Suggest tags with Claudian Plus')
        .setIcon('tags')
        .onClick(() => {
          suggestTagsForFile(host, file).catch(() => new Notice('Failed to send tags command'));
        }));
    }
  }));
}
