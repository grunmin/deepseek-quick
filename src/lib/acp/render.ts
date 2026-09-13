import type {
  AvailableCommandWire,
  SessionConfigOptionWire,
  SessionModeStateWire,
  SessionUpdateWire,
  ToolCallContentWire,
  ToolCallWire,
} from "./types";

/**
 * 把 ACP 的 `session/update` 流变成可渲染的对话模型。
 *
 * 刻意写成**不依赖 React / @raycast/api 的纯逻辑**：一是渲染规则最容易出错（工具卡片、
 * 流式分块、历史重放），二是这样它才能被 `scripts/verify-acp.mjs` 直接喂真实报文验证。
 *
 * 模型是**可变对象**：流式时每 80ms 就要重算一次 markdown，每来一个 chunk 都做一次
 * 深拷贝不划算。视图那边用「节流 + 重建 markdown 字符串」来触发渲染（见 agent-view.tsx）。
 */

export interface ToolStep {
  kind: "tool";
  id: string;
  name: string;
  title: string;
  toolKind?: string;
  /** pending | in_progress | completed | failed（认不出的值原样保留） */
  status: string;
  diff?: { path: string; oldText?: string | null; newText: string };
  /** 命令输出 / 工具返回文本；完整保留，截断只发生在渲染那一步 */
  output?: string;
  locations: string[];
}

export interface TextStep {
  kind: "message" | "thought";
  text: string;
}

export interface NoteStep {
  kind: "note";
  text: string;
}

export type Step = ToolStep | TextStep | NoteStep;

export interface UsageSummary {
  used?: number;
  size?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheHitRate?: number;
  tps?: number;
  turnCount?: number;
}

export interface Turn {
  user: string;
  steps: Step[];
  /**
   * true = 这一轮是用户在本面板里发起的（本地先画出来），false = 从会话历史重放出来的。
   * 用来决定「agent 回显的 user_message_chunk」该不该新开一轮（见 apply 里的注释）。
   */
  local: boolean;
  finished: boolean;
  stopReason?: string;
  error?: string;
  usage?: UsageSummary;
}

export class TranscriptModel {
  readonly turns: Turn[] = [];
  /** 工具卡片要按 id 回查 —— 审批请求只带 toolCallId，不带工具详情 */
  readonly toolCalls = new Map<string, ToolStep>();

  /** 会话级状态：agent 通过 update 推过来，视图直接读 */
  configOptions: SessionConfigOptionWire[] = [];
  modes?: SessionModeStateWire;
  commands: AvailableCommandWire[] = [];
  title = "";

  /**
   * 正在重放历史（`session/load` 会把旧对话用 session/update 重放一遍）。
   * 重放期间的 user_message_chunk 是新的一轮，而**实时**对话里它只是 agent 对我刚发
   * 那条消息的回显 —— 两者必须分开处理，否则历史会被画成重复的一轮。
   */
  private replaying = false;

  private get last(): Turn | undefined {
    return this.turns[this.turns.length - 1];
  }

  startReplay(): void {
    this.replaying = true;
  }

  endReplay(): void {
    this.replaying = false;
    // 重放出来的轮次都是已经结束的（历史里没有「正在跑」这回事），
    // 不标记的话最后那一轮会永远挂着「⏳ 运行中…」
    for (const turn of this.turns) turn.finished = true;
  }

  /** 用户按下 ↵ 时本地先开一轮：搜索栏马上被清空，总得让人看见自己刚发了什么 */
  startLocalTurn(user: string): Turn {
    const turn: Turn = { user, steps: [], local: true, finished: false };
    this.turns.push(turn);
    return turn;
  }

  finishTurn(stopReason?: string, error?: string): void {
    const turn = this.last;
    if (!turn) return;
    turn.finished = true;
    turn.stopReason = stopReason;
    turn.error = error;
  }

  /** 插一条提示（审批、被拒绝、取消…），让它留在时间线上，别只在 toast 里一闪而过 */
  note(text: string): void {
    if (!this.last) this.startLocalTurn("");
    this.last?.steps.push({ kind: "note", text });
  }

  apply(update: SessionUpdateWire): void {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = contentText(update);
        if (!text) return;
        // 实时对话里这条只是回显：本轮是本地起的、还没结束 → 忽略
        if (!this.replaying && this.last?.local && !this.last.finished) return;
        const turn: Turn = { user: text, steps: [], local: false, finished: false };
        this.turns.push(turn);
        return;
      }
      case "agent_message_chunk":
        this.appendText("message", contentText(update));
        return;
      case "agent_thought_chunk":
        this.appendText("thought", contentText(update));
        return;
      case "tool_call":
      case "tool_call_update":
        this.upsertTool(update);
        return;
      case "usage_update":
        this.applyUsage(update);
        return;
      case "session_info_update": {
        const title = update.title;
        if (typeof title === "string" && title) this.title = title;
        return;
      }
      case "available_commands_update": {
        const commands = update.availableCommands;
        if (Array.isArray(commands)) this.commands = commands as AvailableCommandWire[];
        return;
      }
      case "config_option_update": {
        const options = update.configOptions;
        if (Array.isArray(options)) this.configOptions = options as SessionConfigOptionWire[];
        return;
      }
      case "current_mode_update": {
        const modeId = update.currentModeId;
        if (typeof modeId === "string" && this.modes) this.modes = { ...this.modes, currentModeId: modeId };
        return;
      }
      default:
        // agent 会持续加新的 sessionUpdate 类型。忽略未知类型是**规范要求**的行为，
        // 不是漏了实现 —— 别在这里 throw。
        return;
    }
  }

  private appendText(kind: "message" | "thought", text: string): void {
    if (!text) return;
    if (!this.last) this.startLocalTurn("");
    const steps = this.last!.steps;
    const tail = steps[steps.length - 1];
    // 同类型的连续 chunk 合并成一段（中间夹了工具调用/另一种类型就另起一段）
    if (tail && tail.kind === kind) {
      tail.text += text;
      return;
    }
    steps.push({ kind, text });
  }

  private upsertTool(update: SessionUpdateWire): void {
    const wire = update as unknown as ToolCallWire & { sessionUpdate: string };
    const id = wire.toolCallId;
    if (!id) return;

    const existing = this.toolCalls.get(id);
    if (existing) {
      mergeTool(existing, wire);
      return;
    }

    if (!this.last) this.startLocalTurn("");
    const step = makeToolStep(wire);
    this.toolCalls.set(id, step);
    this.last!.steps.push(step);
  }

  private applyUsage(update: SessionUpdateWire): void {
    const wire = update as unknown as { used?: number; size?: number; _meta?: UsageSummary };
    const meta = wire._meta ?? {};
    const target = this.last;
    if (!target) return;
    target.usage = {
      used: wire.used,
      size: wire.size,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      reasoningTokens: meta.reasoningTokens,
      cacheHitRate: meta.cacheHitRate,
      tps: meta.tps,
      turnCount: meta.turnCount,
    };
  }
}

/* ────────────────────────── 线上对象 → 模型 ────────────────────────── */

function contentText(update: SessionUpdateWire): string {
  const content = update.content as { text?: string } | undefined;
  return typeof content?.text === "string" ? content.text : "";
}

function makeToolStep(wire: ToolCallWire): ToolStep {
  const step: ToolStep = {
    kind: "tool",
    id: wire.toolCallId,
    name: typeof wire.name === "string" ? wire.name : "tool",
    title: typeof wire.title === "string" ? wire.title : "",
    toolKind: typeof wire.kind === "string" ? wire.kind : undefined,
    status: typeof wire.status === "string" ? wire.status : "pending",
    locations: [],
  };
  mergeTool(step, wire);
  return step;
}

/**
 * 把 update 合进已有卡片。
 *
 * ACP 规定 `tool_call_update` **只带变化过的字段**，所以「字段缺席 = 保持原值」；
 * 但线上确实会出现显式的 `null`（尤其 title/status），对这种一律当「没变化」处理 ——
 * 把人类可读的标题清成空字符串对用户毫无价值。
 */
function mergeTool(step: ToolStep, wire: ToolCallWire): void {
  if (typeof wire.name === "string" && wire.name) step.name = wire.name;
  if (typeof wire.title === "string" && wire.title) step.title = wire.title;
  if (typeof wire.kind === "string" && wire.kind) step.toolKind = wire.kind;
  if (typeof wire.status === "string" && wire.status) step.status = wire.status;

  if (Array.isArray(wire.locations)) {
    const paths = wire.locations.map((l) => l?.path).filter((p): p is string => Boolean(p));
    if (paths.length) step.locations = paths;
  }

  const contents = Array.isArray(wire.content) ? wire.content : undefined;
  if (contents) {
    const diff = contents.find((c) => c?.type === "diff") as ToolCallContentWire | undefined;
    if (diff?.path && typeof diff.newText === "string") {
      step.diff = { path: diff.path, oldText: diff.oldText ?? null, newText: diff.newText };
    }
  }

  const output = extractOutput(wire, contents);
  if (output !== undefined) step.output = output;
}

/**
 * 从 `rawOutput` / `content` / `_meta` 里挖出「给用户看的输出」。
 *
 * 同一个东西在不同的 agent 上挂在不同位置（dsh 放 `rawOutput.formatted_output`，
 * codex 走 `_meta.terminal_output_delta.data` 增量），所以按优先级依次尝试，
 * 认不出就不显示 —— 显示原始 JSON 还不如不显示。
 */
function extractOutput(wire: ToolCallWire, contents?: ToolCallContentWire[]): string | undefined {
  const raw = wire.rawOutput;
  if (typeof raw === "string") return raw;

  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["formatted_output", "output", "stdout", "content", "text"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    const stderr = record.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr;
  }

  const meta = wire._meta as Record<string, unknown> | null | undefined;
  const delta = (meta?.terminal_output_delta as { data?: unknown } | undefined)?.data;
  if (typeof delta === "string") return delta;

  const textContent = contents?.find((c) => c?.type === "content" && typeof c.text === "string");
  return textContent?.text;
}

/* ────────────────────────── 模型 → Markdown ────────────────────────── */

export interface RenderOptions {
  /** 扩展级偏好 `showReasoning`：思考链默认不显示，免得把结论顶出视口 */
  showReasoning: boolean;
  /** 发送瞬间那次「只有最新一轮」的短渲染，用来把详情面板的滚动位置钳回顶部 */
  latestOnly?: boolean;
}

/** 工具输出的渲染上限：详情面板的宽度和滚动都很有限，长输出交给「复制」动作 */
const MAX_OUTPUT_LINES = 24;
const MAX_STEP_CHARS = 4000;

/**
 * 详情面板的 markdown。**最新一轮置顶**（与引用历史相反），原因见 AGENTS.md 约束 18：
 * `List.Item.Detail` 没有滚动 API，滚动位置是绝对值且不跟随内容增长 ——
 * 只有把最新一轮放在内容开头，发出去之后才看得见回答在长。
 */
export function transcriptMarkdown(model: TranscriptModel, options: RenderOptions): string {
  if (model.turns.length === 0) {
    return [
      "### 🛠 Agent",
      "",
      "在搜索栏输入任务，按 `↵` 交给 agent 执行。",
      "",
      "_它不是聊天机器人：会真的读文件、跑命令、改代码。_",
    ].join("\n");
  }

  const turns = model.turns;
  const latest = turns[turns.length - 1];
  const earlier = turns.slice(0, -1).reverse();

  const blocks: string[] = [turnMarkdown(latest, options)];
  if (!options.latestOnly && earlier.length > 0) {
    const body = earlier.map((turn) => turnMarkdown(turn, options)).join("\n\n---\n\n");
    blocks.push(`### 📜 更早的对话（${earlier.length} 轮，越往下越早）\n\n${body}`);
  }
  return blocks.join("\n\n---\n\n");
}

function turnMarkdown(turn: Turn, options: RenderOptions): string {
  const parts: string[] = [];
  if (turn.user) parts.push(`**你**\n\n${quote(turn.user)}`);

  for (const step of turn.steps) {
    if (step.kind === "message") parts.push(step.text);
    else if (step.kind === "thought" && options.showReasoning) parts.push(thoughtMarkdown(step.text));
    else if (step.kind === "tool") parts.push(toolMarkdown(step));
    else if (step.kind === "note") parts.push(`> ⚠️ ${step.text}`);
  }

  if (!turn.finished) parts.push("_⏳ 运行中…_");
  if (turn.error) parts.push(`### ⚠️ 这一轮出错了\n\n${fence(turn.error, "")}`);
  if (turn.usage) parts.push(usageLine(turn.usage));

  return parts.filter(Boolean).join("\n\n");
}

const TOOL_ICON: Record<string, string> = {
  pending: "⏳",
  in_progress: "🔄",
  completed: "✅",
  failed: "❌",
};

/** `✅ bash · date`：一行说清「谁、在干什么」，输出另起代码块 */
function toolMarkdown(step: ToolStep): string {
  const icon = TOOL_ICON[step.status] ?? "•";
  const label = step.title || step.name;
  const parts = [`\`${icon} ${step.name}\` **${escapeInline(label)}**`];

  if (step.diff) {
    parts.push(`📝 \`${step.diff.path}\``);
    parts.push(diffBlock(step.diff));
  } else if (step.output && step.output.trim()) {
    const clipped = clip(step.output);
    parts.push(fence(clipped.text, outputLang(step)));
    if (clipped.omitted > 0) {
      parts.push(`_…还有 ${clipped.omitted} 行（⌘K →「复制完整对话」可取全文）_`);
    }
  } else if (step.locations.length > 0) {
    parts.push(step.locations.map((p) => `\`${p}\``).join("  \n"));
  }

  return parts.join("\n\n");
}

function outputLang(step: ToolStep): string {
  if (step.toolKind === "execute" || step.name === "bash" || step.name === "shell") return "bash";
  return "";
}

function thoughtMarkdown(text: string): string {
  return `> 💭 ${clip(text, 60).text.replace(/\n/g, "\n> ")}`;
}

function usageLine(usage: UsageSummary): string {
  const bits: string[] = [];
  if (usage.inputTokens || usage.outputTokens) {
    bits.push(`↑${formatTokens(usage.inputTokens ?? 0)} ↓${formatTokens(usage.outputTokens ?? 0)}`);
  } else if (usage.used) {
    bits.push(`上下文 ${formatTokens(usage.used)}${usage.size ? ` / ${formatTokens(usage.size)}` : ""}`);
  }
  // 只在非零时显示这两项：缓存命中天然为 0（前缀不够长），显示出来反而像坏了
  if (usage.reasoningTokens) bits.push(`思考 ${formatTokens(usage.reasoningTokens)}`);
  if (usage.cacheHitRate) bits.push(`缓存 ${Math.round(usage.cacheHitRate * 100)}%`);
  if (usage.tps) bits.push(`${Math.round(usage.tps)} tps`);
  if (bits.length === 0) return "";
  return `_${bits.join(" · ")}_`;
}

/* ────────────────────────── 文本工具 ────────────────────────── */

function quote(text: string): string {
  return text.replace(/\n/g, "\n> ").replace(/^(?!>)/, "> ");
}

function escapeInline(text: string): string {
  return text.replace(/\n/g, " ").replace(/([*_`])/g, "\\$1");
}

/**
 * 用足够长的围栏包住内容。
 *
 * 工具输出里很可能自带 ``` （比如它就是一段 markdown），用固定的三个反引号会直接
 * 把围栏撑破、后面整段渲染都乱掉。所以按内容里最长的反引号串动态加长。
 */
function fence(body: string, lang: string): string {
  const longest = (body.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const bar = "`".repeat(Math.max(3, longest + 1));
  return `${bar}${lang}\n${body}\n${bar}`;
}

interface Clipped {
  text: string;
  omitted: number;
}

/** 截断到 MAX_OUTPUT_LINES 行 / MAX_STEP_CHARS 字符，并告诉调用方砍掉了多少 */
function clip(text: string, maxLines = MAX_OUTPUT_LINES): Clipped {
  const lines = text.replace(/\s+$/, "").split("\n");
  let omitted = 0;
  let kept = lines;

  if (lines.length > maxLines) {
    omitted = lines.length - maxLines;
    kept = lines.slice(0, maxLines);
  }

  let body = kept.join("\n");
  if (body.length > MAX_STEP_CHARS) {
    const droppedChars = body.length - MAX_STEP_CHARS;
    body = body.slice(0, MAX_STEP_CHARS);
    // 字符截断时行数已经不准了，用一个保守的提示代替精确值
    if (omitted === 0) omitted = Math.max(1, Math.ceil(droppedChars / 80));
  }
  return { text: body, omitted };
}

/**
 * 一个「够用就好」的 diff。
 *
 * 刻意不做 LCS：完整行级 diff 对几百行的文件就是几十万次比较，而这个面板要的是
 * 「改了什么」的直观印象。剪掉公共前缀/后缀后，中间那段的删除/新增就是编辑的实质，
 * 再加几行上下文，读起来和 git diff 没有区别。
 */
function diffBlock(diff: { path: string; oldText?: string | null; newText: string }): string {
  const after = diff.newText.replace(/\n$/, "").split("\n");

  if (diff.oldText === null || diff.oldText === undefined) {
    return fence(after.map((line) => `+${line}`).join("\n"), "diff");
  }

  const before = diff.oldText.replace(/\n$/, "").split("\n");
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const CONTEXT = 2;
  const lines: string[] = [];
  for (let i = Math.max(0, head - CONTEXT); i < head; i++) lines.push(` ${before[i]}`);
  for (let i = head; i < before.length - tail; i++) lines.push(`-${before[i]}`);
  for (let i = head; i < after.length - tail; i++) lines.push(`+${after[i]}`);
  for (let i = after.length - tail; i < Math.min(after.length, after.length - tail + CONTEXT); i++) {
    lines.push(` ${after[i]}`);
  }
  return fence(lines.join("\n"), "diff");
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
