import { LocalStorage } from "@raycast/api";

/**
 * 每条 AI 命令的 system prompt 覆盖，存在 LocalStorage。
 *
 * 为什么不放 Raycast 偏好：偏好类型里**没有多行输入**
 * （只有 textfield / password / checkbox / dropdown / appPicker / file / directory），
 * 而 prompt 天然是多行的，塞进 textfield 得手写 `\n`。
 *
 * 所以最终的分工是：
 *   - model / 思考强度 → Raycast **原生命令级偏好**（见 config.ts 的 modelOverride / effortOverride）
 *   - system prompt    → 这个模块 + `Configure Prompts` 命令（Form.TextArea，真·多行）
 */

export const PROMPT_COMMANDS = ["explain", "translate", "rewrite", "ask-image", "chat"] as const;

export type PromptCommand = (typeof PROMPT_COMMANDS)[number];

export type PromptOverrides = Partial<Record<PromptCommand, string>>;

const STORAGE_KEY = "deepseek-quick.prompt-overrides";

async function readAll(): Promise<PromptOverrides> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PromptOverrides) : {};
  } catch {
    return {};
  }
}

/** 写入前过滤掉空值，全空时直接删 key，避免留一个 `{}` 占位 */
async function writeAll(overrides: PromptOverrides): Promise<void> {
  const entries = Object.entries(overrides).filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0,
  );
  if (entries.length === 0) {
    await LocalStorage.removeItem(STORAGE_KEY);
    return;
  }
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export async function listPromptOverrides(): Promise<PromptOverrides> {
  return readAll();
}

export async function getPromptOverride(command: PromptCommand): Promise<string | undefined> {
  return (await readAll())[command];
}

/**
 * 生效的 system prompt：有覆盖就用覆盖，否则用内置。
 * 空白字符串视为「没有覆盖」。
 */
export async function resolveSystemPrompt(command: PromptCommand, builtin: string): Promise<string> {
  try {
    const override = await getPromptOverride(command);
    return override?.trim() ? override : builtin;
  } catch {
    // 读配置失败不能连带把命令弄挂：静默回落到内置 prompt
    return builtin;
  }
}

/**
 * 保存覆盖。空值、或与内置 prompt 完全相同时，删除该命令的覆盖 ——
 * 这样「打开表单直接保存」不会把内置 prompt 固化成一份副本。
 */
export async function setPromptOverride(command: PromptCommand, value: string, builtin?: string): Promise<void> {
  const all = await readAll();
  const trimmed = value.trim();
  if (!trimmed || (builtin !== undefined && trimmed === builtin.trim())) {
    delete all[command];
  } else {
    all[command] = value;
  }
  await writeAll(all);
}

export async function removePromptOverride(command: PromptCommand): Promise<void> {
  const all = await readAll();
  delete all[command];
  await writeAll(all);
}

export async function clearPromptOverrides(): Promise<void> {
  await LocalStorage.removeItem(STORAGE_KEY);
}
