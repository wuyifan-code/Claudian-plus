/**
 * @jest-environment jsdom
 */
import { uiStateStore } from '@/features/chat/rendering/ui/stateStore';
import {
  pruneDetachedUiBlocks,
  renderUiBlock,
} from '@/features/chat/rendering/UiBlockRenderer';

import { flushFrame, installManualFrames } from './frame';

let blockCounter = 0;

let frames: ReturnType<typeof installManualFrames>;

function renderProgram(source: string): { container: HTMLElement; blockKey: string } {
  blockCounter += 1;
  const blockKey = `data:${blockCounter}`;
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderUiBlock(container, source, { blockKey });
  return { container, blockKey };
}

function pointY(points: string, index: number): number {
  const pair = points.trim().split(/\s+/)[index];
  return Number(pair?.split(',')[1] ?? NaN);
}

describe('data widgets', () => {
  beforeEach(() => {
    frames = installManualFrames();
  });

  afterEach(() => {
    frames.restore();
  });

  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('draws negative bars below the zero baseline', () => {
    const { container } = renderProgram('root = Chart("bar", [["a", -5], ["b", 5]], null, null, 200)');

    const rects = container.querySelectorAll<SVGRectElement>('svg rect');
    expect(rects).toHaveLength(2);
    const negativeY = Number(rects[0]?.getAttribute('y'));
    const positiveY = Number(rects[1]?.getAttribute('y'));
    expect(negativeY).toBeGreaterThan(positiveY);
    expect(Number(rects[0]?.getAttribute('height'))).toBeGreaterThan(0);
    expect(Number(rects[1]?.getAttribute('height'))).toBeGreaterThan(0);
  });

  it('draws a negative line point below a positive one', () => {
    const { container } = renderProgram('root = Chart("line", [["a", -2], ["b", 4]], null, null, 160)');

    const points = container.querySelector('polyline')?.getAttribute('points') ?? '';
    expect(pointY(points, 0)).toBeGreaterThan(pointY(points, 1));
    expect(container.querySelectorAll('circle')).toHaveLength(2);
  });

  it('draws every configured series and a legend', () => {
    const { container } = renderProgram(
      'root = Chart("bar", [["a", 1, 2], ["b", 2, 3]], null, ["x", "y"], 200)',
    );

    expect(container.querySelectorAll('svg rect')).toHaveLength(4);
    const legend = container.querySelectorAll('.claudian-plus-ui-chart-legend-label');
    expect(Array.from(legend).map((item) => item.textContent)).toEqual(['x', 'y']);
    expect(container.querySelector('svg rect title')?.textContent).toContain('a: x 1');
  });

  it('stacks series when requested', () => {
    const { container } = renderProgram(
      'root = Chart("bar", [["a", 1, 2], ["b", 2, 1]], null, ["x", "y"], 200, {stacked: true})',
    );

    const rects = container.querySelectorAll<SVGRectElement>('svg rect');
    expect(rects).toHaveLength(4);
    expect(Number(rects[1]?.getAttribute('y'))).toBeLessThan(Number(rects[0]?.getAttribute('y')));
  });

  it('renders horizontal bars for narrow panels', () => {
    const { container } = renderProgram(
      'root = Chart("bar", [["a", 1], ["b", 2]], null, null, 160, {horizontal: true})',
    );

    const rects = container.querySelectorAll<SVGRectElement>('svg rect');
    expect(rects).toHaveLength(2);
    expect(Number(rects[0]?.getAttribute('width'))).toBeLessThan(Number(rects[1]?.getAttribute('width')));
    expect(container.querySelector('.claudian-plus-ui-chart-legend')).toBeNull();
  });

  it('renders pie slices and slice labels', () => {
    const { container } = renderProgram('root = Chart("donut", [["a", 1], ["b", 1]], null, null, 160)');

    expect(container.querySelectorAll('svg path')).toHaveLength(2);
    expect(container.querySelectorAll('.claudian-plus-ui-chart-legend-label')).toHaveLength(2);
  });

  it('keeps the legacy array-row table working', () => {
    const { container } = renderProgram('root = Table(["Name", "Score"], [["A", 1], ["B", 2]])');

    const headers = container.querySelectorAll('th');
    expect(Array.from(headers).map((item) => item.textContent)).toEqual(['Name', 'Score']);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('A');
  });

  it('sorts by a clicked column and formats numeric cells', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([table], 3)',
      '$sort = ""',
      'table = Table([{key: "name", label: "Name"}, {key: "score", label: "Score", align: "end", format: "compact"}], [{name: "A", score: 1000}, {name: "B", score: 20}], $sort)',
    ].join('\n'));

    const firstColumn = (): string => (
      container.querySelector<HTMLElement>('tbody tr td')?.textContent ?? ''
    );
    expect(firstColumn()).toBe('A');
    expect(container.querySelectorAll<HTMLElement>('tbody tr td')[1]?.textContent).toBe('1k');
    expect(container.querySelectorAll<HTMLElement>('tbody tr td')[1]?.classList.contains('is-align-end'))
      .toBe(true);

    container.querySelectorAll<HTMLElement>('th')[1]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'sort')).toBe('score');
    expect(container.querySelectorAll<HTMLElement>('th')[1]?.getAttribute('aria-sort')).toBe('ascending');
    expect(firstColumn()).toBe('B');

    container.querySelectorAll<HTMLElement>('th')[1]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'sort')).toBe('-score');
    expect(container.querySelectorAll<HTMLElement>('th')[1]?.getAttribute('aria-sort')).toBe('descending');
    expect(firstColumn()).toBe('A');
  });

  it('highlights requested rows', () => {
    const { container } = renderProgram(
      'root = Table([{key: "n", label: "N"}], [{n: 1}, {n: 2}], null, {highlight: [1]})',
    );

    const rows = container.querySelectorAll<HTMLElement>('tbody tr');
    expect(rows[0]?.classList.contains('is-highlighted')).toBe(false);
    expect(rows[1]?.classList.contains('is-highlighted')).toBe(true);
  });

  it('renders a sparkline with its last value as the accessible title', () => {
    const { container } = renderProgram('root = Sparkline([1, 3, 2], "chart2")');

    const line = container.querySelector('polyline');
    expect(line?.getAttribute('stroke')).toBe('var(--color-green)');
    expect(line?.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(3);
    expect(line?.querySelector('title')?.textContent).toBe('2');
  });

  it('renders a horizontal diagram with node descriptions and tones', () => {
    const { container } = renderProgram([
      'root = Diagram([{title: "A", nodes: [{id: "a", label: "A", description: "start", tone: "success"}]}, {title: "B", nodes: [{id: "b", label: "B"}]}], null, {direction: "right"})',
    ].join('\n'));

    const diagram = container.querySelector<HTMLElement>('.claudian-plus-ui-diagram');
    expect(diagram?.classList.contains('is-horizontal')).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-diagram-node-desc')?.textContent).toBe('start');
    expect(container.querySelector<HTMLElement>('.claudian-plus-ui-diagram-node')?.dataset.tone)
      .toBe('success');
  });

  it('highlights the upstream and downstream path of the selected node', () => {
    const { container, blockKey } = renderProgram([
      'root = Col([flow, echo], 3)',
      '$sel = "b"',
      'flow = Diagram([{title: "A", nodes: [{id: "a", label: "A"}]}, {title: "B", nodes: [{id: "b", label: "B"}]}, {title: "C", nodes: [{id: "c", label: "C"}]}], $sel, {edges: [{from: "a", to: "b"}, {from: "b", to: "c", label: "then"}]})',
      'echo = Text("sel=" + $sel)',
    ].join('\n'));

    const nodes = (): NodeListOf<HTMLElement> => (
      container.querySelectorAll<HTMLElement>('.claudian-plus-ui-diagram-node')
    );
    expect(nodes()[0]?.classList.contains('is-on-path')).toBe(true);
    expect(nodes()[1]?.classList.contains('is-selected')).toBe(true);
    expect(nodes()[2]?.classList.contains('is-on-path')).toBe(true);
    expect(container.querySelector('.claudian-plus-ui-diagram-edges')?.textContent)
      .toContain('b → c · then');

    nodes()[2]!.click();
    flushFrame();
    expect(uiStateStore.get(blockKey, 'sel')).toBe('c');
    expect(container.textContent).toContain('sel=c');
    expect(nodes()[0]?.classList.contains('is-on-path')).toBe(true);
    expect(nodes()[1]?.classList.contains('is-on-path')).toBe(true);
    expect(nodes()[2]?.classList.contains('is-selected')).toBe(true);
  });
});
