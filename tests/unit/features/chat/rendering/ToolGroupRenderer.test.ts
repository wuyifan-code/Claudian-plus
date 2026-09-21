import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import type { ToolCallInfo } from '@/core/types';
import {
  buildToolGroupSummary,
  createLiveToolGroup,
  determineToolGroupStatus,
  renderStoredToolGroup,
  updateToolGroupStatusEl,
} from '@/features/chat/rendering/ToolGroupRenderer';

jest.mock('obsidian', () => ({
  setIcon: jest.fn(),
}));

function createToolCall(id: string, name: string, status: ToolCallInfo['status'] = 'completed'): ToolCallInfo {
  return {
    id,
    name,
    input: {},
    status,
    isExpanded: false,
  };
}

describe('ToolGroupRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildToolGroupSummary', () => {
    it('returns singular call text for 1 tool call', () => {
      const tools = [createToolCall('1', 'run_command')];
      const summary = buildToolGroupSummary(tools);
      expect(summary.countText).toContain('1');
      expect(summary.previewText).toBe('· run_command');
    });

    it('returns plural calls text and joins unique tool names', () => {
      const tools = [
        createToolCall('1', 'run_command'),
        createToolCall('2', 'write_to_file'),
        createToolCall('3', 'run_command'),
      ];
      const summary = buildToolGroupSummary(tools);
      expect(summary.countText).toContain('3');
      expect(summary.previewText).toBe('· run_command, write_to_file');
    });

    it('truncates preview names with ellipsis when more than 3 distinct names', () => {
      const tools = [
        createToolCall('1', 'run_command'),
        createToolCall('2', 'write_to_file'),
        createToolCall('3', 'manage_task'),
        createToolCall('4', 'view_file'),
      ];
      const summary = buildToolGroupSummary(tools);
      expect(summary.countText).toContain('4');
      expect(summary.previewText).toBe('· run_command, write_to_file, manage_task...');
    });
  });

  describe('determineToolGroupStatus', () => {
    it('returns completed when all tools succeeded', () => {
      const tools = [
        createToolCall('1', 'read', 'completed'),
        createToolCall('2', 'write', 'completed'),
      ];
      expect(determineToolGroupStatus(tools)).toBe('completed');
    });

    it('returns error when any tool has an error', () => {
      const tools = [
        createToolCall('1', 'read', 'completed'),
        createToolCall('2', 'run_command', 'error'),
        createToolCall('3', 'write', 'completed'),
      ];
      expect(determineToolGroupStatus(tools)).toBe('error');
    });

    it('returns blocked when any tool is blocked and none has error', () => {
      const tools = [
        createToolCall('1', 'read', 'completed'),
        createToolCall('2', 'write', 'blocked'),
      ];
      expect(determineToolGroupStatus(tools)).toBe('blocked');
    });

    it('returns running when any tool is running and none has error/blocked', () => {
      const tools = [
        createToolCall('1', 'read', 'completed'),
        createToolCall('2', 'write', 'running'),
      ];
      expect(determineToolGroupStatus(tools)).toBe('running');
    });
  });

  describe('updateToolGroupStatusEl', () => {
    it('sets check icon for completed', () => {
      const el = createMockEl();
      updateToolGroupStatusEl(el, 'completed');
      expect(el.classList.contains('status-completed')).toBe(true);
      expect(setIcon).toHaveBeenCalledWith(el, 'check');
    });

    it('sets x icon for error', () => {
      const el = createMockEl();
      updateToolGroupStatusEl(el, 'error');
      expect(el.classList.contains('status-error')).toBe(true);
      expect(setIcon).toHaveBeenCalledWith(el, 'x');
    });

    it('sets shield-off icon for blocked', () => {
      const el = createMockEl();
      updateToolGroupStatusEl(el, 'blocked');
      expect(el.classList.contains('status-blocked')).toBe(true);
      expect(setIcon).toHaveBeenCalledWith(el, 'shield-off');
    });

    it('sets loader-2 icon for running', () => {
      const el = createMockEl();
      updateToolGroupStatusEl(el, 'running');
      expect(el.classList.contains('status-running')).toBe(true);
      expect(setIcon).toHaveBeenCalledWith(el, 'loader-2');
    });
  });

  describe('renderStoredToolGroup', () => {
    it('renders a collapsed tool group by default', () => {
      const parentEl = createMockEl();
      const tools = [
        createToolCall('1', 'run_command', 'completed'),
        createToolCall('2', 'write_to_file', 'completed'),
      ];
      const renderedCalls: string[] = [];

      const groupEl = renderStoredToolGroup(parentEl, tools, (container, tc) => {
        renderedCalls.push(tc.id);
        const childEl = container.createDiv({ cls: 'claudian-plus-tool-call' });
        childEl.dataset.toolId = tc.id;
      });

      expect(groupEl.classList.contains('claudian-plus-tool-group')).toBe(true);
      expect(groupEl.classList.contains('expanded')).toBe(false);

      const header = groupEl.querySelector('.claudian-plus-tool-group-header')!;
      expect(header).not.toBeNull();
      expect(header.getAttribute('aria-expanded')).toBe('false');

      const count = groupEl.querySelector('.claudian-plus-tool-group-count')!;
      expect(count.textContent).toContain('2');

      const preview = groupEl.querySelector('.claudian-plus-tool-group-preview')!;
      expect(preview.textContent).toBe('· run_command, write_to_file');

      const list = groupEl.querySelector('.claudian-plus-tool-group-list')!;
      expect(list.classList.contains('claudian-plus-hidden')).toBe(true);
      expect(renderedCalls).toEqual(['1', '2']);
    });

    it('toggles expansion on header click', () => {
      const parentEl = createMockEl();
      const tools = [
        createToolCall('1', 'run_command', 'completed'),
        createToolCall('2', 'write_to_file', 'completed'),
      ];

      const groupEl = renderStoredToolGroup(parentEl, tools, () => {});
      const header = groupEl.querySelector('.claudian-plus-tool-group-header') as HTMLElement;
      const list = groupEl.querySelector('.claudian-plus-tool-group-list') as HTMLElement;

      // Click to expand
      header.click();
      expect(groupEl.classList.contains('expanded')).toBe(true);
      expect(list.classList.contains('claudian-plus-hidden')).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('true');

      // Click to collapse
      header.click();
      expect(groupEl.classList.contains('expanded')).toBe(false);
      expect(list.classList.contains('claudian-plus-hidden')).toBe(true);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });

    it('shows error status when a tool failed in the group', () => {
      const parentEl = createMockEl();
      const tools = [
        createToolCall('1', 'run_command', 'completed'),
        createToolCall('2', 'run_command', 'error'),
        createToolCall('3', 'view_file', 'completed'),
      ];

      const groupEl = renderStoredToolGroup(parentEl, tools, () => {});
      const statusEl = groupEl.querySelector('.claudian-plus-tool-group-status')!;
      expect(statusEl.classList.contains('status-error')).toBe(true);
    });
  });

  describe('createLiveToolGroup', () => {
    it('starts expanded during streaming', () => {
      const parentEl = createMockEl();
      const liveGroup = createLiveToolGroup(parentEl);

      expect(liveGroup.containerEl.classList.contains('expanded')).toBe(true);
      expect(liveGroup.listEl.classList.contains('claudian-plus-hidden')).toBe(false);
    });

    it('updates header and status as tools are added and complete', () => {
      const parentEl = createMockEl();
      const liveGroup = createLiveToolGroup(parentEl);

      const t1 = createToolCall('1', 'run_command', 'running');
      const el1 = liveGroup.listEl.createDiv();
      liveGroup.addToolCall(t1, el1);

      expect(liveGroup.countEl.textContent).toContain('1');
      expect(liveGroup.previewEl.textContent).toBe('· run_command');
      expect(liveGroup.statusEl.classList.contains('status-running')).toBe(true);

      const t2 = createToolCall('2', 'write_to_file', 'completed');
      const el2 = liveGroup.listEl.createDiv();
      liveGroup.addToolCall(t2, el2);

      t1.status = 'completed';
      liveGroup.updateStatus();

      expect(liveGroup.countEl.textContent).toContain('2');
      expect(liveGroup.previewEl.textContent).toBe('· run_command, write_to_file');
      expect(liveGroup.statusEl.classList.contains('status-completed')).toBe(true);
    });

    it('autoCollapse closes the group cleanly', () => {
      const parentEl = createMockEl();
      const liveGroup = createLiveToolGroup(parentEl);

      liveGroup.addToolCall(createToolCall('1', 'run_command', 'completed'));
      liveGroup.addToolCall(createToolCall('2', 'write_to_file', 'completed'));

      liveGroup.autoCollapse();

      expect(liveGroup.containerEl.classList.contains('expanded')).toBe(false);
      expect(liveGroup.listEl.classList.contains('claudian-plus-hidden')).toBe(true);
      expect(liveGroup.headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('finalize unwraps single tool element when only 1 tool was executed', () => {
      const parentEl = createMockEl();
      const liveGroup = createLiveToolGroup(parentEl);

      const t1 = createToolCall('1', 'run_command', 'completed');
      const toolEl = liveGroup.listEl.createDiv({ cls: 'claudian-plus-tool-call' });
      liveGroup.addToolCall(t1, toolEl);

      liveGroup.finalize();

      // The group container should be removed, and toolEl should now be directly in parentEl
      expect(parentEl.contains(toolEl)).toBe(true);
      expect(parentEl.contains(liveGroup.containerEl)).toBe(false);
    });

    it('finalize auto-collapses when 2 or more tools were executed', () => {
      const parentEl = createMockEl();
      const liveGroup = createLiveToolGroup(parentEl);

      const t1 = createToolCall('1', 'run_command', 'completed');
      const el1 = liveGroup.listEl.createDiv();
      liveGroup.addToolCall(t1, el1);

      const t2 = createToolCall('2', 'write_to_file', 'completed');
      const el2 = liveGroup.listEl.createDiv();
      liveGroup.addToolCall(t2, el2);

      liveGroup.finalize();

      // Group container remains in parentEl and is collapsed
      expect(parentEl.contains(liveGroup.containerEl)).toBe(true);
      expect(liveGroup.containerEl.classList.contains('expanded')).toBe(false);
      expect(liveGroup.listEl.classList.contains('claudian-plus-hidden')).toBe(true);
    });
  });
});
