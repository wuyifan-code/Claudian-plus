import { formatNumber, type ResolvedElement, toDisplayText } from '../evaluate';
import {
  type BuildContext,
  createBlock,
  readBinding,
  readLocalState,
  readNumberValue,
  readRecord,
  readString,
  readTone,
  safeColor,
  SERIES_COLORS,
  type WidgetBuilder,
} from './context';

/* Table ------------------------------------------------------------------- */

interface TableColumn {
  key: string;
  label: string;
  align: 'start' | 'center' | 'end';
  format: string | null;
}

interface TableOptions {
  highlight: Set<number>;
}

function readTableColumns(value: unknown): TableColumn[] {
  const list = Array.isArray(value) ? value : [];
  return list.map((item, index) => {
    const record = readRecord(item);
    if (record === null) {
      return { key: String(index), label: toDisplayText(item), align: 'start', format: null };
    }
    const key = typeof record.key === 'string' ? record.key : String(index);
    const label = typeof record.label === 'string' ? record.label : key;
    const align = record.align === 'center' || record.align === 'end' ? record.align : 'start';
    return { key, label, align, format: typeof record.format === 'string' ? record.format : null };
  });
}

function readTableOptions(value: unknown): TableOptions {
  const record = readRecord(value);
  const highlight = new Set<number>();
  if (record !== null && Array.isArray(record.highlight)) {
    for (const item of record.highlight) {
      const index = readNumberValue(item);
      if (index !== null) highlight.add(Math.trunc(index));
    }
  }
  return { highlight };
}

function readCell(row: unknown, column: TableColumn, columnIndex: number): unknown {
  if (Array.isArray(row)) {
    const numeric = Number(column.key);
    return Number.isInteger(numeric) ? row[numeric] : row[columnIndex];
  }
  if (row !== null && typeof row === 'object') {
    return (row as Record<string, unknown>)[column.key];
  }
  return columnIndex === 0 ? row : null;
}

function compareCells(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return toDisplayText(left).localeCompare(toDisplayText(right), undefined, { numeric: true });
}

function buildTable(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-table-wrap');
  const table = createEl('table', { cls: 'claudian-plus-ui-table' });
  const columns = readTableColumns(element.values[0]);
  const rows: unknown[] = Array.isArray(element.values[1]) ? element.values[1] as unknown[] : [];
  const options = readTableOptions(element.values[3]);

  const binding = readLocalState(element, ctx, 2, 'tableSort');
  const rawSort = typeof binding?.value === 'string' ? binding.value : '';
  const descending = rawSort.startsWith('-');
  const sortKey = descending ? rawSort.slice(1) : rawSort;
  const sortIndex = sortKey.length === 0
    ? -1
    : columns.findIndex((column) => column.key === sortKey || column.label === sortKey);

  const indexed = rows.map((row, index) => ({ row, index }));
  if (sortIndex >= 0) {
    const column = columns[sortIndex];
    indexed.sort((left, right) => {
      const compared = compareCells(readCell(left.row, column, sortIndex), readCell(right.row, column, sortIndex));
      return (descending ? -compared : compared) || left.index - right.index;
    });
  }

  const thead = createEl('thead');
  const headRow = createEl('tr');
  columns.forEach((column, index) => {
    const th = createEl('th', { text: column.label });
    th.dataset.column = column.key;
    th.classList.add(`is-align-${column.align}`);
    if (binding !== null) {
      th.classList.add('is-sortable');
      const active = sortIndex === index;
      th.setAttribute('aria-sort', active ? (descending ? 'descending' : 'ascending') : 'none');
      ctx.on(th, 'click', () => {
        const next = active && !descending ? `-${column.key}` : column.key;
        ctx.setState(binding.name, next);
      });
    }
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = createEl('tbody');
  for (const entry of indexed) {
    const rowEl = createEl('tr');
    if (options.highlight.has(entry.index)) rowEl.classList.add('is-highlighted');
    columns.forEach((column, columnIndex) => {
      const cellEl = createEl('td');
      cellEl.classList.add(`is-align-${column.align}`);
      const cell = readCell(entry.row, column, columnIndex);
      if (column.format !== null && typeof cell === 'number') {
        cellEl.textContent = formatNumber(cell, column.format);
      } else {
        const node = ctx.render(cell);
        if (node !== null) cellEl.appendChild(node);
      }
      rowEl.appendChild(cellEl);
    });
    tbody.appendChild(rowEl);
  }
  table.appendChild(tbody);
  container.appendChild(table);
  return container;
}

/* Chart ------------------------------------------------------------------- */

const CHART_WIDTH = 320;

interface ChartSeries {
  key: string;
  label: string;
  values: number[];
}

interface ChartData {
  labels: string[];
  series: ChartSeries[];
}

interface ChartOptions {
  horizontal: boolean;
  stacked: boolean;
  legend: boolean;
  grid: boolean;
  valueLabels: boolean;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readChartData(element: ResolvedElement): ChartData {
  const rawRows = Array.isArray(element.values[1]) ? element.values[1] : [];
  const xKey = typeof element.values[2] === 'string' ? element.values[2] : null;
  const configured = Array.isArray(element.values[3])
    ? element.values[3].filter((item): item is string => typeof item === 'string')
    : [];

  if (rawRows.length > 0 && rawRows.every((row) => Array.isArray(row))) {
    const rows = rawRows as unknown[][];
    const width = Math.max(1, ...rows.map((row) => Math.max(0, row.length - 1)));
    const keys = configured.length > 0
      ? configured
      : Array.from({ length: width }, (_, index) => `Series ${String(index + 1)}`);
    return {
      labels: rows.map((row, index) => toDisplayText(row[0]) || String(index + 1)),
      series: keys.map((key, seriesIndex) => ({
        key,
        label: key,
        values: rows.map((row) => asNumber(row[seriesIndex + 1])),
      })),
    };
  }

  const records: Record<string, unknown>[] = rawRows.map((row) => (
    row !== null && typeof row === 'object' ? row as Record<string, unknown> : { value: row }
  ));
  const first = records[0] ?? {};
  const inferred = Object.keys(first).find((key) => typeof first[key] === 'number');
  const keys = configured.length > 0
    ? configured
    : inferred === undefined ? [] : [inferred];

  return {
    labels: records.map((record, index) => {
      if (xKey !== null) {
        return toDisplayText(record[xKey]) || String(index + 1);
      }
      const labelKey = Object.keys(record).find((key) => typeof record[key] === 'string');
      return labelKey === undefined ? String(index + 1) : toDisplayText(record[labelKey]);
    }),
    series: keys.map((key) => ({
      key,
      label: key,
      values: records.map((record) => asNumber(record[key])),
    })),
  };
}

function readChartOptions(value: unknown): ChartOptions {
  const record = readRecord(value) ?? {};
  return {
    horizontal: record.horizontal === true,
    stacked: record.stacked === true,
    legend: record.legend !== false,
    grid: record.grid !== false,
    valueLabels: record.valueLabels === true,
  };
}

interface ChartScale {
  min: number;
  max: number;
  y(value: number): number;
  zeroY: number;
}

/** Linear scale that always includes zero, so negatives sit below the baseline. */
function createChartScale(minValue: number, maxValue: number, top: number, height: number): ChartScale {
  const min = Math.min(0, minValue);
  let max = Math.max(0, maxValue);
  if (min === max) max = min + 1;
  const span = max - min;
  const y = (value: number): number => top + ((max - value) / span) * height;
  return { min, max, y, zeroY: y(0) };
}

function seriesExtent(data: ChartData, stacked: boolean): { min: number; max: number } {
  let min = 0;
  let max = 0;
  if (stacked) {
    for (let index = 0; index < data.labels.length; index += 1) {
      let positives = 0;
      let negatives = 0;
      for (const series of data.series) {
        const value = series.values[index] ?? 0;
        if (value >= 0) positives += value;
        else negatives += value;
      }
      max = Math.max(max, positives);
      min = Math.min(min, negatives);
    }
    return { min, max };
  }
  for (const series of data.series) {
    for (const value of series.values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return { min, max };
}

function createSvgNode(tag: keyof SVGElementTagNameMap, attrs: Record<string, string | number>): SVGElement {
  const node = createSvg(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function addTitle(node: SVGElement, text: string): void {
  const title = createSvgNode('title', {});
  title.textContent = text;
  node.appendChild(title);
}

function appendGrid(
  svg: SVGElement,
  scale: ChartScale,
  padding: { top: number; left: number; right: number },
): void {
  const ticks = 4;
  for (let index = 0; index <= ticks; index += 1) {
    const value = scale.min + ((scale.max - scale.min) * index) / ticks;
    const y = scale.y(value);
    const zero = Math.abs(value) < 1e-9;
    svg.appendChild(createSvgNode('line', {
      x1: padding.left,
      x2: CHART_WIDTH - padding.right,
      y1: y,
      y2: y,
      stroke: zero ? 'var(--claudian-plus-border)' : 'var(--claudian-plus-surface-alt)',
      'stroke-width': 1,
    }));
    const label = createSvgNode('text', {
      x: padding.left - 4,
      y: y + 3,
      'text-anchor': 'end',
      'font-size': 8,
      fill: 'var(--claudian-plus-text-faint)',
    });
    label.textContent = formatNumber(Math.round(value * 100) / 100);
    svg.appendChild(label);
  }
}

function buildVerticalBars(data: ChartData, options: ChartOptions, height: number): SVGElement {
  const padding = { top: 12, bottom: 22, left: 36, right: 8 };
  const plotWidth = CHART_WIDTH - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const extent = seriesExtent(data, options.stacked);
  const scale = createChartScale(extent.min, extent.max, padding.top, plotHeight);

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${height}`,
    width: '100%',
    height,
    role: 'img',
  });
  if (options.grid) appendGrid(svg, scale, padding);

  const slot = plotWidth / Math.max(1, data.labels.length);
  const groupWidth = slot * 0.66;
  const seriesCount = Math.max(1, data.series.length);
  const barWidth = options.stacked ? groupWidth : Math.max(2, groupWidth / seriesCount);

  data.labels.forEach((label, index) => {
    let positiveBase = 0;
    let negativeBase = 0;
    data.series.forEach((series, seriesIndex) => {
      const value = series.values[index] ?? 0;
      let start = 0;
      let end = value;
      if (options.stacked) {
        if (value >= 0) {
          start = positiveBase;
          end = positiveBase + value;
          positiveBase = end;
        } else {
          start = negativeBase;
          end = negativeBase + value;
          negativeBase = end;
        }
      }
      const top = scale.y(end);
      const bottom = scale.y(start);
      const x = padding.left + slot * index + (slot - groupWidth) / 2
        + (options.stacked ? 0 : seriesIndex * barWidth);
      const rect = createSvgNode('rect', {
        x,
        y: Math.min(top, bottom),
        width: barWidth,
        height: Math.max(1, Math.abs(bottom - top)),
        rx: 2,
        fill: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      });
      addTitle(rect, `${label}: ${series.label} ${formatNumber(value)}`);
      svg.appendChild(rect);

      if (options.valueLabels && !options.stacked && value !== 0) {
        const text = createSvgNode('text', {
          x: x + barWidth / 2,
          y: value >= 0 ? top - 3 : bottom + 9,
          'text-anchor': 'middle',
          'font-size': 8,
          fill: 'var(--claudian-plus-text-muted)',
        });
        text.textContent = formatNumber(value);
        svg.appendChild(text);
      }
    });

    const labelEl = createSvgNode('text', {
      x: padding.left + slot * index + slot / 2,
      y: height - 6,
      'text-anchor': 'middle',
      'font-size': 9,
      fill: 'var(--claudian-plus-text-faint)',
    });
    labelEl.textContent = label;
    svg.appendChild(labelEl);
  });

  return svg;
}

function truncateLabel(label: string, max: number): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

function buildHorizontalBars(data: ChartData, options: ChartOptions, height: number): SVGElement {
  const padding = { top: 8, bottom: 8, left: 88, right: 10 };
  const plotWidth = CHART_WIDTH - padding.left - padding.right;
  const rows = Math.max(1, data.labels.length);
  const rowHeight = Math.max(16, (height - padding.top - padding.bottom) / rows);
  const extent = seriesExtent(data, options.stacked);
  const min = Math.min(0, extent.min);
  const max = Math.max(0, extent.max);
  const x = (value: number): number => padding.left + ((value - min) / (max - min || 1)) * plotWidth;
  const zeroX = x(0);

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${height}`,
    width: '100%',
    height,
    role: 'img',
  });

  const seriesCount = Math.max(1, data.series.length);
  data.labels.forEach((label, index) => {
    const rowTop = padding.top + index * rowHeight;
    const labelEl = createSvgNode('text', {
      x: 0,
      y: rowTop + rowHeight / 2 + 3,
      'font-size': 9,
      fill: 'var(--claudian-plus-text-muted)',
    });
    labelEl.textContent = truncateLabel(label, 12);
    svg.appendChild(labelEl);

    let positiveBase = 0;
    let negativeBase = 0;
    const barHeight = options.stacked
      ? Math.max(4, Math.min(14, rowHeight * 0.6))
      : Math.max(3, Math.min(10, (rowHeight * 0.6) / seriesCount));

    data.series.forEach((series, seriesIndex) => {
      const value = series.values[index] ?? 0;
      let start = 0;
      let end = value;
      if (options.stacked) {
        if (value >= 0) {
          start = positiveBase;
          end = positiveBase + value;
          positiveBase = end;
        } else {
          start = negativeBase;
          end = negativeBase + value;
          negativeBase = end;
        }
      }
      const x1 = x(start);
      const x2 = x(end);
      const top = rowTop + (rowHeight - barHeight * seriesCount) / 2
        + (options.stacked ? 0 : seriesIndex * barHeight);
      const rect = createSvgNode('rect', {
        x: Math.min(x1, x2),
        y: top,
        width: Math.max(1, Math.abs(x2 - x1)),
        height: barHeight,
        rx: 2,
        fill: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      });
      addTitle(rect, `${label}: ${series.label} ${formatNumber(value)}`);
      svg.appendChild(rect);
    });
  });

  svg.appendChild(createSvgNode('line', {
    x1: zeroX,
    x2: zeroX,
    y1: padding.top,
    y2: Math.max(padding.top, padding.top + rows * rowHeight),
    stroke: 'var(--claudian-plus-border)',
    'stroke-width': 1,
  }));

  return svg;
}

function buildLineChart(
  data: ChartData,
  options: ChartOptions,
  height: number,
  area: boolean,
): SVGElement {
  const padding = { top: 12, bottom: 22, left: 36, right: 8 };
  const plotWidth = CHART_WIDTH - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const extent = seriesExtent(data, false);
  const scale = createChartScale(extent.min, extent.max, padding.top, plotHeight);
  const step = data.labels.length <= 1 ? plotWidth : plotWidth / (data.labels.length - 1);

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${height}`,
    width: '100%',
    height,
    role: 'img',
  });
  if (options.grid) appendGrid(svg, scale, padding);

  data.series.forEach((series, seriesIndex) => {
    const coordinates = series.values.map((value, index) => (
      `${padding.left + step * index},${scale.y(value)}`
    ));
    if (area && seriesIndex === 0 && coordinates.length > 1) {
      const firstX = coordinates[0]?.split(',')[0] ?? String(padding.left);
      const lastX = coordinates[coordinates.length - 1]?.split(',')[0] ?? String(CHART_WIDTH);
      svg.appendChild(createSvgNode('polygon', {
        points: `${firstX},${scale.zeroY} ${coordinates.join(' ')} ${lastX},${scale.zeroY}`,
        fill: 'var(--claudian-plus-surface-alt)',
      }));
    }
    svg.appendChild(createSvgNode('polyline', {
      points: coordinates.join(' '),
      fill: 'none',
      stroke: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    }));
    series.values.forEach((value, index) => {
      const dot = createSvgNode('circle', {
        cx: padding.left + step * index,
        cy: scale.y(value),
        r: 2,
        fill: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
      });
      addTitle(dot, `${data.labels[index] ?? String(index + 1)}: ${series.label} ${formatNumber(value)}`);
      svg.appendChild(dot);
    });
  });

  const labelEvery = Math.max(1, Math.ceil(data.labels.length / 8));
  data.labels.forEach((label, index) => {
    if (index % labelEvery !== 0 && index !== data.labels.length - 1) return;
    const labelEl = createSvgNode('text', {
      x: padding.left + step * index,
      y: height - 6,
      'text-anchor': 'middle',
      'font-size': 9,
      fill: 'var(--claudian-plus-text-faint)',
    });
    labelEl.textContent = label;
    svg.appendChild(labelEl);
  });

  return svg;
}

function buildPieChart(data: ChartData, height: number, donut: boolean): SVGElement {
  const values = data.series[0]?.values ?? [];
  const labels = data.labels;
  const size = Math.min(CHART_WIDTH, height);
  const radius = size / 2 - 6;
  const center = size / 2;
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0) || 1;

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${height}`,
    width: '100%',
    height,
    role: 'img',
  });

  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const slice = (Math.abs(value) / total) * Math.PI * 2;
    const end = angle + slice;
    const x1 = center + radius * Math.cos(angle);
    const y1 = center + radius * Math.sin(angle);
    const x2 = center + radius * Math.cos(end);
    const y2 = center + radius * Math.sin(end);
    const largeArc = slice > Math.PI ? 1 : 0;
    const color = SERIES_COLORS[index % SERIES_COLORS.length];
    const path = donut
      ? `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`
      : `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    const node = createSvgNode('path', {
      d: path,
      fill: donut ? 'none' : color,
      stroke: color,
      'stroke-width': donut ? 14 : 0,
    });
    addTitle(node, `${labels[index] ?? String(index + 1)}: ${formatNumber(value)}`);
    svg.appendChild(node);
    angle = end;
  });

  return svg;
}

function buildChartLegend(data: ChartData, labels?: string[]): HTMLElement {
  const legend = createDiv({ cls: 'claudian-plus-ui-chart-legend' });
  const entries = labels === undefined
    ? data.series.map((series) => series.label)
    : labels;
  entries.forEach((label, index) => {
    const item = createSpan({ cls: 'claudian-plus-ui-chart-legend-item' });
    const swatch = createSpan({ cls: 'claudian-plus-ui-chart-legend-swatch' });
    swatch.setCssProps({ background: SERIES_COLORS[index % SERIES_COLORS.length] });
    item.appendChild(swatch);
    item.appendChild(createSpan({ cls: 'claudian-plus-ui-chart-legend-label', text: label }));
    legend.appendChild(item);
  });
  return legend;
}

function buildChart(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-chart');
  const type = readString(element, 0) ?? 'bar';
  const data = readChartData(element);
  const height = Math.max(80, Math.min(360, readNumberValue(element.values[4]) ?? 160));
  const options = readChartOptions(element.values[5]);

  const svg = type === 'pie' || type === 'donut'
    ? buildPieChart(data, height, type === 'donut')
    : type === 'line' || type === 'area'
      ? buildLineChart(data, options, height, type === 'area')
      : options.horizontal
        ? buildHorizontalBars(data, options, height)
        : buildVerticalBars(data, options, height);

  container.appendChild(svg);
  if (options.legend) {
    if (type === 'pie' || type === 'donut') {
      if (data.labels.length > 1) container.appendChild(buildChartLegend(data, data.labels));
    } else if (data.series.length > 1) {
      container.appendChild(buildChartLegend(data));
    }
  }
  return container;
}

/* Sparkline --------------------------------------------------------------- */

function buildSparkline(element: ResolvedElement): HTMLElement {
  const container = createBlock('claudian-plus-ui-sparkline');
  const values = (Array.isArray(element.values[0]) ? element.values[0] : []).map(asNumber);
  if (values.length === 0) return container;

  const width = 100;
  const height = 24;
  const padding = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length <= 1 ? 0 : (width - padding * 2) / (values.length - 1);
  const points = values.map((value, index) => (
    `${padding + step * index},${padding + (1 - (value - min) / span) * (height - padding * 2)}`
  )).join(' ');

  const svg = createSvgNode('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height,
    role: 'img',
  });
  const line = createSvgNode('polyline', {
    points,
    fill: 'none',
    stroke: safeColor(element.values[1]) ?? 'var(--claudian-plus-text-accent)',
    'stroke-width': 1.5,
    'stroke-linejoin': 'round',
  });
  addTitle(line, formatNumber(values[values.length - 1]));
  svg.appendChild(line);
  container.appendChild(svg);
  return container;
}

/* Diagram ----------------------------------------------------------------- */

interface DiagramNode {
  id: string;
  label: string;
  description: string;
  tone: string;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

interface DiagramOptions {
  direction: 'down' | 'right';
  edges: DiagramEdge[];
}

function readDiagramLayers(value: unknown): Array<{ title: string; nodes: DiagramNode[] }> {
  if (!Array.isArray(value)) return [];

  return value.map((layer, layerIndex) => {
    if (typeof layer === 'string') {
      return { title: '', nodes: [{ id: layer, label: layer, description: '', tone: 'neutral' }] };
    }
    if (layer === null || typeof layer !== 'object') {
      return {
        title: '',
        nodes: [{ id: `layer-${String(layerIndex)}`, label: '', description: '', tone: 'neutral' }],
      };
    }

    const record = layer as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title : '';
    const rawNodes = Array.isArray(record.nodes) ? record.nodes : [];

    const nodes: DiagramNode[] = rawNodes.map((node, nodeIndex) => {
      if (typeof node === 'string') {
        return { id: node, label: node, description: '', tone: 'neutral' };
      }
      if (node === null || typeof node !== 'object') {
        const fallback = String(nodeIndex + 1);
        return { id: fallback, label: fallback, description: '', tone: 'neutral' };
      }
      const nodeRecord = node as Record<string, unknown>;
      const label = typeof nodeRecord.label === 'string'
        ? nodeRecord.label
        : typeof nodeRecord.id === 'string' ? nodeRecord.id : String(nodeIndex + 1);
      const id = typeof nodeRecord.id === 'string' ? nodeRecord.id : label;
      return {
        id,
        label,
        description: typeof nodeRecord.description === 'string' ? nodeRecord.description : '',
        tone: readTone(nodeRecord.tone),
      };
    });

    return { title, nodes };
  });
}

function readDiagramOptions(value: unknown): DiagramOptions {
  const record = readRecord(value);
  const direction = record?.direction === 'right' ? 'right' : 'down';
  const edges: DiagramEdge[] = [];
  const rawEdges = record?.edges;
  if (Array.isArray(rawEdges)) {
    for (const item of rawEdges) {
      const edge = readRecord(item);
      if (edge === null) continue;
      const from = typeof edge.from === 'string' ? edge.from : '';
      const to = typeof edge.to === 'string' ? edge.to : '';
      if (from.length === 0 || to.length === 0) continue;
      edges.push({ from, to, label: typeof edge.label === 'string' ? edge.label : '' });
    }
  }
  return { direction, edges };
}

/** Nodes reachable from the selection in either direction along the edges. */
function traceDiagramPath(selected: string, edges: readonly DiagramEdge[]): Set<string> {
  const path = new Set<string>();
  if (selected.length === 0) return path;
  path.add(selected);

  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const edge of edges) {
    add(forward, edge.from, edge.to);
    add(backward, edge.to, edge.from);
  }

  for (const map of [forward, backward]) {
    const queue = [selected];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (id === undefined) continue;
      for (const next of map.get(id) ?? []) {
        if (path.has(next)) continue;
        path.add(next);
        queue.push(next);
      }
    }
  }
  return path;
}

/**
 * Flow diagram: layers of clickable nodes with connectors between them. Layout
 * stays pure HTML/CSS (vertical by default, horizontal on request) so labels
 * follow the theme; edges drive upstream/downstream path highlighting.
 */
function buildDiagram(element: ResolvedElement, ctx: BuildContext): HTMLElement {
  const container = createBlock('claudian-plus-ui-diagram');
  const layers = readDiagramLayers(element.values[0]);
  const binding = readBinding(element, 1);
  const selected = toDisplayText(binding?.value ?? '');
  const options = readDiagramOptions(element.values[2]);
  if (options.direction === 'right') container.classList.add('is-horizontal');
  const path = traceDiagramPath(selected, options.edges);

  layers.forEach((layer, layerIndex) => {
    const layerEl = createDiv({ cls: 'claudian-plus-ui-diagram-layer' });
    if (layer.title.length > 0) {
      layerEl.appendChild(createDiv({
        cls: 'claudian-plus-ui-diagram-layer-title',
        text: layer.title,
      }));
    }

    const nodesEl = createDiv({ cls: 'claudian-plus-ui-diagram-nodes' });
    for (const node of layer.nodes) {
      const chip = createEl('button', { cls: 'claudian-plus-ui-diagram-node' });
      chip.dataset.nodeId = node.id;
      if (node.tone !== 'neutral') chip.dataset.tone = node.tone;
      if (node.id === selected) chip.classList.add('is-selected');
      else if (path.has(node.id)) chip.classList.add('is-on-path');
      chip.setAttribute('type', 'button');
      chip.appendChild(createSpan({ cls: 'claudian-plus-ui-diagram-node-label', text: node.label }));
      if (node.description.length > 0) {
        chip.appendChild(createSpan({
          cls: 'claudian-plus-ui-diagram-node-desc',
          text: node.description,
        }));
      }
      ctx.on(chip, 'click', () => {
        if (binding === null) return;
        ctx.setState(binding.name, node.id);
      });
      nodesEl.appendChild(chip);
    }
    layerEl.appendChild(nodesEl);
    container.appendChild(layerEl);

    if (layerIndex < layers.length - 1) {
      container.appendChild(createDiv({ cls: 'claudian-plus-ui-diagram-connector' }));
    }
  });

  if (options.edges.length > 0) {
    const edgesEl = createDiv({ cls: 'claudian-plus-ui-diagram-edges' });
    for (const edge of options.edges) {
      edgesEl.appendChild(createDiv({
        cls: 'claudian-plus-ui-diagram-edge',
        text: edge.label.length > 0
          ? `${edge.from} → ${edge.to} · ${edge.label}`
          : `${edge.from} → ${edge.to}`,
      }));
    }
    container.appendChild(edgesEl);
  }

  return container;
}

export const DATA_WIDGETS: Record<string, WidgetBuilder> = {
  Table: buildTable,
  Chart: buildChart,
  Sparkline: buildSparkline,
  Diagram: buildDiagram,
};
