/**
 * Single source of truth for the generated-UI component vocabulary.
 *
 * Pure data lives in `core/` so the prompt can be assembled here while the
 * renderers stay in `features/`. The registry-parity test keeps this catalog
 * and `widgets/index.ts` identical.
 */

export type UiComponentGroup =
  | 'Layout'
  | 'Text'
  | 'Data'
  | 'Inputs'
  | 'Structure'
  | 'Learning'
  | 'Obsidian';

export interface UiComponentSpec {
  name: string;
  group: UiComponentGroup;
  /** Positional signature shown to the model. */
  signature: string;
  /** Human description used by docs and future per-component help. */
  description: string;
  /** Argument indexes declared with `$name`, i.e. two-way bound state. */
  bindings?: number[];
}

export const UI_CATALOG: readonly UiComponentSpec[] = [
  // Layout
  {
    name: 'Col',
    group: 'Layout',
    signature: 'Col(children, gap?)',
    description: 'Vertical stack.',
  },
  {
    name: 'Row',
    group: 'Layout',
    signature: 'Row(children, gap?, align?, justify?, wrap?)',
    description: 'Horizontal row with alignment and wrapping.',
  },
  {
    name: 'Box',
    group: 'Layout',
    signature: 'Box(children, direction?, gap?, padding?, background?, border?)',
    description: 'Bordered or tinted container.',
  },
  {
    name: 'Grid',
    group: 'Layout',
    signature: 'Grid(children, columns?, gap?)',
    description: 'Grid of up to four columns.',
  },
  {
    name: 'Card',
    group: 'Layout',
    signature: 'Card(children, variant? "outline"|"soft", title?, subtitle?, icon?)',
    description: 'Card with an optional header slot.',
  },
  {
    name: 'Divider',
    group: 'Layout',
    signature: 'Divider()',
    description: 'Horizontal rule.',
  },
  {
    name: 'Spacer',
    group: 'Layout',
    signature: 'Spacer()',
    description: 'Flexible space between siblings.',
  },

  // Text
  {
    name: 'Title',
    group: 'Text',
    signature: 'Title(text, size? "sm"|"md"|"lg"|"xl", color?)',
    description: 'Heading.',
  },
  {
    name: 'Text',
    group: 'Text',
    signature: 'Text(text, size?, color?, weight?, italic?)',
    description: 'Body text with optional emphasis.',
  },
  {
    name: 'Caption',
    group: 'Text',
    signature: 'Caption(text, color?)',
    description: 'Small secondary text.',
  },
  {
    name: 'Badge',
    group: 'Text',
    signature: 'Badge(text, color?)',
    description: 'Inline pill label.',
  },
  {
    name: 'Code',
    group: 'Text',
    signature: 'Code(code, language?)',
    description: 'Code block.',
  },
  {
    name: 'Quote',
    group: 'Text',
    signature: 'Quote(text, cite?)',
    description: 'Quotation with an optional source.',
  },
  {
    name: 'List',
    group: 'Text',
    signature: 'List(children, marker?)',
    description: 'Bulleted, numbered or plain list.',
  },
  {
    name: 'ListItem',
    group: 'Text',
    signature: 'ListItem(title, description?, children?)',
    description: 'List row with a secondary line and nested content.',
  },
  {
    name: 'Link',
    group: 'Text',
    signature: 'Link(text, url)',
    description: 'External http(s) link.',
  },
  {
    name: 'Icon',
    group: 'Text',
    signature: 'Icon(name, size? "sm"|"lg"|"xl", color?)',
    description: 'Lucide icon by name.',
  },
  {
    name: 'Markdown',
    group: 'Text',
    signature: 'Markdown(text)',
    description: 'Rich markdown inside a widget.',
  },
  {
    name: 'Math',
    group: 'Text',
    signature: 'Math(tex, block?)',
    description: 'Inline or display LaTeX.',
  },
  {
    name: 'Progress',
    group: 'Text',
    signature: 'Progress(value, max?, label?, variant? "bar"|"ring")',
    description: 'Progress bar or ring.',
  },

  // Data
  {
    name: 'Table',
    group: 'Data',
    signature: 'Table(columns, rows, $sort?, options?)',
    description: 'Sortable table; columns may be strings or {key, label, align, format}.',
    bindings: [2],
  },
  {
    name: 'Chart',
    group: 'Data',
    signature: 'Chart(type "bar"|"line"|"area"|"pie"|"donut", data, x?, series?, height?, options?)',
    description: 'SVG chart; options: horizontal, stacked, legend, grid, valueLabels.',
  },
  {
    name: 'Sparkline',
    group: 'Data',
    signature: 'Sparkline(values, color?)',
    description: 'Axis-free trend line.',
  },
  {
    name: 'Diagram',
    group: 'Data',
    signature: 'Diagram(layers, $selected?, options?)',
    description: 'Clickable flow; options: direction "down"|"right", edges [{from, to, label}].',
    bindings: [1],
  },

  // Inputs
  {
    name: 'Button',
    group: 'Inputs',
    signature: 'Button(label, action?, variant? "solid"|"outline"|"soft"|"ghost", disabled?, full-width?)',
    description: 'Runs an action.',
  },
  {
    name: 'Input',
    group: 'Inputs',
    signature: 'Input($value, label?, type?, placeholder?)',
    description: 'Single-line text or number field.',
    bindings: [0],
  },
  {
    name: 'Slider',
    group: 'Inputs',
    signature: 'Slider($value, min, max, step?, label?, unit?)',
    description: 'Range slider with a live readout.',
    bindings: [0],
  },
  {
    name: 'Select',
    group: 'Inputs',
    signature: 'Select($value, options, label?)',
    description: 'Dropdown.',
    bindings: [0],
  },
  {
    name: 'Checkbox',
    group: 'Inputs',
    signature: 'Checkbox($value, label?)',
    description: 'Boolean checkbox.',
    bindings: [0],
  },
  {
    name: 'SegmentedControl',
    group: 'Inputs',
    signature: 'SegmentedControl($value, options, block?)',
    description: 'Inline segmented choice.',
    bindings: [0],
  },
  {
    name: 'ChoiceCards',
    group: 'Inputs',
    signature: 'ChoiceCards($value, options, multiple?)',
    description: 'Selectable option cards; options are {id, title, description, icon}.',
    bindings: [0],
  },
  {
    name: 'RadioGroup',
    group: 'Inputs',
    signature: 'RadioGroup($value, options, label?)',
    description: 'Single-choice radio list.',
    bindings: [0],
  },
  {
    name: 'Switch',
    group: 'Inputs',
    signature: 'Switch($value, label?)',
    description: 'Boolean switch.',
    bindings: [0],
  },
  {
    name: 'TextArea',
    group: 'Inputs',
    signature: 'TextArea($value, label?, placeholder?, rows?)',
    description: 'Multi-line text field.',
    bindings: [0],
  },
  {
    name: 'NumberStepper',
    group: 'Inputs',
    signature: 'NumberStepper($value, min?, max?, step?, label?)',
    description: 'Exact number with plus/minus buttons.',
    bindings: [0],
  },
  {
    name: 'DatePicker',
    group: 'Inputs',
    signature: 'DatePicker($value, label?, mode? "date"|"time"|"datetime-local")',
    description: 'Native date, time or date-time field.',
    bindings: [0],
  },
  {
    name: 'IconButton',
    group: 'Inputs',
    signature: 'IconButton(icon, action, label)',
    description: 'Icon-only button; label is its accessible name.',
  },
  {
    name: 'Pressable',
    group: 'Inputs',
    signature: 'Pressable(children, action)',
    description: 'Makes a whole block clickable.',
  },
  {
    name: 'Form',
    group: 'Inputs',
    signature: 'Form(children, submitLabel, prompt)',
    description: 'Collects every bound field and submits one assistant turn.',
  },

  // Structure
  {
    name: 'Tabs',
    group: 'Structure',
    signature: 'Tabs($active, tabs)',
    description: 'Tabbed panels; tabs are {label, content}.',
    bindings: [0],
  },
  {
    name: 'Accordion',
    group: 'Structure',
    signature: 'Accordion(items, $open?, multiple?)',
    description: 'Collapsible sections; items are {title, content}.',
    bindings: [1],
  },
  {
    name: 'Steps',
    group: 'Structure',
    signature: 'Steps(items, $current?)',
    description: 'Numbered steps; items are strings or {title, description}.',
    bindings: [1],
  },
  {
    name: 'Timeline',
    group: 'Structure',
    signature: 'Timeline(items)',
    description: 'Timeline; items are {time, title, description, tone}.',
  },
  {
    name: 'Callout',
    group: 'Structure',
    signature: 'Callout(children, tone?, title?)',
    description: 'Info, success, warning or danger callout.',
  },
  {
    name: 'Stat',
    group: 'Structure',
    signature: 'Stat(label, value, delta?, caption?)',
    description: 'Large metric with an optional signed delta.',
  },
  {
    name: 'Reveal',
    group: 'Structure',
    signature: 'Reveal(label, children)',
    description: 'Click-to-reveal spoiler.',
  },

  // Learning
  {
    name: 'Flashcard',
    group: 'Learning',
    signature: 'Flashcard(front, back)',
    description: 'Flip card for memorisation.',
  },
  {
    name: 'Quiz',
    group: 'Learning',
    signature: 'Quiz(question, options, answer, explanation?)',
    description: 'Local multiple-choice check; answer is an index, id or label.',
  },
  {
    name: 'Checklist',
    group: 'Learning',
    signature: 'Checklist(items, $done)',
    description: 'Checklist with progress; $done is an array of indexes.',
    bindings: [1],
  },

  // Obsidian
  {
    name: 'NoteLink',
    group: 'Obsidian',
    signature: 'NoteLink(linktext, label?)',
    description: 'Opens a vault note; missing notes stay muted.',
  },
  {
    name: 'NoteCard',
    group: 'Obsidian',
    signature: 'NoteCard(linktext)',
    description: 'Read-only note summary with tags and excerpt.',
  },
  {
    name: 'Mermaid',
    group: 'Obsidian',
    signature: 'Mermaid(code)',
    description: 'Mermaid diagram rendered by Obsidian.',
  },
  {
    name: 'Image',
    group: 'Obsidian',
    signature: 'Image(path, alt?)',
    description: 'Embeds a vault-relative image; remote URLs are rejected.',
  },
  {
    name: 'Tag',
    group: 'Obsidian',
    signature: 'Tag(name)',
    description: 'Opens Obsidian search for a tag.',
  },
];

export const UI_COMPONENT_NAMES: ReadonlySet<string> = new Set(
  UI_CATALOG.map((entry) => entry.name),
);
