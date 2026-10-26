/**
 * @jest-environment jsdom
 */
import { UI_CATALOG } from '@/core/prompt/uiCatalog';
import { UiStateStore } from '@/features/chat/rendering/ui/stateStore';
import { WIDGETS } from '@/features/chat/rendering/ui/widgets';
import {
  pruneDetachedUiBlocks,
  renderUiBlock,
} from '@/features/chat/rendering/UiBlockRenderer';

/** Minimal program per component that declares `$x` at its bound position. */
const BOUND_PROGRAMS: Record<string, string> = {
  Input: 'root = Input($x, "X")',
  Slider: 'root = Slider($x, 0, 10)',
  Select: 'root = Select($x, ["a", "b"])',
  Checkbox: 'root = Checkbox($x)',
  SegmentedControl: 'root = SegmentedControl($x, ["a", "b"])',
  ChoiceCards: 'root = ChoiceCards($x, [{id: "a", title: "A"}])',
  RadioGroup: 'root = RadioGroup($x, [{value: "a", label: "A"}])',
  Switch: 'root = Switch($x)',
  TextArea: 'root = TextArea($x)',
  NumberStepper: 'root = NumberStepper($x, 0, 10)',
  DatePicker: 'root = DatePicker($x)',
  Table: 'root = Table(["A"], [["a"]], $x)',
  Diagram: 'root = Diagram(["a"], $x)',
  Tabs: 'root = Tabs($x, [{label: "A", content: Text("a")}])',
  Accordion: 'root = Accordion([{title: "A", content: Text("a")}], $x)',
  Steps: 'root = Steps(["A"], $x)',
  Checklist: 'root = Checklist(["A"], $x)',
};

/** Controls that expose their binding through `data-ui-binding`. */
const DATA_BINDING_COMPONENTS = new Set([
  'Input', 'Slider', 'Select', 'Checkbox', 'TextArea', 'NumberStepper', 'DatePicker',
]);

/** Components that write state from a click instead of a native control. */
const CLICK_SELECTORS: Record<string, string> = {
  SegmentedControl: '.claudian-plus-ui-segment',
  ChoiceCards: '.claudian-plus-ui-choice-card',
  RadioGroup: '.claudian-plus-ui-radio',
  Switch: '.claudian-plus-ui-switch',
  Table: 'th',
  Diagram: '.claudian-plus-ui-diagram-node',
  Tabs: '.claudian-plus-ui-tab',
  Accordion: '.claudian-plus-ui-accordion-header',
  Steps: '.claudian-plus-ui-step',
  Checklist: '.claudian-plus-ui-checklist-item',
};

describe('UI catalog ⇄ widget registry', () => {
  afterEach(() => {
    document.body.replaceChildren();
    pruneDetachedUiBlocks();
  });

  it('has exactly the same component names in both directions', () => {
    const catalog = new Set(UI_CATALOG.map((entry) => entry.name));
    const registry = new Set(Object.keys(WIDGETS));

    expect([...registry].filter((name) => !catalog.has(name))).toEqual([]);
    expect([...catalog].filter((name) => !registry.has(name))).toEqual([]);
  });

  it('has a minimal binding program for every component that declares bindings', () => {
    const declared = UI_CATALOG
      .filter((entry) => (entry.bindings ?? []).length > 0)
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(BOUND_PROGRAMS).sort()).toEqual(declared);
  });

  it('exposes data-ui-binding for every native control binding', () => {
    for (const entry of UI_CATALOG) {
      if (!DATA_BINDING_COMPONENTS.has(entry.name)) continue;
      const program = BOUND_PROGRAMS[entry.name];
      expect(program).toBeDefined();

      const store = new UiStateStore();
      const container = document.createElement('div');
      document.body.appendChild(container);
      expect(renderUiBlock(container, program, { blockKey: `parity:${entry.name}`, store })).toBe(true);
      expect(container.querySelector('[data-ui-binding="x"]')).not.toBeNull();
    }
  });

  it('writes the bound variable from a click for every non-native binding', () => {
    for (const entry of UI_CATALOG) {
      if (DATA_BINDING_COMPONENTS.has(entry.name)) continue;
      if ((entry.bindings ?? []).length === 0) continue;
      const program = BOUND_PROGRAMS[entry.name];
      expect(program).toBeDefined();

      const selector = CLICK_SELECTORS[entry.name];
      expect(selector).toBeDefined();

      const store = new UiStateStore();
      const blockKey = `parity:${entry.name}`;
      const container = document.createElement('div');
      document.body.appendChild(container);
      expect(renderUiBlock(container, program, { blockKey, store })).toBe(true);

      const target = container.querySelector<HTMLElement>(selector);
      expect(target).not.toBeNull();
      target!.click();
      expect(store.has(blockKey, 'x')).toBe(true);
    }
  });
});
