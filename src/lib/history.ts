import { LocalStorage } from "@raycast/api";
import { messageText, type ChatMessage } from "./deepseek";

const STORAGE_KEY = "deepseek-quick.conversations";
const MAX_CONVERSATIONS = 200;

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

async function readAll(): Promise<Conversation[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Conversation[]) : [];
  } catch {
    return [];
  }
}

/**
 * 历史里不保存图片的 base64（会撑爆 LocalStorage），只留 [图片] 占位。
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
  const all = await readAll();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser ? messageText(firstUser).replace(/\s+/g, " ") : "对话";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || "对话";
}

/** 保存或更新一条对话；返回它的 id */
export async function saveConversation(messages: ChatMessage[], existingId?: string): Promise<string> {
  const all = await readAll();
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
  const all = await readAll();
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter((c) => c.id !== id)));
}

export async function clearConversations(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
