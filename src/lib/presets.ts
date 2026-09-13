import { LocalStorage } from "@raycast/api";
import { prefs, type Effort } from "./config";
import { dbg } from "./debug";
import { resolveSystemPrompt } from "./prompt-config";
import { CHAT_PRESET_RESEARCH, CHAT_PRESET_SENIOR, CHAT_SYSTEM } from "./prompts";

/**
 * Chat 的「Preset」：一套可复用的 **system prompt + 模型 + 思考强度**。
 *
 * 为什么不放 Raycast 偏好：偏好只能声明固定几个标量字段，表达不了"可增删的列表"。
 * 所以预设存 LocalStorage，用 `Chat Presets` 命令管理，在 Chat 里用 ⌘K → 切换 Preset 选。
 *
 * 层级关系（从具体到一般）：
 *
 * ```
 * 预设的 prompt / model / effort   ← 本文
 *   ↓ 留空或 inherit 时回落
 * Chat 命令的 modelOverride / effortOverride   ← package.json: commands[].preferences
 *   ↓ 未设置时回落
 * 扩展全局 Model / Chat Reasoning              ← 扩展级 preferences
 * ```
 */

/** 内置「默认」预设的 id。它不落盘，prompt 来自 Configure Prompts 的 chat 覆盖 */
export const DEFAULT_PRESET_ID = "__default__";

export const DEFAULT_PRESET_NAME = "默认";

/** `"inherit"` = 跟随 Chat 命令 / 扩展全局的思考强度 */
export type PresetEffort = Effort | "inherit";

/**
 * 代码里内置的预设：**开箱即用、只读**，「复制为新的」之后就可以随便改。
 *
 * 为什么不预置进 LocalStorage：那样得搞一个"只在第一次播种"的状态，
 * 而且用户删掉之后还会纠结要不要再播一次。写成内置最省事、也永远能恢复。
 */
export interface BuiltinPreset {
  id: string;
  name: string;
  /** 一句话说明用途，管理界面里的副标题 */
  subtitle: string;
  /** 固定 prompt。`undefined` = 用 Configure Prompts 里 Chat 的 prompt（只有「默认」如此） */
  systemPrompt?: string;
  model?: string;
  effort: PresetEffort;
}

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    id: DEFAULT_PRESET_ID,
    name: DEFAULT_PRESET_NAME,
    subtitle: "轻量快捷的日常问答，跟随命令 / 全局的模型与思考强度",
    // 不给 prompt：走 Configure Prompts 里 Chat 的那份
    effort: "inherit",
  },
  {
    id: "__senior__",
    name: "资深模式",
    subtitle: "资深专家口吻：结论先行、讲取舍、点风险、给可执行建议",
    systemPrompt: CHAT_PRESET_SENIOR,
    model: "deepseek-flash",
    effort: "high",
  },
  {
    id: "__research__",
    name: "深度研究",
    subtitle: "严谨拆解：显式假设、多方案对比、区分事实与推测、标注边界",
    systemPrompt: CHAT_PRESET_RESEARCH,
    model: "deepseek-flash",
    effort: "high",
  },
];

export function findBuiltin(id: string): BuiltinPreset | undefined {
  return BUILTIN_PRESETS.find((b) => b.id === id);
}

export interface SwitchablePreset {
  id: string;
  name: string;
}

/**
 * 切换列表的数据源：**内置 + 自定义**，两者必须都给。
 *
 * 抽成函数是为了能被测试覆盖 —— 之前 `chat-view` 的 Submenu 只遍历了自定义预设
 * （`listPresets()`），导致内置预设"管理页看得见、聊天页看不见"。
 * 只要这个函数返回了内置，UI 就不可能再漏。
 */
export async function listSwitchablePresets(): Promise<{
  builtins: SwitchablePreset[];
  custom: SwitchablePreset[];
}> {
  return {
    builtins: BUILTIN_PRESETS.map((b) => ({ id: b.id, name: b.name })),
    custom: (await listPresets()).map((p) => ({ id: p.id, name: p.name })),
  };
}

export interface ChatPreset {
  id: string;
  name: string;
  systemPrompt: string;
  /** 留空 = 跟随 Chat 命令 / 扩展全局的 Model */
  model?: string;
  effort: PresetEffort;
  createdAt: number;
  updatedAt: number;
}

/** 已经回落好的、可直接拿去发请求的预设 */
export interface ResolvedChatPreset {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  effort: Effort;
  /** true = 内置「默认」预设（prompt 来自 Configure Prompts，不可改名/删除） */
  isBuiltin: boolean;
}

const PRESETS_KEY = "deepseek-quick.chat-presets";
/** 解析失败时把原始内容挪到这里，尽量不无痕丢弃 */
const PRESETS_BACKUP_KEY = "deepseek-quick.chat-presets.corrupted";
const ACTIVE_KEY = "deepseek-quick.chat-active-preset";

function isPreset(value: unknown): value is ChatPreset {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ChatPreset>;
  return typeof p.id === "string" && typeof p.name === "string" && typeof p.systemPrompt === "string";
}

function asPresetEffort(value: unknown): PresetEffort {
  return value === "none" || value === "low" || value === "high" || value === "max" ? value : "inherit";
}

/**
 * 读预设列表。
 *
 * 预设是**配置**（小、可重建），不像历史那样有不可替代的用户内容，所以解析失败时
 * 不做"拒绝写入"的保护 —— 但也不会无痕丢弃：原始内容会被挪到备份 key。
 */
async function readAll(): Promise<ChatPreset[]> {
  let raw: string | undefined;
  try {
    raw = await LocalStorage.getItem<string>(PRESETS_KEY);
  } catch (err) {
    dbg(`presets: 读取失败 ${String(err).slice(0, 200)}`);
    return [];
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("不是数组");
    const presets = parsed.filter(isPreset).map(normalize);
    if (presets.length !== parsed.length) {
      dbg(`presets: ${parsed.length - presets.length} 条结构不合法，已忽略`);
    }
    return presets;
  } catch (err) {
    dbg(`presets: 解析失败，原始内容转入备份 ${String(err).slice(0, 200)}`);
    try {
      await LocalStorage.setItem(PRESETS_BACKUP_KEY, raw);
      await LocalStorage.removeItem(PRESETS_KEY);
    } catch {
      // 尽力而为
    }
    return [];
  }
}

function normalize(preset: ChatPreset): ChatPreset {
  const now = Date.now();
  return {
    id: preset.id,
    name: preset.name,
    systemPrompt: preset.systemPrompt,
    model: typeof preset.model === "string" ? preset.model : undefined,
    effort: asPresetEffort(preset.effort),
    createdAt: typeof preset.createdAt === "number" ? preset.createdAt : now,
    updatedAt: typeof preset.updatedAt === "number" ? preset.updatedAt : now,
  };
}

async function writeAll(presets: ChatPreset[]): Promise<void> {
  await LocalStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

export async function listPresets(): Promise<ChatPreset[]> {
  const all = await readAll();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getPreset(id: string): Promise<ChatPreset | undefined> {
  return (await readAll()).find((p) => p.id === id);
}

export async function upsertPreset(input: {
  id?: string;
  name: string;
  systemPrompt: string;
  model?: string;
  effort: PresetEffort;
}): Promise<string> {
  const all = await readAll();
  const now = Date.now();
  const id = input.id ?? `p_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const model = input.model?.trim() || undefined;

  const index = all.findIndex((p) => p.id === id);
  if (index >= 0) {
    all[index] = {
      ...all[index],
      name: input.name.trim(),
      systemPrompt: input.systemPrompt,
      model,
      effort: input.effort,
      updatedAt: now,
    };
  } else {
    all.unshift({
      id,
      name: input.name.trim() || "未命名",
      systemPrompt: input.systemPrompt,
      model,
      effort: input.effort,
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeAll(all);
  return id;
}

export async function deletePreset(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((p) => p.id !== id));
  // 删掉的正好是当前在用的 → 回落内置默认
  if ((await getActivePresetId()) === id) await setActivePresetId(DEFAULT_PRESET_ID);
}

export async function getActivePresetId(): Promise<string> {
  try {
    return (await LocalStorage.getItem<string>(ACTIVE_KEY)) || DEFAULT_PRESET_ID;
  } catch {
    return DEFAULT_PRESET_ID;
  }
}

export async function setActivePresetId(id: string): Promise<void> {
  await LocalStorage.setItem(ACTIVE_KEY, id);
}

/* ────────────────────── 内置预设的「覆盖」 ────────────────────── */

/**
 * 覆盖内置预设的哪些字段。
 *
 * - 字段**不存在**（`undefined`）= 没覆盖，用代码里的内置值
 * - `model: ""` = 显式选择"跟随命令/全局"（与"没覆盖"区分开）
 *
 * 这和 `prompt-config.ts` 覆盖命令 prompt 是同一套思路：内置的永远在、可恢复，
 * 用户改的只是叠在上面的一层。
 */
export interface BuiltinOverride {
  systemPrompt?: string;
  model?: string;
  effort?: PresetEffort;
}

/** 内置预设套用覆盖之后的生效值 */
export interface EffectiveBuiltin {
  id: string;
  name: string;
  subtitle: string;
  systemPrompt: string;
  /** undefined = 跟随 Chat 命令 / 扩展全局 */
  model?: string;
  effort: PresetEffort;
  /** 任意字段被覆盖过 */
  hasOverride: boolean;
}

const OVERRIDES_KEY = "deepseek-quick.chat-preset-overrides";

async function readOverrides(): Promise<Record<string, BuiltinOverride>> {
  try {
    const raw = await LocalStorage.getItem<string>(OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, BuiltinOverride>)
      : {};
  } catch (err) {
    dbg(`preset overrides: 解析失败，按无覆盖处理 ${String(err).slice(0, 200)}`);
    return {};
  }
}

/** 写入前丢掉空覆盖，全空时删 key，避免留一堆 `{}` */
async function writeOverrides(all: Record<string, BuiltinOverride>): Promise<void> {
  const kept = Object.fromEntries(
    Object.entries(all).filter(
      ([, v]) => v && (v.systemPrompt?.trim() || v.model !== undefined || v.effort !== undefined),
    ),
  );
  if (Object.keys(kept).length === 0) {
    await LocalStorage.removeItem(OVERRIDES_KEY);
    return;
  }
  await LocalStorage.setItem(OVERRIDES_KEY, JSON.stringify(kept));
}

export async function listBuiltinOverrides(): Promise<Record<string, BuiltinOverride>> {
  return readOverrides();
}

export async function setBuiltinOverride(id: string, override: BuiltinOverride): Promise<void> {
  const all = await readOverrides();
  all[id] = override;
  await writeOverrides(all);
}

/** 恢复内置默认（丢掉这个内置预设的全部覆盖） */
export async function clearBuiltinOverride(id: string): Promise<void> {
  const all = await readOverrides();
  delete all[id];
  await writeOverrides(all);
}

/**
 * 内置预设的**生效值**：代码默认值 + 用户覆盖。
 *
 * 「默认」预设的 `systemPrompt` 在代码里是 `undefined`，表示"用 Configure Prompts 里
 * Chat 的 prompt" —— 这里会把它解析成实际内容。
 */
export async function resolveBuiltinEffective(builtin: BuiltinPreset): Promise<EffectiveBuiltin> {
  const override = await getBuiltinOverride(builtin.id);
  const basePrompt = builtin.systemPrompt ?? (await resolveSystemPrompt("chat", CHAT_SYSTEM));

  return {
    id: builtin.id,
    name: builtin.name,
    subtitle: builtin.subtitle,
    systemPrompt: override?.systemPrompt?.trim() ? override.systemPrompt : basePrompt,
    // model 用 undefined 表示未覆盖；空串表示"显式跟随"
    model: override?.model !== undefined ? override.model.trim() || undefined : builtin.model,
    effort: override?.effort ?? builtin.effort,
    hasOverride: Boolean(
      override && (override.systemPrompt?.trim() || override.model !== undefined || override.effort !== undefined),
    ),
  };
}

async function getBuiltinOverride(id: string): Promise<BuiltinOverride | undefined> {
  return (await readOverrides())[id];
}

/**
 * 解析当前生效的预设：把 model / effort 的"跟随"逐级回落好。
 *
 * ⚠️ 必须在 **Chat 命令的上下文**里调用，才能拿到 chat 的 `modelOverride` / `effortOverride`
 * （`prefs()` 是命令作用域的）。在 Chat Presets 命令里调用只会拿到扩展全局值。
 */
export async function resolveActivePreset(): Promise<ResolvedChatPreset> {
  const p = prefs();

  /** 把"生效值"按 预设自身 → Chat 命令级 → 扩展全局 的顺序回落成可直接发请求的形式 */
  const finalize = (
    base: { id: string; name: string; systemPrompt: string; model?: string; effort: PresetEffort },
    isBuiltin: boolean,
  ): ResolvedChatPreset => ({
    id: base.id,
    name: base.name,
    systemPrompt: base.systemPrompt,
    model: base.model?.trim() || p.model,
    effort: base.effort === "inherit" ? p.reasoningEffort : base.effort,
    isBuiltin,
  });

  const activeId = await getActivePresetId();

  const builtin = findBuiltin(activeId);
  if (builtin) return finalize(await resolveBuiltinEffective(builtin), true);

  const preset = await getPreset(activeId);
  if (preset) {
    return finalize(
      {
        id: preset.id,
        name: preset.name,
        systemPrompt: preset.systemPrompt.trim() || (await resolveSystemPrompt("chat", CHAT_SYSTEM)),
        model: preset.model,
        effort: preset.effort,
      },
      false,
    );
  }

  // 预设被删掉 / 读不出来 → 静默回落内置「默认」，不要让 Chat 打不开
  const fallback = findBuiltin(DEFAULT_PRESET_ID);
  return finalize(
    fallback
      ? await resolveBuiltinEffective(fallback)
      : { id: DEFAULT_PRESET_ID, name: DEFAULT_PRESET_NAME, systemPrompt: CHAT_SYSTEM, effort: "inherit" },
    true,
  );
}

/** 给内置预设生成一句话摘要 */
export function describeBuiltin(preset: BuiltinPreset): string {
  if (!preset.model && preset.effort === "inherit") return "跟随命令 / 全局的模型与强度";
  const model = preset.model?.trim() || "跟随全局 Model";
  const effort = preset.effort === "inherit" ? "跟随全局强度" : `reasoning ${preset.effort}`;
  return `${model} · ${effort}`;
}

/** 给 UI 用的一句话摘要 */
export function describePreset(preset: ChatPreset): string {
  const model = preset.model?.trim() || "跟随全局 Model";
  const effort = preset.effort === "inherit" ? "跟随全局强度" : `reasoning ${preset.effort}`;
  return `${model} · ${effort}`;
}
