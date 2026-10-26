/**
 * Response-format instructions that teach a model the generative UI channel.
 *
 * ChatGPT's "intelligent UI" behaviour is trained into the model. Providers
 * wired into this plugin are not trained on our component library, so the
 * judgement ("when a UI helps, when plain text is better") has to be described
 * in the prompt instead.
 *
 * This lives in `core/` because both provider runtimes and the feature layer
 * consume it: providers may not import from `features/`. The component list is
 * derived from `uiCatalog.ts` so the prompt cannot drift from the renderer.
 */

import { UI_CATALOG,type UiComponentGroup } from './uiCatalog';

const GROUP_ORDER: UiComponentGroup[] = [
  'Layout',
  'Text',
  'Data',
  'Inputs',
  'Structure',
  'Learning',
  'Obsidian',
];

function componentCatalog(): string {
  return GROUP_ORDER.map((group) => {
    const signatures = UI_CATALOG
      .filter((entry) => entry.group === group)
      .map((entry) => entry.signature);
    return `${group}: ${signatures.join(', ')}.`;
  }).join('\n');
}

export const GENERATIVE_UI_INSTRUCTION = `## Response form

Decide the form of each answer yourself, per question:

- Answer in **plain text** when a short factual, conversational or yes/no answer is best. Do not wrap everything in a UI.
- Answer with an **interactive UI** when the answer benefits from structure or interaction: explaining how something works, comparing options, planning with adjustable parameters, doing arithmetic the user may want to tweak, or showing data.
- When you use a UI, output exactly one fenced block tagged \`claudian-ui\` as the whole answer. You may put one short sentence of text before it. Nothing after it. The opening fence MUST be exactly \`\`\`claudian-ui — a bare \`\`\` without the tag is an ordinary code block and the whole UI is lost.

## Program syntax inside the fence

- One statement per line: \`name = expression\`.
- \`root\` must be the first statement and must be a layout component.
- Arguments are positional (order matters). Do not use \`name: value\`.
- Strings use double quotes. Numbers, true/false, null, arrays \`[...]\`, objects \`{key: value}\` are supported.
- \`@function(...)\` calls compute values: @Count @First @Last @Sum @Avg @Min @Max @Round @Abs @Floor @Ceil @Clamp @Default @Percent @Format @Plural @Join @Split @Contains @Upper @Lower @Filter @Sort @Range @Each.
- Declare interactive state as \`$name = default\`. A component whose signature shows \`$binding\` reads and writes it.
- Actions: \`@Set($name, value)\`, \`@Reset($name)\`, \`@Toggle($name)\`, \`@ToAssistant("message", context)\`, \`@OpenUrl(url)\`, \`@Copy(text)\`, \`@OpenNote(linktext)\`.
- \`Action([@Set($x, 1), @ToAssistant("done")])\` runs several actions from one click.
- \`Form\` submits every \`$variable\` declared inside it as one assistant turn. Do not add a submit Button yourself.
- \`Tabs\`, \`Accordion\`, \`Reveal\`, \`Flashcard\`, \`Quiz\` and \`Checklist\` keep local state when no \`$variable\` is bound.
- Derive numbers with expressions instead of hardcoding them.
- Use only the components below. Unknown components are dropped.
- Write labels in the same language the user is using.

## Components (positional arguments)

${componentCatalog()}

## Examples

\`\`\`claudian-ui
root = Col([head, tabs], 3)
$tab = 0
head = Row([Icon("brain"), Title("注意力机制", "lg")], 2, "center")
tabs = Tabs($tab, [{label: "原理", content: why}, {label: "复杂度", content: cost}])
why = Steps(["投影成 Q/K/V", "Q 与 K 点积", "softmax 归一化", "加权求和 V"])
cost = Row([Stat("时间", "O(n²·d)"), Stat("显存", "O(n²)")], 2)
\`\`\`

\`\`\`claudian-ui
root = Form([dest, days, note], "生成行程", "按这些条件规划旅行")
$dest = "tokyo"
$days = 3
$note = ""
dest = ChoiceCards($dest, [{id: "tokyo", title: "东京"}, {id: "kyoto", title: "京都"}])
days = Slider($days, 1, 14, 1, "天数")
note = TextArea($note, "补充要求")
\`\`\`

\`\`\`claudian-ui
root = Col([head, chart, table], 3)
$sort = ""
head = Title("月度营收", "md")
chart = Chart("bar", [{month: "1月", revenue: 12, cost: 8}, {month: "2月", revenue: 18, cost: 9}], "month", ["revenue", "cost"], 180)
table = Table([{key: "month", label: "月份"}, {key: "revenue", label: "营收", align: "end", format: "compact"}], [{month: "1月", revenue: 12}, {month: "2月", revenue: 18}], $sort)
\`\`\`

## Rules

- Keep it readable at narrow width (a side panel): prefer Col and short rows over wide multi-column layouts. Use \`Chart(..., {horizontal: true})\` when a bar chart would be too wide.
- Every \`$variable\` must be read by something, and every named statement must be reachable from root.
- Links must be http(s). Images must be vault-relative paths; never invent remote image URLs.
- If you are unsure the program is valid, answer in plain text instead.`;

/** Extra action line shown only when writing into a note is enabled in settings. */
const INSERT_TO_NOTE_ACTION = '- `@InsertToNote(markdown)` asks the user to confirm inserting markdown at the cursor of the active note. Use it only when the user asked you to write into their note.';

const INSTRUCTION_WITH_INSERT = GENERATIVE_UI_INSTRUCTION.replace(
  '- `Action([@Set($x, 1), @ToAssistant("done")])` runs several actions from one click.',
  (anchor) => `${anchor}\n${INSERT_TO_NOTE_ACTION}`,
);

/** Returns the instruction, or null when the feature is switched off. */
export function resolveGenerativeUiInstruction(
  enabled: boolean,
  insertIntoNoteEnabled = false,
): string | null {
  if (!enabled) return null;
  return insertIntoNoteEnabled ? INSTRUCTION_WITH_INSERT : GENERATIVE_UI_INSTRUCTION;
}
