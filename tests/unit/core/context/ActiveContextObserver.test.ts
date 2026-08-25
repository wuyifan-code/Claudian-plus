import { ActiveContextObserver } from '../../../../src/core/context/ActiveContextObserver';

describe('ActiveContextObserver', () => {
  let mockApp: any;
  let mockLeafChangeCallback: any;
  let mockMetadataChangeCallback: any;

  beforeEach(() => {
    jest.useFakeTimers();

    mockApp = {
      workspace: {
        on: jest.fn((event: string, callback: any) => {
          if (event === 'active-leaf-change') mockLeafChangeCallback = callback;
          return { id: event };
        }),
        offref: jest.fn(),
        getActiveViewOfType: jest.fn(),
        getActiveLeaf: jest.fn(),
      },
      metadataCache: {
        on: jest.fn((event: string, callback: any) => {
          if (event === 'changed') mockMetadataChangeCallback = callback;
          return { id: event };
        }),
        offref: jest.fn(),
        getFileCache: jest.fn(),
        resolvedLinks: {},
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('initializes with default auto mode and empty snapshot if no active leaf', () => {
    const observer = new ActiveContextObserver(mockApp);
    const snapshot = observer.getSnapshot();

    expect(snapshot.mode).toBe('auto');
    expect(snapshot.document).toBeNull();
    expect(snapshot.focus).toBeNull();
    expect(snapshot.graph).toBeNull();

    observer.dispose();
  });

  it('extracts snapshot on active leaf change after debounce', () => {
    const mockFile = { path: 'Notes/Test.md', basename: 'Test', extension: 'md' };
    const mockEditor = {
      getSelection: () => 'selected line of text',
      getCursor: (which?: string) => which === 'from' ? { line: 2, ch: 0 } : { line: 2, ch: 21 },
      getValue: () => 'line 1\nline 2\nselected line of text\nline 4',
    };

    mockApp.workspace.getActiveViewOfType.mockReturnValue({
      file: mockFile,
      editor: mockEditor,
      getViewType: () => 'markdown',
    });
    mockApp.metadataCache.getFileCache.mockReturnValue({
      frontmatter: { title: 'Test Note' },
      headings: [],
      tags: [],
    });
    mockApp.metadataCache.resolvedLinks = {
      'Notes/Test.md': { 'Target.md': 1 },
    };

    const listener = jest.fn();
    const observer = new ActiveContextObserver(mockApp, { debounceMs: 150 });
    observer.onSnapshotChange(listener);
    observer.start();

    // Trigger leaf change
    mockLeafChangeCallback?.();
    expect(listener).not.toHaveBeenCalled();

    // Advance 150ms debounce
    jest.advanceTimersByTime(150);

    expect(listener).toHaveBeenCalled();
    const snapshot = observer.getSnapshot();
    expect(snapshot.document?.path).toBe('Notes/Test.md');
    expect(snapshot.focus?.type).toBe('selection');
    expect(snapshot.focus?.content).toBe('selected line of text');
    expect(snapshot.graph?.outlinks).toContain('Target.md');

    observer.dispose();
  });

  it('locks snapshot and ignores editor changes when mode is pinned', () => {
    const mockFile = { path: 'Notes/Pinned.md', basename: 'Pinned', extension: 'md' };
    const mockEditor = {
      getSelection: () => 'pinned selection',
      getCursor: () => ({ line: 0, ch: 0 }),
      getValue: () => 'pinned selection',
    };

    mockApp.workspace.getActiveViewOfType.mockReturnValue({
      file: mockFile,
      editor: mockEditor,
      getViewType: () => 'markdown',
    });

    const observer = new ActiveContextObserver(mockApp);
    observer.start();
    mockLeafChangeCallback?.();
    jest.advanceTimersByTime(150);

    const initialSnapshot = observer.getSnapshot();
    expect(initialSnapshot.document?.path).toBe('Notes/Pinned.md');

    // Pin the observer
    observer.pin();
    expect(observer.getSnapshot().mode).toBe('pinned');

    // Switch active view to a different file
    mockApp.workspace.getActiveViewOfType.mockReturnValue({
      file: { path: 'Notes/Other.md', basename: 'Other', extension: 'md' },
      editor: { getSelection: () => '', getCursor: () => ({ line: 0, ch: 0 }), getValue: () => '' },
      getViewType: () => 'markdown',
    });

    mockLeafChangeCallback?.();
    jest.advanceTimersByTime(150);

    // Snapshot should still be the pinned file
    expect(observer.getSnapshot().document?.path).toBe('Notes/Pinned.md');

    // Unpin
    observer.unpin();
    expect(observer.getSnapshot().mode).toBe('auto');

    mockLeafChangeCallback?.();
    jest.advanceTimersByTime(150);
    expect(observer.getSnapshot().document?.path).toBe('Notes/Other.md');

    observer.dispose();
  });

  it('returns empty context when mode is set to ignored', () => {
    const mockFile = { path: 'Notes/Secret.md', basename: 'Secret', extension: 'md' };
    mockApp.workspace.getActiveViewOfType.mockReturnValue({
      file: mockFile,
      editor: { getSelection: () => 'secret', getCursor: () => ({ line: 0, ch: 0 }) },
      getViewType: () => 'markdown',
    });

    const observer = new ActiveContextObserver(mockApp);
    observer.start();
    mockLeafChangeCallback?.();
    jest.advanceTimersByTime(150);

    expect(observer.getSnapshot().document?.path).toBe('Notes/Secret.md');

    observer.setMode('ignored');
    const snapshot = observer.getSnapshot();
    expect(snapshot.mode).toBe('ignored');
    expect(snapshot.document).toBeNull();
    expect(snapshot.focus).toBeNull();
    expect(snapshot.graph).toBeNull();

    observer.dispose();
  });

  it('refreshes snapshot on metadataCache changed event', () => {
    const mockFile = { path: 'Notes/Test.md', basename: 'Test', extension: 'md' };
    mockApp.workspace.getActiveViewOfType.mockReturnValue({
      file: mockFile,
      editor: { getSelection: () => '', getCursor: () => ({ line: 0, ch: 0 }) },
      getViewType: () => 'markdown',
    });

    const observer = new ActiveContextObserver(mockApp);
    observer.start();

    mockMetadataChangeCallback?.(mockFile);
    jest.advanceTimersByTime(150);

    expect(observer.getSnapshot().document?.path).toBe('Notes/Test.md');
    observer.dispose();
  });
});
