import { Notice } from 'obsidian';
import * as path from 'path';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';
import { ComposerContextTray } from './ComposerContextTray';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged?: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private contextTray: ComposerContextTray;
  private ownedContextTray: ComposerContextTray | null = null;
  private inputEl: HTMLTextAreaElement;
  private inputWrapper: HTMLElement | null = null;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  /** Invalidates asynchronous file reads when the composer attachment state resets. */
  private attachmentGeneration = 0;
  private enabled = true;
  private destroyed = false;
  private activeImageModal: { close: () => void } | null = null;
  private readonly dragEnterHandler = (event: DragEvent) => this.handleDragEnter(event);
  private readonly dragOverHandler = (event: DragEvent) => this.handleDragOver(event);
  private readonly dragLeaveHandler = (event: DragEvent) => this.handleDragLeave(event);
  private readonly dropHandler = (event: DragEvent) => {
    void this.handleDrop(event);
  };
  private readonly pasteHandler = (event: ClipboardEvent) => {
    void this.handlePaste(event);
  };

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    contextTray?: ComposerContextTray,
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    const ownedTrayContainer = contextTray
      ? null
      : (previewContainerEl ?? containerEl).createDiv({ cls: 'claudian-plus-context-row' });
    this.contextTray = contextTray ?? new ComposerContextTray(ownedTrayContainer!);
    if (!contextTray) {
      this.ownedContextTray = this.contextTray;
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
  }

  setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages() {
    if (this.destroyed) return;
    this.attachmentGeneration += 1;
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    if (this.destroyed) return;
    this.attachmentGeneration += 1;
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.attachmentGeneration += 1;
    this.inputWrapper?.removeEventListener('dragenter', this.dragEnterHandler);
    this.inputWrapper?.removeEventListener('dragover', this.dragOverHandler);
    this.inputWrapper?.removeEventListener('dragleave', this.dragLeaveHandler);
    this.inputWrapper?.removeEventListener('drop', this.dropHandler);
    this.inputWrapper = null;
    this.inputEl.removeEventListener('paste', this.pasteHandler);
    this.dropOverlay?.remove();
    this.dropOverlay = null;
    this.closeActiveImageModal();
    this.attachedImages.clear();
    this.contextTray.clearItems('images');
    this.ownedContextTray?.destroy();
    this.ownedContextTray = null;
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.claudian-plus-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.inputWrapper = inputWrapper;
    this.dropOverlay = inputWrapper.createDiv({ cls: 'claudian-plus-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'claudian-plus-drop-content' });
    const svg = dropContent.createSvg('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const pathEl = svg.createSvg('path');
    pathEl.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = svg.createSvg('polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = svg.createSvg('line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '3');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');
    dropContent.createSpan({ text: 'Drop image here' });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', this.dragEnterHandler);
    dropZone.addEventListener('dragover', this.dragOverHandler);
    dropZone.addEventListener('dragleave', this.dragLeaveHandler);
    dropZone.addEventListener('drop', this.dropHandler);
  }

  private handleDragEnter(e: DragEvent) {
    if (this.destroyed) return;
    e.preventDefault();
    e.stopPropagation();

    if (this.isImageDrag(e)) {
      this.dropOverlay?.addClass('visible');
    } else {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    if (this.destroyed) return;
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    if (this.destroyed) return;
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.claudian-plus-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    if (this.destroyed) return;
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      }
    }
  }

  private isImageDrag(e: DragEvent): boolean {
    const items = e.dataTransfer?.items;
    if (items) {
      for (let index = 0; index < items.length; index += 1) {
        if (items[index].kind === 'file' && items[index].type.startsWith('image/')) {
          return true;
        }
      }
    }

    const files = e.dataTransfer?.files;
    if (!files) return false;
    for (let index = 0; index < files.length; index += 1) {
      if (this.isImageFile(files[index])) return true;
    }
    return false;
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', this.pasteHandler);
  }

  private async handlePaste(e: ClipboardEvent): Promise<void> {
    if (this.destroyed) return;
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await this.addImageFromFile(file, 'paste');
        }
        return;
      }
    }
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (this.destroyed) return false;
    if (!this.enabled) {
      new Notice('Image attachments are not supported by this provider.');
      return false;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError('Unsupported image type.');
      return false;
    }

    try {
      const attachmentGeneration = this.attachmentGeneration;
      const base64 = await this.fileToBase64(file);
      if (this.destroyed || attachmentGeneration !== this.attachmentGeneration) return false;

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType,
        data: base64,
        size: file.size,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged?.();
      return true;
    } catch (error) {
      this.notifyImageError('Failed to attach image.', error);
      return false;
    }
  }

  private async fileToBase64(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    if (this.destroyed) return;
    if (this.attachedImages.size === 0) {
      this.contextTray.clearItems('images');
      return;
    }

    const images = Array.from(this.attachedImages);
    this.contextTray.setItems('images', images.map(([id, image], index) => ({
      id,
      kind: 'image' as const,
      label: images.length === 1 ? 'Image' : `Image ${index + 1}`,
      title: `${image.name} · ${this.formatSize(image.size)}`,
      ariaLabel: `Image attachment: ${image.name}`,
      onActivate: () => this.showFullImage(image),
      onRemove: () => {
        this.attachedImages.delete(id);
        this.updateImagePreview();
        this.callbacks.onImagesChanged?.();
      },
    })));
  }

  private showFullImage(image: ImageAttachment) {
    if (this.destroyed) return;
    this.closeActiveImageModal();
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-plus-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-plus-image-modal' });

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-plus-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
      if (this.activeImageModal?.close === close) {
        this.activeImageModal = null;
      }
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
    this.activeImageModal = { close };
  }

  private closeActiveImageModal(): void {
    this.activeImageModal?.close();
    this.activeImageModal = null;
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = `${message} (File not found)`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} (Permission denied)`;
      }
    }
    new Notice(userMessage);
  }
}
