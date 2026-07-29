import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Menu, Notice, setIcon } from 'obsidian';

import { DEFAULT_CHAT_PROVIDER_ID, type ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, ImageAttachment, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import { processFileLinks, registerFileLinkHandler } from '../../../utils/fileLink';
import { replaceImageEmbedsWithHtml } from '../../../utils/imageEmbed';
import { stripLegacyInterruptIndicator } from '../../../utils/interrupt';
import { escapeRawHtmlTags } from '../../../utils/markdownHtml';
import {
  escapeMathDelimitersForStreaming,
  normalizeLatexMathDelimiters,
} from '../../../utils/markdownMath';
import type { FeatureHost } from '../../FeatureHost';
import { findRewindContext } from '../rewind';
import type { ConstellationCubeWelcome } from '../ui/ConstellationCubeWelcome';
import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';
import { renderStoredToolCall } from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

interface RendererTimeout {
  id: number;
  ownerWindow: Window;
}

interface RendererAnimationFrame {
  id: number;
  ownerWindow: Window;
}

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

export class MessageRenderer {
  private app: App;
  private plugin: FeatureHost;
  private component: Component;
  private messagesEl: HTMLElement;
  private rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  private getCapabilities: () => ProviderCapabilities;
  private forkCallback?: (messageId: string) => Promise<void>;
  private liveMessageEls = new Map<string, HTMLElement>();
  private activeImageModal: { close: () => void } | null = null;
  private pendingTimeouts = new Set<RendererTimeout>();
  private pendingAnimationFrames = new Set<RendererAnimationFrame>();
  private disposed = false;

  constructor(
    plugin: FeatureHost,
    component: Component,
    messagesEl: HTMLElement,
    rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
    getCapabilities?: () => ProviderCapabilities,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
    this.getCapabilities = getCapabilities ?? (() => ({
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsTurnSteer: false,
      reasoningControl: 'none' as const,
    }));

    // Register delegated click handler for file links
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.cancelPendingUiCallbacks();
    this.destroyWelcomeCube();
    this.closeActiveImageModal();
    this.messagesEl = el;
  }

  /** Releases renderer-owned UI resources when its tab is closed. */
  dispose(): void {
    this.disposed = true;
    this.cancelPendingUiCallbacks();
    this.destroyWelcomeCube();
    this.closeActiveImageModal();
    this.liveMessageEls.clear();
  }

  private scheduleTimeout(
    ownerEl: HTMLElement,
    callback: () => void,
    delayMs: number,
  ): RendererTimeout {
    const ownerWindow = ownerEl.ownerDocument?.defaultView ?? window;
    const scheduled: RendererTimeout = { id: -1, ownerWindow };
    scheduled.id = ownerWindow.setTimeout(() => {
      this.pendingTimeouts.delete(scheduled);
      if (this.disposed || ownerEl.isConnected === false) return;
      callback();
    }, delayMs);
    this.pendingTimeouts.add(scheduled);
    return scheduled;
  }

  private clearTimeout(scheduled: RendererTimeout | null): void {
    if (!scheduled) return;
    scheduled.ownerWindow.clearTimeout(scheduled.id);
    this.pendingTimeouts.delete(scheduled);
  }

  private scheduleAnimationFrame(
    ownerEl: HTMLElement,
    callback: () => void,
  ): RendererAnimationFrame {
    const ownerWindow = ownerEl.ownerDocument?.defaultView ?? window;
    const scheduled: RendererAnimationFrame = { id: -1, ownerWindow };
    scheduled.id = ownerWindow.requestAnimationFrame(() => {
      this.pendingAnimationFrames.delete(scheduled);
      if (this.disposed || ownerEl.isConnected === false) return;
      callback();
    });
    this.pendingAnimationFrames.add(scheduled);
    return scheduled;
  }

  private cancelPendingUiCallbacks(): void {
    for (const scheduled of this.pendingTimeouts) {
      scheduled.ownerWindow.clearTimeout(scheduled.id);
    }
    this.pendingTimeouts.clear();
    for (const scheduled of this.pendingAnimationFrames) {
      scheduled.ownerWindow.cancelAnimationFrame(scheduled.id);
    }
    this.pendingAnimationFrames.clear();
  }

  /** Pauses the welcome visual while its tab is hidden or starts a turn. */
  pauseWelcomeAnimation(): void {
    this.activeCubeWelcome?.pause();
  }

  /** Resumes the welcome visual when a failed first turn returns to the greeting. */
  resumeWelcomeAnimation(): void {
    this.activeCubeWelcome?.resume();
  }

  private destroyWelcomeCube(): void {
    this.activeCubeWelcome?.destroy();
    this.activeCubeWelcome = null;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.getCapabilities().providerId, toolName);
  }

  private shouldExpandFileEditsByDefault(): boolean {
    return this.plugin.settings?.expandFileEditsByDefault === true;
  }

  private getUserMessageTextToShow(msg: ChatMessage): string {
    return msg.displayContent ?? extractUserDisplayContent(msg.content) ?? msg.content;
  }

  private applyTocTitle(msgEl: HTMLElement, text: string): void {
    const tocTitle = formatConversationDirectoryTitle(text);
    if (tocTitle) {
      msgEl.setAttribute('data-toc-title', tocTitle);
    } else {
      msgEl.removeAttribute('data-toc-title');
    }
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (!textToShow) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-plus-message claudian-plus-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
        this.applyTocTitle(msgEl, textToShow);
      }
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-plus-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const textToShow = this.getUserMessageTextToShow(msg);
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
      void this.renderContent(textEl, textToShow);
      this.applyTocTitle(msgEl, textToShow);
    } else {
      msgEl.removeAttribute('data-toc-title');
    }

    const toolbar = msgEl.querySelector<HTMLElement>('.claudian-plus-user-msg-actions');
    if (toolbar) {
      toolbar.querySelectorAll('.claudian-plus-user-msg-copy-btn').forEach((el) => el.remove());
    }

    if (textToShow) {
      this.addUserCopyButton(msgEl, textToShow);
    }
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  private activeCubeWelcome: ConstellationCubeWelcome | null = null;
  private welcomeRenderToken = 0;

  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string
  ): HTMLElement {
    const renderToken = ++this.welcomeRenderToken;
    this.destroyWelcomeCube();

    this.messagesEl.empty();
    this.liveMessageEls.clear();

    if (messages.length === 0) {
      const newWelcomeEl = this.messagesEl.createDiv({ cls: 'claudian-plus-welcome' });
      // Keep Three.js out of the initial chat-renderer module graph. The
      // welcome animation is optional and should not delay normal chat or
      // make the renderer's unit tests depend on Three's ESM modules.
      void import('../ui/ConstellationCubeWelcome').then(({ ConstellationCubeWelcome: WelcomeCube }) => {
        if (this.disposed || renderToken !== this.welcomeRenderToken || !newWelcomeEl.isConnected) {
          return;
        }
        try {
          this.activeCubeWelcome = new WelcomeCube(newWelcomeEl);
        } catch {
          // Keep the greeting available when WebGL is unavailable.
        }
      }).catch(() => {
        // Keep the greeting available when the optional animation cannot load.
      });
      newWelcomeEl.createDiv({ cls: 'claudian-plus-welcome-greeting', text: getGreeting() });
      return newWelcomeEl;
    }

    // Keep the welcome node separate from the message container. Callers use
    // this element to toggle the empty-state visibility; returning
    // `messagesEl` here would hide the entire conversation after a restore.
    const hiddenWelcomeEl = this.messagesEl.createDiv({
      cls: 'claudian-plus-welcome claudian-plus-hidden',
    });
    hiddenWelcomeEl.createDiv({ cls: 'claudian-plus-welcome-greeting', text: getGreeting() });

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return hiddenWelcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (!textToShow) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-plus-message claudian-plus-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (textToShow) {
        const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
        void this.renderContent(textEl, textToShow);
        this.addUserCopyButton(msgEl, textToShow);
        this.applyTocTitle(msgEl, textToShow);
      }
      if (msg.userMessageId) {
        if (this.rewindCallback && this.isRewindEligible(allMessages, index)) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback && this.isForkEligible(allMessages, index)) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      const hadLegacyInterruptIndicator = this.renderAssistantContent(msg, contentEl);
      if (msg.isInterrupt || hadLegacyInterruptIndicator) {
        this.appendInterruptIndicator(contentEl);
      }
    }
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    if (msg.content && msg.content.trim().length > 0) return true;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking' && block.content.trim().length > 0) return true;
        if (block.type === 'text' && block.content.trim().length > 0) return true;
        if (block.type === 'context_compacted') return true;
        if (block.type === 'subagent') return true;
        if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall && this.shouldRenderToolCall(toolCall)) return true;
        }
      }
    }
    if (msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall))) return true;
    return false;
  }

  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return ctx.hasResponse;
  }

  private isForkEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'claudian-plus-message claudian-plus-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
    textEl.createSpan({ cls: 'claudian-plus-interrupted', text: 'Interrupted' });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'claudian-plus-interrupted-hint',
      text: '\u00B7 What should Claudian Plus do instead?',
    });
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): boolean {
    let hadLegacyInterruptIndicator = false;

    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md)
          );
        } else if (block.type === 'text') {
          const normalized = stripLegacyInterruptIndicator(block.content);
          hadLegacyInterruptIndicator ||= normalized.interrupted;
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          if (!normalized.content.trim()) {
            continue;
          }
          const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
          void this.renderContent(textEl, normalized.content);
          this.addTextCopyButton(textEl, normalized.content);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            this.renderToolCall(contentEl, toolCall, msg);
            renderedToolIds.add(toolCall.id);
          }
        } else if (block.type === 'context_compacted') {
          const boundaryEl = contentEl.createDiv({ cls: 'claudian-plus-compact-boundary' });
          boundaryEl.createSpan({ cls: 'claudian-plus-compact-boundary-label', text: 'Conversation compacted' });
        } else if (block.type === 'subagent') {
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
          );
          if (!taskToolCall) continue;

          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        }
      }

      // Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload.
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          if (renderedToolIds.has(toolCall.id)) continue;
          this.renderToolCall(contentEl, toolCall, msg);
          renderedToolIds.add(toolCall.id);
        }
      }
    } else {
      // Fallback for old conversations without contentBlocks
      if (msg.content) {
        const normalized = stripLegacyInterruptIndicator(msg.content);
        hadLegacyInterruptIndicator ||= normalized.interrupted;
        if (normalized.content.trim()) {
          const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
          void this.renderContent(textEl, normalized.content);
          this.addTextCopyButton(textEl, normalized.content);
        }
      }
      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          this.renderToolCall(contentEl, toolCall, msg);
        }
      }
    }

    // Render response duration footer (skip when message contains a compaction boundary)
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (msg.durationSeconds && msg.durationSeconds > 0 && !hasCompactBoundary) {
      const flavorWord = msg.durationFlavorWord || 'Baked';
      const footerEl = contentEl.createDiv({ cls: 'claudian-plus-response-footer' });
      footerEl.createSpan({
        text: `* ${flavorWord} for ${formatDurationMmSs(msg.durationSeconds)}`,
        cls: 'claudian-plus-baked-duration',
      });
    }

    return hadLegacyInterruptIndicator;
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall, {
        initiallyExpanded: this.shouldExpandFileEditsByDefault(),
      });
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(contentEl, toolCall, {
        initiallyExpanded: toolCall.name === TOOL_APPLY_PATCH && this.shouldExpandFileEditsByDefault(),
      });
    }
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  private renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'claudian-plus-message-images' });

    for (const image of images) {
      const imageWrapper = imagesEl.createDiv({ cls: 'claudian-plus-message-image' });
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
        },
      });

      void this.setImageSrc(imgEl, image);

      // Click to view full size
      imgEl.addEventListener('click', () => {
        void this.showFullImage(image);
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(image: ImageAttachment): void {
    this.closeActiveImageModal();
    const dataUri = `data:${image.mediaType};base64,${image.data}`;

    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-plus-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-plus-image-modal' });

    modal.createEl('img', {
      attr: {
        src: dataUri,
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

  /**
   * Sets image src from attachment data.
   */
  setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): void {
    const dataUri = `data:${image.mediaType};base64,${image.data}`;
    imgEl.setAttribute('src', dataUri);
  }

  // ============================================
  // Content Rendering
  // ============================================

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.empty();

    try {
      const normalizedMarkdown = normalizeLatexMathDelimiters(markdown);
      const renderMarkdown = options?.deferMath
        ? escapeMathDelimitersForStreaming(normalizedMarkdown)
        : normalizedMarkdown;
      // Escape user-authored HTML first so placeholders like <meta-name> render
      // as plain text. Trusted plugin markup (image embeds) is injected only
      // after this step, otherwise it would be escaped too.
      const safeMarkdown = escapeRawHtmlTags(renderMarkdown);
      const processedMarkdown = replaceImageEmbedsWithHtml(
        safeMarkdown,
        this.app,
        { mediaFolder: this.plugin.settings.mediaFolder }
      );
      await MarkdownRenderer.render(
        this.app,
        processedMarkdown,
        el,
        '',
        this.component
      );

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('claudian-plus-code-wrapper')) return;

        // Create wrapper
        const wrapper = createDiv({ cls: 'claudian-plus-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Check for language class and add label
        const code = pre.querySelector('code[class*="language-"]');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            wrapper.classList.add('has-language');
            const label = createSpan({
              cls: 'claudian-plus-code-lang-label',
              text: match[1],
            });
            wrapper.appendChild(label);
            label.addEventListener('click', () => {
              runRendererAction(async () => {
                const originalLabel = match[1];
                if (!originalLabel) return;

                try {
                  await navigator.clipboard.writeText(code.textContent || '');
                  if (this.disposed || label.isConnected === false) return;
                  label.setText('Copied!');
                  this.scheduleTimeout(label, () => label.setText(originalLabel), 1500);
                } catch {
                  // Clipboard API may fail in non-secure contexts
                }
              });
            });
          }
        }

        // Move Obsidian's copy button outside pre into wrapper
        const copyBtn = pre.querySelector('.copy-code-button');
        if (copyBtn) {
          wrapper.appendChild(copyBtn);
        }
      });

      // Process wikilinks only when the source can contain them; the DOM pass is expensive.
      if (processedMarkdown.includes('[[')) {
        processFileLinks(this.app, el);
      }
    } catch {
      el.createDiv({
        cls: 'claudian-plus-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  // ============================================
  // Copy Button
  // ============================================

  /**
   * Adds a copy button to a text block.
   * Button shows clipboard icon on hover, changes to "copied!" on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'claudian-plus-text-copy-btn' });
    setIcon(copyBtn, 'copy');

    let feedbackTimeout: RendererTimeout | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {

        try {
          await navigator.clipboard.writeText(markdown);
        } catch {
          // Clipboard API may fail in non-secure contexts
          return;
        }
        if (this.disposed || copyBtn.isConnected === false) return;

        // Clear any pending timeout from rapid clicks
        this.clearTimeout(feedbackTimeout);

        // Show "copied!" feedback
        copyBtn.empty();
        copyBtn.setText('Copied!');
        copyBtn.classList.add('copied');

        feedbackTimeout = this.scheduleTimeout(copyBtn, () => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.userMessageId) return;
    const canRewind = this.isRewindEligible(allMessages, index);
    const canFork = this.isForkEligible(allMessages, index);
    if (!canRewind && !canFork) return;
    const msgEl = this.liveMessageEls.get(msg.id);
    if (!msgEl) return;

    if (canRewind && this.rewindCallback && !msgEl.querySelector('.claudian-plus-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (canFork && this.forkCallback && !msgEl.querySelector('.claudian-plus-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }
    this.cleanupLiveMessageEl(msg.id, msgEl, { canRewind, canFork });
  }

  private cleanupLiveMessageEl(
    msgId: string,
    msgEl: HTMLElement,
    expectedActions: { canRewind: boolean; canFork: boolean },
  ): void {
    const needsRewind = expectedActions.canRewind
      && this.rewindCallback
      && !msgEl.querySelector('.claudian-plus-message-rewind-btn');
    const needsFork = expectedActions.canFork
      && this.forkCallback
      && !msgEl.querySelector('.claudian-plus-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.liveMessageEls.delete(msgId);
    }
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.claudian-plus-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({ cls: 'claudian-plus-user-msg-actions' });
  }

  private addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const copyBtn = toolbar.createSpan({ cls: 'claudian-plus-user-msg-copy-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttribute('aria-label', 'Copy message');

    let feedbackTimeout: RendererTimeout | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          return;
        }
        if (this.disposed || copyBtn.isConnected === false) return;
        this.clearTimeout(feedbackTimeout);
        copyBtn.empty();
        copyBtn.setText('Copied!');
        copyBtn.classList.add('copied');
        feedbackTimeout = this.scheduleTimeout(copyBtn, () => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  private addRewindButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsRewind) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-plus-message-rewind-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'rotate-ccw');
    btn.setAttribute('aria-label', t('chat.rewind.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRewindMenu(e, messageId);
    });
  }

  private showRewindMenu(event: MouseEvent, messageId: string): void {
    const menu = new Menu();
    this.addRewindMenuItem(menu, messageId, 'conversation');
    this.addRewindMenuItem(menu, messageId, 'code-and-conversation');
    menu.showAtMouseEvent(event);
  }

  private addRewindMenuItem(menu: Menu, messageId: string, mode: ChatRewindMode): void {
    menu.addItem((item) => {
      item
        .setTitle(
          mode === 'conversation'
            ? t('chat.rewind.menuConversationOnly')
            : t('chat.rewind.menuCodeAndConversation')
        )
        .setIcon(mode === 'conversation' ? 'message-square' : 'rotate-ccw')
        .onClick(() => {
          runRendererAction(async () => {
            try {
              await this.rewindCallback?.(messageId, mode);
            } catch (err) {
              new Notice(t('chat.rewind.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
            }
          });
        });
    });
  }

  private addForkButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsFork) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-plus-message-fork-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'git-fork');
    btn.setAttribute('aria-label', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
    });
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages container to bottom. */
  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      const messagesEl = this.messagesEl;
      this.scheduleAnimationFrame(messagesEl, () => {
        if (this.messagesEl !== messagesEl) return;
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

}
