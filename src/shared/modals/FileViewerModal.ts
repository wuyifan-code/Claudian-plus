import * as fs from 'fs';
import type { App} from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';
import * as path from 'path';

export interface FileViewerTarget {
  label: string;
  path: string;
}

interface ElectronShellApi {
  shell: {
    openPath: (path: string) => Promise<string>;
    showItemInFolder: (path: string) => void;
  };
}

export class FileViewerModal extends Modal {
  private targets: FileViewerTarget[];
  private activeIndex = 0;
  private textAreaEl!: HTMLTextAreaElement;
  private pathDescEl!: HTMLElement;

  private modalTitle: string;

  constructor(app: App, title: string, targets: FileViewerTarget[]) {
    super(app);
    this.modalTitle = title;
    this.targets = targets;
  }

  onOpen(): void {
    this.setTitle(this.modalTitle);
    this.modalEl.addClass('claudian-plus-file-viewer-modal');

    if (this.targets.length > 1) {
      const tabGroup = this.contentEl.createDiv({ cls: 'claudian-plus-file-viewer-tabs' });
      this.targets.forEach((target, index) => {
        const btn = tabGroup.createEl('button', {
          cls: `claudian-plus-file-viewer-tab-btn${index === this.activeIndex ? ' active' : ''}`,
          text: target.label,
        });
        btn.addEventListener('click', () => {
          this.activeIndex = index;
          tabGroup.querySelectorAll('.claudian-plus-file-viewer-tab-btn').forEach((el, i) => {
            el.classList.toggle('active', i === index);
          });
          this.loadFileContent();
        });
      });
    }

    this.pathDescEl = this.contentEl.createDiv({ cls: 'claudian-plus-file-viewer-path' });

    this.textAreaEl = this.contentEl.createEl('textarea', {
      cls: 'claudian-plus-file-viewer-textarea',
    });
    this.textAreaEl.rows = 16;

    this.loadFileContent();

    const setting = new Setting(this.contentEl);

    // Button 1: Save Changes
    setting.addButton((btn) =>
      btn
        .setButtonText('保存修改')
        .setCta()
        .onClick(() => {
          const currentTarget = this.targets[this.activeIndex];
          if (!currentTarget) return;
          try {
            const newContent = this.textAreaEl.value;
            fs.writeFileSync(currentTarget.path, newContent, 'utf-8');
            new Notice('文件已成功保存！');
          } catch (err) {
            new Notice(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        })
    );

    // Button 2: Open with System Editor
    setting.addButton((btn) =>
      btn
        .setButtonText('用系统程序打开')
        .onClick(() => {
          const currentTarget = this.targets[this.activeIndex];
          if (!currentTarget) return;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is exposed only at runtime in Obsidian's renderer.
            const { shell } = require('electron') as ElectronShellApi;
            void shell.openPath(currentTarget.path);
          } catch (err) {
            new Notice(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        })
    );

    // Button 3: Reveal in File Explorer
    setting.addButton((btn) =>
      btn
        .setButtonText('在资源管理器中显示')
        .onClick(() => {
          const currentTarget = this.targets[this.activeIndex];
          if (!currentTarget) return;
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron shell is exposed only at runtime in Obsidian's renderer.
            const { shell } = require('electron') as ElectronShellApi;
            shell.showItemInFolder(currentTarget.path);
          } catch (err) {
            new Notice(`定位失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        })
    );
  }

  private loadFileContent(): void {
    const currentTarget = this.targets[this.activeIndex];
    if (!currentTarget) return;

    this.pathDescEl.setText(currentTarget.path);

    try {
      const dir = path.dirname(currentTarget.path);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(currentTarget.path)) {
        this.textAreaEl.value = '（文件暂未创建）';
        return;
      }
      const content = fs.readFileSync(currentTarget.path, 'utf-8');
      this.textAreaEl.value = content;
    } catch (err) {
      this.textAreaEl.value = `读取错误: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
