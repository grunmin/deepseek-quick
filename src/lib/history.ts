import { LocalStorage } from "@raycast/api";
import { messageText, type ChatMessage } from "./deepseek";
import { dbg } from "./debug";

const STORAGE_KEY = "deepseek-quick.conversations";
/**
 * 发现历史损坏时，把**原始字符串**原样存到这里。
 * 这样即使后续被覆盖，也还能把原始数据捞回来 —— 绝不静默丢数据。
 */
const CORRUPTED_BACKUP_KEY = "deepseek-quick.conversations.corrupted";
const MAX_CONVERSATIONS = 200;

const EXPORT_FORMAT = "deepseek-quick.history";
const EXPORT_VERSION = 1;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface HistorySnapshot {
  conversations: Conversation[];
  /** 存储里有内容但解析不出来 —— 此时**禁止任何写入**，否则会把原始数据覆盖掉 */
  corrupted: boolean;
  /** 该 key 占用的字符数，用于展示体积 */
  bytes: number;
}

export class HistoryCorruptedError extends Error {
  constructor() {
    super(
      "历史数据解析失败。为避免覆盖原始数据，本次写入已中止。" +
        "请到 Backup History 先把原始数据导出来，再决定是否清理。",
    );
    this.name = "HistoryCorruptedError";
  }
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<Conversation>;
  return (
    typeof c.id === "string" &&
    typeof c.title === "string" &&
    typeof c.updatedAt === "number" &&
    Array.isArray(c.messages)
  );
}

/**
 * 读历史。
 *
 * ⚠️ 解析失败**绝对不能**当成「空历史」：`saveConversation` 是 read-modify-write，
 * 一旦这里返回 `[]`，下一次保存就会把原始数据永久覆盖掉（旧版就是这么丢数据的）。
 * 所以这里返回 `corrupted` 标记，由写操作自己拒绝执行。
 */
export async function readHistory(): Promise<HistorySnapshot> {
  let raw: string | undefined;
  try {
    raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  } catch (err) {
    // 读都读不出来，同样不能当成空历史去覆盖
    dbg(`readHistory: 读 LocalStorage 失败 ${String(err).slice(0, 200)}`);
    return { conversations: [], corrupted: true, bytes: 0 };
  }

  if (!raw) return { conversations: [], corrupted: false, bytes: 0 };

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      await stashCorrupted(raw);
      return { conversations: [], corrupted: true, bytes: raw.length };
    }
    const conversations = parsed.filter(isConversation);
    if (conversations.length !== parsed.length) {
      dbg(`readHistory: ${parsed.length - conversations.length} 条结构不合法，已忽略`);
    }
    return { conversations, corrupted: false, bytes: raw.length };
  } catch (err) {
    dbg(`readHistory: JSON 解析失败，转入保护模式 ${String(err).slice(0, 200)}`);
    await stashCorrupted(raw);
    return { conversations: [], corrupted: true, bytes: raw.length };
  }
}

/** 把损坏的原始数据备份一份（只保留第一次发现的版本） */
async function stashCorrupted(raw: string): Promise<void> {
  try {
    const existing = await LocalStorage.getItem<string>(CORRUPTED_BACKUP_KEY);
    if (existing) return;
    await LocalStorage.setItem(CORRUPTED_BACKUP_KEY, raw);
    dbg(`stashCorrupted: 已备份 ${raw.length} 字符原始数据`);
  } catch (err) {
    dbg(`stashCorrupted: 备份失败 ${String(err).slice(0, 200)}`);
  }
}

/** 所有写操作的统一入口：损坏时抛错，绝不覆盖 */
async function writable(): Promise<Conversation[]> {
  const { conversations, corrupted } = await readHistory();
  if (corrupted) throw new HistoryCorruptedError();
  return conversations;
}

/**
 * 历史里不保存图片的 base64（会撑爆 LocalStorage），只留 [图片] 占位。
 *
 * 注意这意味着**继续一条带图的旧对话时，模型看不到那张图** —— 属于有意的取舍。
 */
function stripImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return m;
    return {
      role: m.role,
      content: m.content
        .map((part) => (part.type === "text" ? part.text : "[图片]"))
        .filter((t) => t.length > 0)
        .join("\n"),
    } as ChatMessage;
  });
}

export async function listConversations(): Promise<Conversation[]> {
  const { conversations } = await readHistory();
  return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? messageText(firstUser).replace(/\s+/g, " ") : "对话";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "对话";
}

/** 保存或更新一条对话；返回它的 id */
export async function saveConversation(messages: ChatMessage[], existingId?: string): Promise<string> {
  const all = await writable();
  const now = Date.now();
  const stripped = stripImages(messages);

  const id = existingId ?? `c_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const index = all.findIndex((c) => c.id === id);

  if (index >= 0) {
    all[index] = {
      ...all[index],
      messages: stripped,
      updatedAt: now,
      title: deriveTitle(stripped),
    };
  } else {
    all.unshift({
      id,
      title: deriveTitle(stripped),
      createdAt: now,
      updatedAt: now,
      messages: stripped,
    });
  }

  all.sort((a, b) => b.updatedAt - a.updatedAt);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, MAX_CONVERSATIONS)));
  return id;
}

export async function deleteConversation(id: string): Promise<void> {
  const all = await writable();
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter((c) => c.id !== id)));
}

/* ────────────────────────── 导出 / 导入 ────────────────────────── */

export interface HistoryFile {
  format: string;
  version: number;
  exportedAt: string;
  conversations: Conversation[];
}

/** 生成可读的导出文件内容 */
export function buildExportPayload(conversations: Conversation[]): string {
  const payload: HistoryFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    conversations,
  };
  return JSON.stringify(payload, null, 2);
}

/** 解析导入文件。格式不对就抛错，不静默吞掉 */
export function parseHistoryFile(text: string): Conversation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是合法的 JSON 文件。");
  }

  // 同时接受本扩展导出的对象格式，和手工准备的裸数组
  const list = Array.isArray(parsed) ? parsed : (parsed as Partial<HistoryFile> | null)?.conversations;
  if (!Array.isArray(list)) throw new Error("文件里找不到 conversations 数组。");

  const conversations = list.filter(isConversation);
  if (conversations.length === 0) throw new Error("文件里没有可导入的对话。");
  return conversations;
}

/**
 * 合并导入：按 `id` 去重，`updatedAt` 更新的胜出。
 * 是**合并**而不是替换 —— 导入不该把现有历史干掉。
 */
export async function importConversations(
  incoming: Conversation[],
): Promise<{ added: number; updated: number; total: number }> {
  const all = await writable();
  const byId = new Map(all.map((c) => [c.id, c]));

  let added = 0;
  let updated = 0;
  for (const conversation of incoming) {
    const existing = byId.get(conversation.id);
    if (!existing) {
      byId.set(conversation.id, conversation);
      added += 1;
    } else if (conversation.updatedAt > existing.updatedAt) {
      byId.set(conversation.id, conversation);
      updated += 1;
    }
  }

  const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return { added, updated, total: merged.length };
}

/** 取出损坏时备份的原始字符串（用于抢救） */
export async function readCorruptedBackup(): Promise<string | undefined> {
  try {
    return (await LocalStorage.getItem<string>(CORRUPTED_BACKUP_KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 彻底清空历史 + 损坏备份。破坏性操作，调用方需自己确认 */
export async function clearAllHistoryData(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
  await LocalStorage.removeItem(CORRUPTED_BACKUP_KEY);
}
