/**
 * Response-format instructions that teach a model the generative UI channel.
 *
 * ChatGPT's "intelligent UI" behaviour is trained into the model. Providers
 * wired into this plugin are not trained on our component library, so the
 * judgement ("when a UI helps, when plain text is better") has to be described
 * in the prompt instead.
 *
 * This lives in `core/` because both provider runtimes and the feature layer
 * consume it: providers may not import from `features/`.
 */

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
- \`@Set($name, value)\`, \`@Reset($name)\`, \`@ToAssistant("message", context)\`, \`@OpenUrl(url)\`, \`@Copy(text)\` are actions used in Button.
- Derive numbers with expressions instead of hardcoding them.
- Use only the components below. Unknown components are dropped.
- Write labels in the same language the user is using.

## Components (positional arguments)

Layout: Col(children, gap?), Row(children, gap?, align?, justify?, wrap?), Box(children, direction?, gap?, padding?, background?, border?), Grid(children, columns?, gap?), Card(children, variant? "outline"|"soft"), Divider(), Spacer().
Text: Title(text, size? "sm"|"md"|"lg"|"xl"), Text(text, size?, color?, weight?, italic?), Caption(text, color?), Badge(text, color?), List(children, marker?), ListItem(title, description?, children?), Code(code, language?), Quote(text, cite?).
Data: Table(columns, rows), Chart(type "bar"|"line"|"area"|"pie"|"donut", data, x?, series?, height?), Diagram(layers, $selected?).
Inputs: Button(label, action?, variant? "solid"|"outline"|"soft"|"ghost", disabled?, full-width?), Input($value, label?, type?, placeholder?), Slider($value, min, max, step?, label?, unit?), Select($value, options, label?), Checkbox($value, label?), SegmentedControl($value, options, block?).

## Diagram (interactive explanation)

\`Diagram(layers, $selected)\` renders a vertical flow. Each layer is either a plain string (one step) or \`{title: "...", nodes: [{id: "a", label: "..."}]}\`. Clicking a node writes its \`id\` into \`$selected\`, so other statements can react:

\`\`\`
root = Col([title, flow, detail], 3)
$selected = "attn"
title = Title("Transformer 数据流", "lg")
flow = Diagram([{title: "输入", nodes: [{id: "tok", label: "Token"}]}, {title: "编码器", nodes: [{id: "attn", label: "多头注意力"}, {id: "ffn", label: "前馈网络"}]}, {title: "输出", nodes: [{id: "out", label: "预测"}]}], $selected)
detail = Card([Title($selected, "sm"), Text("点击上面任意模块查看它在做什么。")], "soft")
\`\`\`

## Rules

- Keep it readable at narrow width (a side panel): prefer Col and short rows over wide multi-column layouts.
- Every \`$variable\` must be read by something, and every named statement must be reachable from root.
- If you are unsure the program is valid, answer in plain text instead.`;

/** Returns the instruction, or null when the feature is switched off. */
export function resolveGenerativeUiInstruction(enabled: boolean): string | null {
  return enabled ? GENERATIVE_UI_INSTRUCTION : null;
}
