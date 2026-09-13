import { LocalStorage } from "@raycast/api";
import { dbg } from "./debug";

/**
 * 换机迁移：把「这个扩展独有的、不可重建的用户数据」打包成一个普通 JSON 文件。
 *
 * 为什么需要这个模块：
 *   数据散在若干个 LocalStorage key 里（历史 / 自定义预设 / 预设的当前选择 /
 *   内置预设覆盖 / 每条命令的 prompt 覆盖），而它们都躺在 Raycast 的**加密本地库**
 *   （`main.db`，外部读不了），且**不跨设备同步**。
 *   原来只有「对话历史」能导出，换台机器预设和 prompt 覆盖就没了 —— 这个模块补上这块。
 *
 * 分工（按能不能重建划分）：
 *   - 对话历史          → 只能导出，不可重建（本模块 + `history.ts` 的旧格式都认）
 *   - 自定义预设        → 用户手写，不可重建
 *   - 内置预设覆盖      → 用户在「资深模式 / 深度研究」上叠的改动
 *   - prompt 覆盖       → 用户在 Configure Prompts 里写的
 *   - 当前选中的预设    → 一条 id，带上省得新机器再选一次
 *
 * 刻意**不导出**：
 *   - API Key          → 密钥不该跟着文件走；新机器上重填更安全（也支持环境变量 / credentials.yaml）
 *   - Raycast 偏好     → 存在 Raycast 偏好库里（不在 LocalStorage），且本身没有导入 API
 */

/** 旧版历史导出文件里的识别字段，用来区分「只有历史」的老文件 */
const HISTORY_FORMAT = "deepseek-quick.history";

/** 迁移包格式名，也是识别字段 */
export const MIGRATION_FORMAT = "deepseek-quick.migration";

/**
 * 迁移包 schema 版本。
 *
 * ⚠️ 改动 payload 结构时必须 +1，并且旧版本要能继续被读。
 * 加新 section 时**不必**升版本：老版本读到不认识的 key 会忽略并提示（见 parseMigrationBundle）。
 */
export const MIGRATION_VERSION = 1;

/** 这份包**可能**包含的数据段 —— 逐个独立可选，缺一个不影响其它 */
export const MIGRATION_FEATURES = [
  "history",
  "presets",
  "activePreset",
  "presetOverrides",
  "promptOverrides",
  "corruptedBackup",
] as const;

export type MigrationFeature = (typeof MIGRATION_FEATURES)[number];

/* ─────────────────────────── LocalStorage key ─────────────────────────── */

const K = {
  history: "deepseek-quick.conversations",
  corrupted: "deepseek-quick.conversations.corrupted",
  presets: "deepseek-quick.chat-presets",
  active: "deepseek-quick.chat-active-preset",
  presetOverrides: "deepseek-quick.chat-preset-overrides",
  promptOverrides: "deepseek-quick.prompt-overrides",
  /** 导入前自动存一份原状，给「撤销上一次导入」用 */
  undo: "deepseek-quick.migration-undo",
} as const;

/* ─────────────────────────────── 包结构 ─────────────────────────────── */

/** 预设的最小形状。故意不 import `presets.ts` 的 `ChatPreset`，避免和那边的 normalize 逻辑耦合 */
export interface BundlePreset {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string;
  effort: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface MigrationPayload {
  /** 与旧版 `Backup History` 导出格式保持一致（含 format/version 头），可直接被旧命令导入 */
  history?: { format: string; version: number; exportedAt: number; conversations: unknown[] };
  presets?: BundlePreset[];
  activePreset?: string;
  /** 内置预设 id → 覆盖字段 */
  presetOverrides?: Record<string, unknown>;
  /** 命令名 → 自定义 system prompt */
  promptOverrides?: Record<string, string>;
  /** 历史损坏时抢救出来的**原始字符串** */
  corruptedBackup?: string;
}

export interface MigrationBundle {
  format: typeof MIGRATION_FORMAT;
  version: number;
  exportedAt: number;
  /** 写这个包的扩展（`package.json` 的 name）。不同扩展名不能互导 —— 存储命名空间不同 */
  extension: string;
  /** 这份包包含哪些段 */
  features: MigrationFeature[];
  payload: MigrationPayload;
}

/* ──────────────────────────── 读取本机现状 ──────────────────────────── */

async function readRaw(key: string): Promise<string | undefined> {
  try {
    return (await LocalStorage.getItem<string>(key)) ?? undefined;
  } catch (err) {
    dbg(`migration: 读 ${key} 失败 ${String(err).slice(0, 200)}`);
    return undefined;
  }
}

/** 容错解析：不是对象就当没有，不抛错 */
function parseObject<T>(raw: string | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : undefined;
  } catch (err) {
    dbg(`migration: 解析失败，按不存在处理 ${String(err).slice(0, 200)}`);
    return undefined;
  }
}

function parseArray<T>(raw: string | undefined): T[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch (err) {
    dbg(`migration: 解析数组失败，按不存在处理 ${String(err).slice(0, 200)}`);
    return undefined;
  }
}

/**
 * 新机器上导入前先看这个：本机各段现在有多少东西。
 * 用来渲染「即将覆盖什么」的预览，避免用户盲目导入。
 */
export interface LocalSnapshot {
  conversations: number;
  presets: number;
  activePreset?: string;
  presetOverrideIds: string[];
  promptOverrideCommands: string[];
  hasCorruptedBackup: boolean;
  /** 上一次导入留下的撤销点时间戳 */
  undoAt?: number;
}

export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const [historyRaw, presetsRaw, activeRaw, presetOvRaw, promptOvRaw, undoRaw] = await Promise.all([
    readRaw(K.history),
    readRaw(K.presets),
    readRaw(K.active),
    readRaw(K.presetOverrides),
    readRaw(K.promptOverrides),
    readRaw(K.undo),
  ]);

  const undo = parseObject<{ savedAt?: number }>(undoRaw);

  return {
    conversations: parseArray<unknown>(historyRaw)?.length ?? 0,
    presets: parseArray<BundlePreset>(presetsRaw)?.length ?? 0,
    activePreset: activeRaw || undefined,
    presetOverrideIds: Object.keys(parseObject<Record<string, unknown>>(presetOvRaw) ?? {}),
    promptOverrideCommands: Object.keys(parseObject<Record<string, string>>(promptOvRaw) ?? {}),
    hasCorruptedBackup: Boolean(await readRaw(K.corrupted)),
    undoAt: typeof undo?.savedAt === "number" ? undo.savedAt : undefined,
  };
}

/* ────────────────────────────── 导出 ────────────────────────────── */

/** 导出时都要带上哪些段（`history` 按用户选择单独控制，见 ExportForm） */
export interface ExportOptions {
  /** 包进对话历史 */
  history: boolean;
  /** 包进损坏历史的原始字符串（体积可能很大，默认关） */
  corruptedBackup?: boolean;
}

export interface ExportResult {
  bundle: MigrationBundle;
  /** 人类可读的清单，直接拿去展示 */
  items: { feature: MigrationFeature; label: string; count: number }[];
  json: string;
}

/** 打包本机数据。空段不写进 payload，避免包里一堆 `undefined` */
export async function buildMigrationBundle(options: ExportOptions): Promise<ExportResult> {
  const [historyRaw, presetsRaw, activeRaw, presetOvRaw, promptOvRaw, corruptedRaw] = await Promise.all([
    readRaw(K.history),
    readRaw(K.presets),
    readRaw(K.active),
    readRaw(K.presetOverrides),
    readRaw(K.promptOverrides),
    options.corruptedBackup ? readRaw(K.corrupted) : Promise.resolve(undefined),
  ]);

  const payload: MigrationPayload = {};
  const features: MigrationFeature[] = [];
  const items: ExportResult["items"] = [];

  if (options.history) {
    const conversations = parseArray<unknown>(historyRaw) ?? [];
    // 空段也一并跳过：`features` 只记录**真的有内容**的段，导出端的空包检查和 UI 预览都靠它
    if (conversations.length > 0) {
      payload.history = {
        format: HISTORY_FORMAT,
        version: 1,
        exportedAt: Date.now(),
        conversations,
      };
      features.push("history");
      items.push({ feature: "history", label: "对话历史", count: conversations.length });
    }
  }

  const presets = parseArray<BundlePreset>(presetsRaw);
  if (presets && presets.length > 0) {
    payload.presets = presets;
    features.push("presets");
    items.push({ feature: "presets", label: "自定义 Preset", count: presets.length });
  }

  if (activeRaw) {
    payload.activePreset = activeRaw;
    features.push("activePreset");
    items.push({ feature: "activePreset", label: "当前选中的 Preset", count: 1 });
  }

  const presetOverrides = parseObject<Record<string, unknown>>(presetOvRaw);
  if (presetOverrides && Object.keys(presetOverrides).length > 0) {
    payload.presetOverrides = presetOverrides;
    features.push("presetOverrides");
    items.push({
      feature: "presetOverrides",
      label: "内置 Preset 覆盖",
      count: Object.keys(presetOverrides).length,
    });
  }

  const promptOverrides = parseObject<Record<string, string>>(promptOvRaw);
  if (promptOverrides && Object.keys(promptOverrides).length > 0) {
    payload.promptOverrides = promptOverrides;
    features.push("promptOverrides");
    items.push({
      feature: "promptOverrides",
      label: "命令 Prompt 覆盖",
      count: Object.keys(promptOverrides).length,
    });
  }

  if (corruptedRaw) {
    payload.corruptedBackup = corruptedRaw;
    features.push("corruptedBackup");
    items.push({ feature: "corruptedBackup", label: "损坏历史原始数据", count: corruptedRaw.length });
  }

  const bundle: MigrationBundle = {
    format: MIGRATION_FORMAT,
    version: MIGRATION_VERSION,
    exportedAt: Date.now(),
    extension: "deepseek-quick",
    features,
    payload,
  };

  return { bundle, items, json: JSON.stringify(bundle, null, 2) };
}

/**
 * 空包没有意义，而且导出端会拒绝导入它（`parseMigrationBundle` 对没有任何段的包抛错）。
 * 与其写一个导不回来的文件，不如在导出前就拦住。
 */
export function isEmptyBundle(result: ExportResult): boolean {
  return result.bundle.features.length === 0;
}

/* ────────────────────────────── 解析 ────────────────────────────── */

export interface ParsedBundle {
  /** 规范成统一结构；老格式（只有历史）会被包装成同样的形状 */
  bundle: MigrationBundle;
  /** 这个文件里实际有的段 */
  features: MigrationFeature[];
  /** 包里出现了但本版本不认识的段 —— 提示用户别用旧版本覆盖新版本导出的数据 */
  unknownSections: string[];
  /** 是不是旧版 `Backup History` 的「只有历史」文件 */
  legacyHistoryOnly: boolean;
}

function isFeature(value: unknown): value is MigrationFeature {
  return typeof value === "string" && (MIGRATION_FEATURES as readonly string[]).includes(value);
}

function isBundlePreset(value: unknown): value is BundlePreset {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<BundlePreset>;
  return typeof p.id === "string" && typeof p.name === "string" && typeof p.systemPrompt === "string";
}

/**
 * 解析一个文件。三类都认：
 *   1. 本模块导出的迁移包（含 `payload`）
 *   2. 旧版 `Backup History` 导出的历史文件（顶层 `conversations`）
 *   3. 手工准备的裸对话数组
 *
 * 拿不准就抛错，**绝不**静默当成空包 —— 否则用户会以为导入成功、实际啥也没进来。
 */
export function parseMigrationBundle(text: string): ParsedBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是合法的 JSON 文件。");
  }

  // 情况 3：裸数组
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error("文件里没有可导入的对话。");
    return asHistoryOnly(parsed, true);
  }

  if (!parsed || typeof parsed !== "object") throw new Error("文件内容不是对象，也不是对话数组。");

  const obj = parsed as Record<string, unknown>;
  const knownTopLevel = new Set(["format", "version", "exportedAt", "extension", "features", "payload"]);

  // 情况 1：迁移包
  if (obj.payload && typeof obj.payload === "object" && !Array.isArray(obj.payload)) {
    const rawPayload = obj.payload as Record<string, unknown>;
    const payload: MigrationPayload = {};
    const features: MigrationFeature[] = [];
    const unknownSections: string[] = [];

    for (const [key, value] of Object.entries(rawPayload)) {
      if (value === undefined || value === null) continue;
      switch (key) {
        case "history": {
          const history = value as MigrationPayload["history"];
          const conversations = Array.isArray(history?.conversations) ? history.conversations : [];
          payload.history = {
            format: typeof history?.format === "string" ? history.format : HISTORY_FORMAT,
            version: typeof history?.version === "number" ? history.version : 1,
            exportedAt: typeof history?.exportedAt === "number" ? history.exportedAt : Date.now(),
            conversations,
          };
          features.push("history");
          break;
        }
        case "presets": {
          const list = Array.isArray(value) ? value.filter(isBundlePreset) : [];
          if (list.length > 0) {
            payload.presets = list;
            features.push("presets");
          }
          break;
        }
        case "activePreset":
          if (typeof value === "string" && value) {
            payload.activePreset = value;
            features.push("activePreset");
          }
          break;
        case "presetOverrides": {
          const record = asRecord(value);
          if (record && Object.keys(record).length > 0) {
            payload.presetOverrides = record;
            features.push("presetOverrides");
          }
          break;
        }
        case "promptOverrides": {
          const record = asRecord(value);
          const strings = record
            ? Object.fromEntries(
                Object.entries(record).filter(([, v]) => typeof v === "string" && v.trim().length > 0),
              )
            : undefined;
          if (strings && Object.keys(strings).length > 0) {
            payload.promptOverrides = strings as Record<string, string>;
            features.push("promptOverrides");
          }
          break;
        }
        case "corruptedBackup":
          if (typeof value === "string" && value) {
            payload.corruptedBackup = value;
            features.push("corruptedBackup");
          }
          break;
        default:
          // 不认识的段：记下来提示，不报错（老版本读新版本的文件）
          unknownSections.push(key);
      }
    }

    if (features.length === 0) throw new Error("迁移包里没有可导入的数据。");

    // 顶层多出来的字段同样算「不认识的段」
    for (const key of Object.keys(obj)) {
      if (!knownTopLevel.has(key)) unknownSections.push(key);
    }

    return {
      bundle: {
        format: MIGRATION_FORMAT,
        version: typeof obj.version === "number" ? obj.version : MIGRATION_VERSION,
        exportedAt: typeof obj.exportedAt === "number" ? obj.exportedAt : Date.now(),
        extension: typeof obj.extension === "string" ? obj.extension : "deepseek-quick",
        features,
        payload,
      },
      features,
      unknownSections,
      legacyHistoryOnly: false,
    };
  }

  // 情况 2：旧版历史文件 `{ format, version, exportedAt, conversations }`
  if (Array.isArray(obj.conversations)) {
    if (obj.conversations.length === 0) throw new Error("文件里没有可导入的对话。");
    return asHistoryOnly(obj.conversations, true);
  }

  throw new Error("认不出这个文件的格式。请选择本扩展导出的迁移包或历史文件。");
}

function asHistoryOnly(conversations: unknown[], legacy: boolean): ParsedBundle {
  const payload: MigrationPayload = {
    history: { format: HISTORY_FORMAT, version: 1, exportedAt: Date.now(), conversations },
  };
  return {
    bundle: {
      format: MIGRATION_FORMAT,
      version: MIGRATION_VERSION,
      exportedAt: Date.now(),
      extension: "deepseek-quick",
      features: ["history"],
      payload,
    },
    features: ["history"],
    unknownSections: [],
    legacyHistoryOnly: legacy,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/* ────────────────────────────── 预览 ────────────────────────────── */

export interface ImportPlan {
  /** 历史：会新增 / 会被更新 */
  history: { incoming: number; added: number; updated: number };
  /** 自定义预设：新增 / 更新 */
  presets: { incoming: number; added: number; updated: number };
  /** 当前选中预设是否会被改写（本机 → 包里的） */
  activePreset?: { from?: string; to: string };
  /** 内置预设覆盖：包里带的是这些 id */
  presetOverrides: string[];
  /** prompt 覆盖：包里带的是这些命令 */
  promptOverrides: string[];
  /** 会覆盖本机同 key 的 prompt 覆盖命令（真正有损失的只有这些） */
  promptOverridesOverwriting: string[];
  /** 内置预设覆盖里会覆盖本机已有覆盖的 id */
  presetOverridesOverwriting: string[];
  /**
   * 导入后可能「指向不存在的预设」的自定义 id。
   *
   * 场景：两条对话用了同一个自定义预设，在源机器上 A 被删、只剩 B 挂着这个 id。
   * 换机时 A 和 B 一起导入，A 会顶替 B 占住这个 id —— 在目标机器上就指错了人。
   * 只在「该 id 本机真实存在」时才算冲突（否则是普通新增）。
   */
  presetIdConflicts: string[];
  corruptedBackup?: { chars: number; overwriting: boolean };
  unknownSections: string[];
  legacyHistoryOnly: boolean;
  /** 包的 schema 版本，展示用 */
  bundleVersion: number;
}

/**
 * 算清楚「导入会改动什么」。
 *
 * 原则：**只有 prompt / 内置预设覆盖是替换语义**（同 key 覆盖），
 * 历史和自定义预设都是合并（按 id + 时间戳），所以那份损失必须提前告诉用户。
 */
export async function planImport(parsed: ParsedBundle): Promise<ImportPlan> {
  const local = await readLocalSnapshot();
  const { payload } = parsed.bundle;

  const incomingHistory = payload.history?.conversations ?? [];
  const localIds = await readHistoryIds();
  const added = incomingHistory.filter((c) => {
    const id = (c as { id?: unknown })?.id;
    return typeof id !== "string" || !localIds.has(id);
  }).length;

  const incomingPresets = payload.presets ?? [];
  const localPresetIds = await readPresetIds();
  const presetAdded = incomingPresets.filter((p) => !localPresetIds.has(p.id)).length;

  /*
   * 同一个 id 在包里出现两次、且其中一条本机已有 → 本机那条会被时间戳更新的那条顶掉。
   * 典型来源：源机器上「复制为新的」生成的 id 曾被复用。
   */
  const seenIncoming = new Map<string, number>();
  for (const preset of incomingPresets) {
    seenIncoming.set(preset.id, (seenIncoming.get(preset.id) ?? 0) + 1);
  }
  const presetIdConflicts = [...seenIncoming.entries()]
    .filter(([id, count]) => count > 1 && localPresetIds.has(id))
    .map(([id]) => id);

  const presetOverrides = Object.keys(payload.presetOverrides ?? {});
  const promptOverrides = Object.keys(payload.promptOverrides ?? {});
  const corrupted = payload.corruptedBackup;

  return {
    history: {
      incoming: incomingHistory.length,
      added,
      updated: incomingHistory.length - added,
    },
    presets: {
      incoming: incomingPresets.length,
      added: presetAdded,
      updated: incomingPresets.length - presetAdded,
    },
    activePreset: payload.activePreset
      ? { from: local.activePreset, to: payload.activePreset }
      : undefined,
    presetOverrides,
    promptOverrides,
    promptOverridesOverwriting: promptOverrides.filter((c) => local.promptOverrideCommands.includes(c)),
    presetOverridesOverwriting: presetOverrides.filter((id) => local.presetOverrideIds.includes(id)),
    presetIdConflicts,
    corruptedBackup:
      typeof corrupted === "string" ? { chars: corrupted.length, overwriting: local.hasCorruptedBackup } : undefined,
    unknownSections: parsed.unknownSections,
    legacyHistoryOnly: parsed.legacyHistoryOnly,
    bundleVersion: parsed.bundle.version,
  };
}

async function readHistoryIds(): Promise<Set<string>> {
  const list = parseArray<{ id?: unknown }>(await readRaw(K.history)) ?? [];
  return new Set(list.map((c) => c.id).filter((id): id is string => typeof id === "string"));
}

async function readPresetIds(): Promise<Set<string>> {
  const list = parseArray<BundlePreset>(await readRaw(K.presets)) ?? [];
  return new Set(list.map((p) => p.id));
}

/* ────────────────────────────── 应用 ────────────────────────────── */

export interface ApplyResult {
  history: { added: number; updated: number; total: number } | null;
  presets: { added: number; updated: number; total: number } | null;
  activePresetApplied: string | null;
  presetOverrides: number;
  promptOverrides: number;
  corruptedBackupRestored: boolean;
  /** 包里的 presetOverrides / promptOverrides 覆盖了本机同 key 的数量（撤销点就是为它们存的） */
  overwritten: number;
}

/**
 * 写回本机。
 *
 * 写之前先把所有**将被改动的 key 的原始值**存进撤销点 —— 导入是破坏性的
 * （prompt 覆盖是替换语义），必须给用户一条后悔路。
 */
export async function applyMigrationBundle(parsed: ParsedBundle): Promise<ApplyResult> {
  const { payload } = parsed.bundle;

  await saveUndoPoint();

  const result: ApplyResult = {
    history: null,
    presets: null,
    activePresetApplied: null,
    presetOverrides: 0,
    promptOverrides: 0,
    corruptedBackupRestored: false,
    overwritten: 0,
  };

  /* 历史：复用 history.ts 的合并逻辑（按 id 去重、updatedAt 新的胜） */
  if (payload.history) {
    const { importConversations, parseHistoryFile } = await import("./history");
    const conversations = parseHistoryFile(JSON.stringify(payload.history));
    result.history = await importConversations(conversations);
  }

  /* 自定义预设：同样是按 id 合并，时间戳新的胜 */
  if (payload.presets && payload.presets.length > 0) {
    result.presets = await mergePresets(payload.presets);
  }

  /* 内置预设覆盖：只替换包里带到的 id，其余保持本机原样 */
  if (payload.presetOverrides) {
    const local = parseObject<Record<string, unknown>>(await readRaw(K.presetOverrides)) ?? {};
    const merged = { ...local, ...payload.presetOverrides };
    await LocalStorage.setItem(K.presetOverrides, JSON.stringify(merged));
    result.presetOverrides = Object.keys(payload.presetOverrides).length;
    result.overwritten += Object.keys(payload.presetOverrides).filter((id) => id in local).length;
  }

  /* prompt 覆盖：只替换包里带到的命令，其余保持本机原样 */
  if (payload.promptOverrides) {
    const local = parseObject<Record<string, string>>(await readRaw(K.promptOverrides)) ?? {};
    const merged = { ...local, ...payload.promptOverrides };
    await LocalStorage.setItem(K.promptOverrides, JSON.stringify(merged));
    result.promptOverrides = Object.keys(payload.promptOverrides).length;
    result.overwritten += Object.keys(payload.promptOverrides).filter((c) => c in local).length;
  }

  /* 当前选中的预设：包里指定了才改 */
  if (payload.activePreset) {
    await LocalStorage.setItem(K.active, payload.activePreset);
    result.activePresetApplied = payload.activePreset;
  }

  /* 损坏历史的原始数据：本机没有才恢复，绝不覆盖本机已有的抢救数据 */
  if (payload.corruptedBackup && !(await readRaw(K.corrupted))) {
    await LocalStorage.setItem(K.corrupted, payload.corruptedBackup);
    result.corruptedBackupRestored = true;
  }

  return result;
}

/**
 * 预设按 id 合并。这里不 import `presets.ts` 的 `upsertPreset`：
 * 那个是「单条 upsert + 界面语义」，这里要的是批量合并，且要能报出 added/updated。
 */
async function mergePresets(incoming: BundlePreset[]): Promise<{ added: number; updated: number; total: number }> {
  const local = parseArray<BundlePreset>(await readRaw(K.presets)) ?? [];
  const byId = new Map(local.map((p) => [p.id, p]));
  const now = Date.now();

  let added = 0;
  let updated = 0;
  for (const preset of incoming) {
    const existing = byId.get(preset.id);
    if (!existing) {
      byId.set(preset.id, {
        ...preset,
        createdAt: typeof preset.createdAt === "number" ? preset.createdAt : now,
        updatedAt: typeof preset.updatedAt === "number" ? preset.updatedAt : now,
      });
      added += 1;
    } else if ((preset.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      byId.set(preset.id, { ...existing, ...preset });
      updated += 1;
    }
  }

  const merged = [...byId.values()];
  await LocalStorage.setItem(K.presets, JSON.stringify(merged));
  return { added, updated, total: merged.length };
}

/* ──────────────────────────── 撤销点 ──────────────────────────── */

interface UndoPoint {
  savedAt: number;
  values: Record<string, string | null>;
}

/**
 * 存撤销点：只存本次导入**可能改动**的那几个 key。
 *
 * 用 `null` 表示「导入前这个 key 不存在」，撤销时要删掉而不是写回空串。
 */
async function saveUndoPoint(): Promise<void> {
  const keys = [K.history, K.presets, K.active, K.presetOverrides, K.promptOverrides, K.corrupted];
  const values: Record<string, string | null> = {};
  for (const key of keys) {
    values[key] = (await readRaw(key)) ?? null;
  }
  const point: UndoPoint = { savedAt: Date.now(), values };
  await LocalStorage.setItem(K.undo, JSON.stringify(point));
}

export async function describeUndoPoint(): Promise<{ savedAt: number } | undefined> {
  const raw = await readRaw(K.undo);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as UndoPoint;
    return typeof parsed?.savedAt === "number" ? { savedAt: parsed.savedAt } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 撤销上一次导入：把当时存的原始值逐一写回。
 *
 * 注意这只能撤销**扩展存储**里的改动 —— 导入时若把某条历史记成了新对话，
 * 撤销点里存的是导入前的历史快照，写回后那批新增自然就没了，符合"撤销"的语义。
 */
export async function undoLastMigration(): Promise<{ restored: number; savedAt: number }> {
  const raw = await readRaw(K.undo);
  if (!raw) throw new Error("没有可撤销的导入记录。");

  let point: UndoPoint;
  try {
    point = JSON.parse(raw) as UndoPoint;
  } catch {
    throw new Error("撤销点已损坏，无法撤销。");
  }
  if (!point?.values || typeof point.values !== "object") throw new Error("撤销点已损坏，无法撤销。");

  let restored = 0;
  for (const [key, value] of Object.entries(point.values)) {
    try {
      if (value === null) {
        await LocalStorage.removeItem(key);
      } else {
        await LocalStorage.setItem(key, value);
      }
      restored += 1;
    } catch (err) {
      dbg(`migration: 撤销 ${key} 失败 ${String(err).slice(0, 200)}`);
    }
  }

  // 撤销点用掉就删，避免"撤销两次"把更早的状态写回来
  await LocalStorage.removeItem(K.undo);
  return { restored, savedAt: point.savedAt };
}
