import type { App } from 'obsidian';
import { Component, MarkdownRenderer, Menu, Notice, setIcon } from 'obsidian';

import type { MindRecallInfo } from '../../../core/memory/mind-types';
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
import { localeText, t } from '../../../i18n/i18n';
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
import {
  createLinkedNote,
  getSelectedTextWithin,
  insertAtCursor,
  insertCodeBlockAtCursor,
  openDiffReview,
  openMindSettings,
  replaceSelection,
} from '../actions/ActionableOutputController';
import { FloatingSelectionToolbar } from '../actions/FloatingSelectionToolbar';
import { findRewindContext } from '../rewind';
import { WelcomeService } from '../services/WelcomeService';
import { BlobWelcomeView } from '../ui/BlobWelcomeView';
import type { WelcomeAnimation, WelcomeAnimationMode } from '../ui/welcomeAnimation';
import { formatConversationDirectoryTitle } from '../utils/conversationDirectoryTitle';
import { MessageRenderWindow } from './MessageRenderWindow';
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
  /**
   * Component that owns the rendered markdown. Stored (history) messages pass
   * a per-message child component so window eviction can release everything
   * the markdown render registered; live streaming keeps the shared component.
   */
  component?: Component;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

interface RendererTimeout {
  id: number;
  ownerWindow: Window;
  ownerEl: HTMLElement;
}

interface RendererAnimationFrame {
  id: number;
  ownerWindow: Window;
  ownerEl: HTMLElement;
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
  private floatingToolbar: FloatingSelectionToolbar | null = null;
  /** Sliding window over the stored (history) message nodes. */
  private messageWindow: MessageRenderWindow;
  /** Per-message markdown scopes keyed by the message's top-level nodes. */
  private storedMessageComponents = new WeakMap<HTMLElement, Component>();
  private storedScopes = new Set<Component>();
  /** Live-appended nodes (streaming turn, images) in DOM order. */
  private liveNodeOrder: HTMLElement[] = [];

  private getReadingMode?: () => boolean;

  constructor(
    plugin: FeatureHost,
    component: Component,
    messagesEl: HTMLElement,
    rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
    getCapabilities?: () => ProviderCapabilities,
    getReadingMode?: () => boolean,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
    this.getReadingMode = getReadingMode;
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
    this.messageWindow = new MessageRenderWindow({
      renderStoredMessage: (msg, allMessages, index) =>
        this.renderStoredMessage(msg, allMessages, index),
      releaseStoredNodes: (nodes, messageId) => this.releaseStoredNodes(nodes, messageId),
      getFirstLiveNode: () => this.firstLiveNode(),
    });
    this.messageWindow.setContainer(messagesEl);
    this.initFloatingToolbar();
  }

  private initFloatingToolbar(): void {
    if (this.floatingToolbar) {
      this.floatingToolbar.destroy();
      this.floatingToolbar = null;
    }
    if (this.messagesEl) {
      this.floatingToolbar = new FloatingSelectionToolbar({
        app: this.app,
        containerEl: this.messagesEl,
        onPinToMind: (text) => this.pinTextToMind(text),
      });
    }
  }

  pinTextToMind(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const mindStore = this.plugin.getMindStore?.();
        if (!mindStore) return;
        const entry = await mindStore.addStaging({
          category: 'user_preference',
          scope: 'project',
          content: trimmed,
          rationale: 'Pinned from chat response/selection',
          sourceSessionId: '',
          confidence: 0.9,
        });
        if (entry) {
          new Notice(localeText('已添加到心智草稿箱，可在设置中审阅', 'Added to Mind staging queue for review'));
        } else {
          new Notice(localeText('心智库中已存在相同规则', 'Rule already exists in Mind store'));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Failed to pin rule: ${msg}`);
      }
    })();
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.cancelPendingUiCallbacks();
    this.destroyWelcomeCube();
    this.closeActiveImageModal();
    this.releaseAllStoredScopes();
    this.messagesEl = el;
    this.liveNodeOrder = [];
    this.messageWindow.setContainer(el);
    this.initFloatingToolbar();
  }

  /** Releases renderer-owned UI resources when its tab is closed. */
  dispose(): void {
    this.disposed = true;
    this.cancelPendingUiCallbacks();
    this.destroyWelcomeCube();
    this.closeActiveImageModal();
    this.messageWindow.dispose();
    this.releaseAllStoredScopes();
    this.floatingToolbar?.destroy();
    this.floatingToolbar = null;
    this.liveMessageEls.clear();
    this.liveNodeOrder = [];
  }

  private scheduleTimeout(
    ownerEl: HTMLElement,
    callback: () => void,
    delayMs: number,
  ): RendererTimeout {
    const ownerWindow = ownerEl.ownerDocument?.defaultView ?? window;
    const scheduled: RendererTimeout = { id: -1, ownerWindow, ownerEl };
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
    const scheduled: RendererAnimationFrame = { id: -1, ownerWindow, ownerEl };
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

  /** Cancels scheduled UI callbacks bound to (the subtrees of) the given nodes. */
  private cancelPendingUiCallbacksFor(nodes: HTMLElement[]): void {
    const isWithin = (el: HTMLElement) =>
      nodes.some((node) => node === el || node.contains(el));
    for (const scheduled of this.pendingTimeouts) {
      if (isWithin(scheduled.ownerEl)) {
        scheduled.ownerWindow.clearTimeout(scheduled.id);
        this.pendingTimeouts.delete(scheduled);
      }
    }
    for (const scheduled of this.pendingAnimationFrames) {
      if (isWithin(scheduled.ownerEl)) {
        scheduled.ownerWindow.cancelAnimationFrame(scheduled.id);
        this.pendingAnimationFrames.delete(scheduled);
      }
    }
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
    this.activeBlobWelcome?.unmount();
    this.activeBlobWelcome = null;
  }

  private getWelcomeAnimationMode(): WelcomeAnimationMode {
    const mode = this.plugin.settings?.welcomeAnimationMode;
    return mode === 'lite' || mode === 'off' ? mode : 'full';
  }

  private loadWelcomeAnimation(mode: 'full' | 'lite'): Promise<{
    new (parentEl: HTMLElement): WelcomeAnimation;
  }> {
    if (mode === 'lite') {
      return import('../ui/LightweightCubeWelcome').then(
        ({ LightweightCubeWelcome }) => LightweightCubeWelcome,
      );
    }
    return import('../ui/ConstellationCubeWelcome').then(
      ({ ConstellationCubeWelcome }) => ConstellationCubeWelcome,
    );
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
      const imagesEl = this.renderMessageImages(this.messagesEl, msg.images);
      if (imagesEl) this.liveNodeOrder.push(imagesEl);
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
    this.liveNodeOrder.push(msgEl);

    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      this.renderUserText(msg, msgEl, contentEl);
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    } else if (msg.role === 'assistant') {
      this.addAssistantContextMenu(msgEl);
      if (msg.mindRecall && msg.mindRecall.length > 0) {
        this.renderMindRecallPill(contentEl, msg.mindRecall);
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
    this.liveNodeOrder = this.liveNodeOrder.filter((el) => el !== msgEl);
    this.messageWindow.forget(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  private activeCubeWelcome: WelcomeAnimation | null = null;
  private activeBlobWelcome: BlobWelcomeView | null = null;
  private welcomeRenderToken = 0;

  /**
   * Renders a conversation for load/switch. Only the most recent window of
   * messages is rendered on first paint; older history loads on demand through
   * the message window. The caller's array is never truncated and remains the
   * single source for provider context.
   *
   * @param messages Full conversation snapshot to render
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
    this.liveNodeOrder = [];
    // Drop the previous conversation's window so its result is never reused.
    this.messageWindow.reset([]);

    if (messages.length === 0) {
      const welcomeMode = this.getWelcomeAnimationMode();
      if (welcomeMode === 'lite') {
        // Full Bot (blob) - uses BlobWelcomeView
        const newWelcomeEl = this.messagesEl.createDiv({ cls: 'claudian-plus-welcome' });
        const storage: { get: (k: string) => string | null; set: (k: string, v: string) => void } = {
          get: (k) => {
            try {
              return window.localStorage.getItem(k);
            } catch {
              return null;
            }
          },
          set: (k, v) => {
            try {
              window.localStorage.setItem(k, v);
            } catch {
              // ignore
            }
          },
        };
        const welcomeService = new WelcomeService(storage);
        const vaultName = (() => {
          try {
            return (this.app.vault as unknown as { getName?: () => string }).getName?.() ?? 'vault';
          } catch {
            return 'vault';
          }
        })();
        const followPointer = (this.plugin.settings as unknown as { blobFollowPointer?: boolean }).blobFollowPointer ?? true;
        const view = new BlobWelcomeView({ vaultName, followPointer });
        view.mount(newWelcomeEl);
        this.activeBlobWelcome = view;
        if (welcomeService.shouldShowOnboarding()) {
          view.playOnboarding();
          welcomeService.markOnboardingSeen();
        }
        return newWelcomeEl;
      }
      const newWelcomeEl = this.messagesEl.createDiv({ cls: 'claudian-plus-welcome' });
      if (welcomeMode !== 'off') {
        // Keep the animation modules out of the initial chat-renderer module
        // graph. The welcome animation is optional and should not delay normal
        // chat or make the renderer's unit tests depend on Three's ESM modules.
        void this.loadWelcomeAnimation(welcomeMode).then((WelcomeCube) => {
          if (this.disposed || renderToken !== this.welcomeRenderToken || !newWelcomeEl.isConnected) {
            return;
          }
          try {
            this.activeCubeWelcome = new WelcomeCube(newWelcomeEl);
          } catch {
            // Keep the greeting available when WebGL or canvas is unavailable.
          }
        }).catch(() => {
          // Keep the greeting available when the optional animation cannot load.
        });
      }
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

    this.messageWindow.reset(messages);

    this.scrollToBottom();
    return hiddenWelcomeEl;
  }

  /**
   * Brings a message into the rendered window and scrolls it into view,
   * switching the window when the target lies outside it. Returns the message
   * node, or null when no such node exists or can be rendered.
   */
  revealMessage(messageId: string): HTMLElement | null {
    const existing = this.messagesEl.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    );
    if (existing) {
      existing.scrollIntoView?.({ block: 'center' });
      return existing;
    }

    const node = this.messageWindow.ensureMessageRendered(messageId);
    if (!node) return null;
    node.scrollIntoView?.({ block: 'center' });
    return node;
  }

  renderStoredMessage(
    msg: ChatMessage,
    allMessages?: ChatMessage[],
    index?: number,
    container?: HTMLElement
  ): HTMLElement[] {
    const target = container ?? this.messagesEl;
    const nodes: HTMLElement[] = [];

    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      nodes.push(this.renderInterruptMessage(target));
      return nodes;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return nodes;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      const imagesEl = this.renderMessageImages(target, msg.images);
      if (imagesEl) nodes.push(imagesEl);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const textToShow = this.getUserMessageTextToShow(msg);
      if (!textToShow) {
        return nodes;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return nodes;
    }

    // Per-message scope so window eviction can release everything the
    // markdown renders registered on it.
    const scope = this.createStoredMessageScope();
    const msgEl = target.createDiv({
      cls: `claudian-plus-message claudian-plus-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });
    this.storedMessageComponents.set(msgEl, scope);
    nodes.push(msgEl);

    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      this.renderUserText(msg, msgEl, contentEl, scope);
      if (msg.userMessageId) {
        if (this.rewindCallback && this.isRewindEligible(allMessages, index)) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback && this.isForkEligible(allMessages, index)) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      this.addAssistantContextMenu(msgEl);
      const hadLegacyInterruptIndicator = this.renderAssistantContent(msg, contentEl, scope);
      if (msg.isInterrupt || hadLegacyInterruptIndicator) {
        this.appendInterruptIndicator(contentEl);
      }
    }

    return nodes;
  }

  private createStoredMessageScope(): Component {
    const scope = new Component();
    this.component.addChild(scope);
    this.storedScopes.add(scope);
    return scope;
  }

  /**
   * Releases the resources a stored message holds beyond its DOM: the
   * per-message markdown component (registered events/observers) and any UI
   * callbacks still scheduled against the discarded nodes.
   */
  private releaseStoredNodes(nodes: HTMLElement[], messageId: string): void {
    for (const node of nodes) {
      const scope = this.storedMessageComponents.get(node);
      if (scope) {
        scope.unload();
        this.storedScopes.delete(scope);
        this.storedMessageComponents.delete(node);
      }
    }
    this.cancelPendingUiCallbacksFor(nodes);
    this.liveMessageEls.delete(messageId);
    this.liveNodeOrder = this.liveNodeOrder.filter((el) => !nodes.includes(el));
  }

  private releaseAllStoredScopes(): void {
    for (const scope of this.storedScopes) {
      scope.unload();
    }
    this.storedScopes.clear();
    this.storedMessageComponents = new WeakMap();
  }

  private firstLiveNode(): HTMLElement | null {
    for (const el of this.liveNodeOrder) {
      if (el.isConnected === false) continue;
      if (this.messagesEl.contains(el)) return el;
    }
    return null;
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

  private renderInterruptMessage(container: HTMLElement): HTMLElement {
    const msgEl = container.createDiv({ cls: 'claudian-plus-message claudian-plus-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'claudian-plus-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
    return msgEl;
  }

  private addAssistantContextMenu(msgEl: HTMLElement): void {
    msgEl.addEventListener('contextmenu', (e) => {
      const selectedText = getSelectedTextWithin(msgEl);
      if (!selectedText) return;

      e.preventDefault();
      e.stopPropagation();

      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle(localeText('插入选区到光标处', 'Insert selection at cursor'))
          .setIcon('corner-down-left')
          .onClick(() => {
            insertAtCursor(this.plugin.app, selectedText, { isSelection: true });
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(localeText('用选区替换笔记内容', 'Replace selection in note'))
          .setIcon('file-edit')
          .onClick(() => {
            replaceSelection(this.plugin.app, selectedText, null, { isSelection: true });
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(localeText('将选区创建为新笔记', 'Create note from selection'))
          .setIcon('file-plus')
          .onClick(() => {
            void createLinkedNote(this.plugin.app, selectedText);
          });
      });
      menu.addItem((item) => {
        item
          .setTitle(localeText('复制选区', 'Copy selection'))
          .setIcon('copy')
          .onClick(() => {
            void navigator.clipboard.writeText(selectedText).then(() => {
              new Notice(localeText('已复制选区到剪贴板', 'Copied selection to clipboard'));
            }).catch(() => {});
          });
      });
      menu.showAtMouseEvent(e);
    });
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
  /**
   * Renders message markdown, routing through the per-message component when
   * one exists. Live messages keep the original two-argument call shape.
   */
  private renderMessageMarkdown(
    el: HTMLElement,
    markdown: string,
    markdownComponent?: Component
  ): Promise<void> {
    if (markdownComponent) {
      return this.renderContent(el, markdown, { component: markdownComponent });
    }
    return this.renderContent(el, markdown);
  }

  private renderAssistantContent(
    msg: ChatMessage,
    contentEl: HTMLElement,
    markdownComponent?: Component
  ): boolean {
    if (msg.mindRecall && msg.mindRecall.length > 0) {
      this.renderMindRecallPill(contentEl, msg.mindRecall);
    }

    let hadLegacyInterruptIndicator = false;

    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking') {
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderMessageMarkdown(el, md, markdownComponent),
            { collapsedByDefault: this.isReadingModeActive() }
          );
        } else if (block.type === 'text') {
          const normalized = stripLegacyInterruptIndicator(block.content);
          hadLegacyInterruptIndicator ||= normalized.interrupted;
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          if (!normalized.content.trim()) {
            continue;
          }
          const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
          void this.renderMessageMarkdown(textEl, normalized.content, markdownComponent);
          this.addTextCopyButton(textEl, normalized.content);
          this.addActionableResponseBar(textEl, normalized.content);
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
          void this.renderMessageMarkdown(textEl, normalized.content, markdownComponent);
          this.addTextCopyButton(textEl, normalized.content);
          this.addActionableResponseBar(textEl, normalized.content);
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

  private isReadingModeActive(): boolean {
    return this.getReadingMode?.() ?? false;
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    const isReadingMode = this.isReadingModeActive();

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
        collapsedByDefault: isReadingMode,
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
   * @returns The created images container, or null when nothing was rendered.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): HTMLElement | null {
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

    return imagesEl;
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
        options?.component ?? this.component
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
        let language = '';
        const code = pre.querySelector('code[class*="language-"]') || pre.querySelector('code');
        if (code) {
          const match = code.className.match(/language-(\w+)/);
          if (match) {
            language = match[1];
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

        // Insert at cursor button for code block
        const insertCodeBtn = createSpan({
          cls: 'claudian-plus-code-insert-btn',
          attr: {
            title: localeText('插入代码到光标处', 'Insert code at cursor'),
            'aria-label': localeText('插入代码到光标处', 'Insert code at cursor'),
          },
        });
        setIcon(insertCodeBtn, 'corner-down-left');
        wrapper.appendChild(insertCodeBtn);
        insertCodeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const rawCode = code?.textContent ?? pre.textContent ?? '';
          insertCodeBlockAtCursor(this.plugin.app, rawCode, language);
        });

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
  // Actionable Response Bar & Copy Button
  // ============================================

  /**
   * Adds actionable response buttons (Copy, Insert at cursor, Replace selection, Create note, Diff review)
   * to an assistant text block.
   */
  addActionableResponseBar(textEl: HTMLElement, markdown: string): void {
    const actionsBar = textEl.createDiv({ cls: 'claudian-plus-text-actions-bar' });

    // Prevent clicking on the action bar from collapsing active selection
    actionsBar.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    // Insert at Cursor
    const insertBtn = actionsBar.createSpan({
      cls: 'claudian-plus-action-btn claudian-plus-action-insert-btn',
      attr: {
        title: localeText('插入到光标处', 'Insert at cursor'),
        'aria-label': localeText('插入到光标处', 'Insert at cursor'),
      },
    });
    setIcon(insertBtn, 'corner-down-left');
    insertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const selectedText = getSelectedTextWithin(textEl);
      const targetText = selectedText || markdown;
      insertAtCursor(this.plugin.app, targetText, { isSelection: !!selectedText });
    });

    // Replace Selection / Section
    const replaceBtn = actionsBar.createSpan({
      cls: 'claudian-plus-action-btn claudian-plus-action-replace-btn',
      attr: {
        title: localeText('替换选区或当前章节', 'Replace selection or active section'),
        'aria-label': localeText('替换选区或当前章节', 'Replace selection or active section'),
      },
    });
    setIcon(replaceBtn, 'file-edit');
    replaceBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const selectedText = getSelectedTextWithin(textEl);
      const targetText = selectedText || markdown;
      replaceSelection(this.plugin.app, targetText, null, { isSelection: !!selectedText });
    });

    // Create Linked Note
    const noteBtn = actionsBar.createSpan({
      cls: 'claudian-plus-action-btn claudian-plus-action-note-btn',
      attr: {
        title: localeText('创建关联笔记', 'Create linked note'),
        'aria-label': localeText('创建关联笔记', 'Create linked note'),
      },
    });
    setIcon(noteBtn, 'file-plus');
    noteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const selectedText = getSelectedTextWithin(textEl);
      const targetText = selectedText || markdown;
      void createLinkedNote(this.plugin.app, targetText);
    });

    // Diff Review
    const diffBtn = actionsBar.createSpan({
      cls: 'claudian-plus-action-btn claudian-plus-action-diff-btn',
      attr: {
        title: localeText('Diff 审查与合并', 'Diff & merge review'),
        'aria-label': localeText('Diff 审查与合并', 'Diff & merge review'),
      },
    });
    setIcon(diffBtn, 'split');
    diffBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const selectedText = getSelectedTextWithin(textEl);
      const targetText = selectedText || markdown;
      openDiffReview(this.plugin.app, targetText);
    });

    // Pin to Mind Habits (Staging Queue)
    const pinBtn = actionsBar.createSpan({
      cls: 'claudian-plus-action-btn claudian-plus-action-pin-btn',
      attr: {
        title: localeText('沉淀到心智草稿箱', 'Pin to Mind habits'),
        'aria-label': localeText('沉淀到心智草稿箱', 'Pin to Mind habits'),
      },
    });
    setIcon(pinBtn, 'pin');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const selectedText = getSelectedTextWithin(textEl);
      const targetText = (selectedText || markdown).trim();
      this.pinTextToMind(targetText);
    });
  }

  private renderMindRecallPill(contentEl: HTMLElement, entries: MindRecallInfo[]): void {
    if (!entries || entries.length === 0) return;

    const count = entries.length;
    const label = localeText(`${count} 条规则生效`, `${count} rule${count > 1 ? 's' : ''} active`);

    const pillContainer = contentEl.createDiv({ cls: 'claudian-plus-mind-recall-container' });
    const pill = pillContainer.createDiv({
      cls: 'claudian-plus-mind-recall-pill',
      text: label,
      attr: {
        title: localeText('点击查看本轮生效的心智规则', 'Click to view active mind rules for this turn'),
        role: 'button',
        tabindex: '0',
      },
    });

    let popoverEl: HTMLElement | null = null;

    const togglePopover = () => {
      if (popoverEl) {
        popoverEl.remove();
        popoverEl = null;
        pill.removeClass('is-active');
        return;
      }

      pill.addClass('is-active');
      popoverEl = pillContainer.createDiv({ cls: 'claudian-plus-mind-recall-popover' });

      // Header
      const header = popoverEl.createDiv({ cls: 'claudian-plus-mind-recall-header' });
      header.createSpan({
        cls: 'claudian-plus-mind-recall-title',
        text: localeText('生效的心智规则', 'Active Mind Rules'),
      });

      const manageBtn = header.createEl('button', {
        cls: 'claudian-plus-mind-manage-btn',
        text: localeText('管理心智库', 'Manage Mind'),
      });
      manageBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMindSettings(this.plugin.app);
      });

      // Rules list
      const listEl = popoverEl.createDiv({ cls: 'claudian-plus-mind-recall-list' });
      for (const entry of entries) {
        const itemEl = listEl.createDiv({ cls: 'claudian-plus-mind-recall-item' });

        itemEl.createSpan({
          cls: `claudian-plus-mind-badge badge-${entry.category}`,
          text: this.getCategoryBadgeText(entry.category),
        });

        itemEl.createSpan({
          cls: 'claudian-plus-mind-rule-text',
          text: entry.content,
        });

        if (entry.confidence !== undefined) {
          itemEl.createSpan({
            cls: 'claudian-plus-mind-confidence',
            text: `${Math.round(entry.confidence * 100)}%`,
          });
        }

        const disableBtn = itemEl.createSpan({
          cls: 'claudian-plus-mind-rule-disable-btn',
          attr: {
            title: localeText('从心智库停用此规则', 'Deactivate this rule from Mind store'),
            role: 'button',
          },
        });
        setIcon(disableBtn, 'x');
        disableBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void (async () => {
            try {
              const mindStore = this.plugin.getMindStore?.();
              if (mindStore) {
                await mindStore.updateDurable(entry.id, { state: 'stale' });
                itemEl.addClass('is-stale');
                new Notice(localeText(`已停用规则: "${entry.content}"`, `Deactivated rule: "${entry.content}"`));
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              new Notice(`Failed to deactivate rule: ${msg}`);
            }
          })();
        });
      }
    };

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePopover();
    });

    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePopover();
      }
    });
  }

  private getCategoryBadgeText(cat: string): string {
    switch (cat) {
      case 'user_preference':
        return localeText('偏好', 'Pref');
      case 'coding_habit':
        return localeText('习惯', 'Habit');
      case 'project_rule':
        return localeText('规则', 'Rule');
      case 'correction_rule':
        return localeText('纠偏', 'Fix');
      default:
        return cat;
    }
  }

  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'claudian-plus-text-copy-btn' });
    setIcon(copyBtn, 'copy');
    this.wireCopyFeedback(copyBtn, markdown);
  }

  /** Copies to the clipboard and shows temporary "copied!" feedback. */
  private wireCopyFeedback(copyBtn: HTMLElement, markdown: string): void {
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


  /** Renders the user message text with copy button and TOC title wiring. */
  private renderUserText(
    msg: ChatMessage,
    msgEl: HTMLElement,
    contentEl: HTMLElement,
    markdownComponent?: Component
  ): void {
    const textToShow = this.getUserMessageTextToShow(msg);
    if (textToShow) {
      const textEl = contentEl.createDiv({ cls: 'claudian-plus-text-block' });
      void this.renderMessageMarkdown(textEl, textToShow, markdownComponent);
      this.addUserCopyButton(msgEl, textToShow);
      this.applyTocTitle(msgEl, textToShow);
    }
  }
  private addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const copyBtn = toolbar.createSpan({ cls: 'claudian-plus-user-msg-copy-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttribute('aria-label', 'Copy message');
    this.wireCopyFeedback(copyBtn, content);
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
