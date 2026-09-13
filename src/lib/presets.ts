import { LocalStorage } from "@raycast/api";
import { prefs, type Effort } from "./config";
import { dbg } from "./debug";
import { resolveSystemPrompt } from "./prompt-config";
import { CHAT_SYSTEM } from "./prompts";

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

/**
 * 解析当前生效的预设：把 model / effort 的"跟随"逐级回落好。
 *
 * ⚠️ 必须在 **Chat 命令的上下文**里调用，才能拿到 chat 的 `modelOverride` / `effortOverride`
 * （`prefs()` 是命令作用域的）。在 Chat Presets 命令里调用只会拿到扩展全局值。
 */
export async function resolveActivePreset(): Promise<ResolvedChatPreset> {
  const p = prefs();

  const builtin: ResolvedChatPreset = {
    id: DEFAULT_PRESET_ID,
    name: DEFAULT_PRESET_NAME,
    // 内置默认的 prompt 仍然走 Configure Prompts 的 chat 覆盖
    systemPrompt: await resolveSystemPrompt("chat", CHAT_SYSTEM),
    model: p.model,
    effort: p.reasoningEffort,
    isBuiltin: true,
  };

  const activeId = await getActivePresetId();
  if (activeId === DEFAULT_PRESET_ID) return builtin;

  const preset = await getPreset(activeId);
  // 预设被删掉/读不出来 → 静默回落，不要让 Chat 打不开
  if (!preset) return builtin;

  return {
    id: preset.id,
    name: preset.name,
    systemPrompt: preset.systemPrompt.trim() || builtin.systemPrompt,
    model: preset.model?.trim() || p.model,
    effort: preset.effort === "inherit" ? p.reasoningEffort : preset.effort,
    isBuiltin: false,
  };
}

/** 给 UI 用的一句话摘要 */
export function describePreset(preset: ChatPreset): string {
  const model = preset.model?.trim() || "跟随全局 Model";
  const effort = preset.effort === "inherit" ? "跟随全局强度" : `reasoning ${preset.effort}`;
  return `${model} · ${effort}`;
}
