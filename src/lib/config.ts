import { getPreferenceValues } from "@raycast/api";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dbg } from "./debug";

export type Effort = "none" | "low" | "high" | "max";

export interface ExtensionPreferences {
  apiKey?: string;
  apiEndpoint: string;
  model: string;
  quickActionEffort: Effort;
  reasoningEffort: Effort;
  translateTo: string;
  showReasoning: boolean;
  outputBehavior: "replace" | "copy";
}

function asEffort(value: unknown, fallback: Effort): Effort {
  return value === "none" || value === "low" || value === "high" || value === "max" ? value : fallback;
}

export function prefs(): ExtensionPreferences {
  const p = getPreferenceValues<ExtensionPreferences>();
  return {
    apiKey: p.apiKey?.trim() || undefined,
    apiEndpoint: (p.apiEndpoint?.trim() || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
    model: p.model?.trim() || "deepseek-flash",
    quickActionEffort: asEffort(p.quickActionEffort, "none"),
    reasoningEffort: asEffort(p.reasoningEffort, "low"),
    translateTo: p.translateTo?.trim() || "中文",
    showReasoning: Boolean(p.showReasoning),
    outputBehavior: p.outputBehavior === "copy" ? "copy" : "replace",
  };
}

let cachedKey: string | undefined;

/**
 * API Key 解析顺序：
 *   1. 扩展设置里的 API Key
 *   2. 环境变量 DEEPSEEK_API_KEY
 *   3. ~/.dsh/.credentials.yaml 里的 refs.DEEPSEEK_API_KEY
 * 第 3 条是为了省去重复粘贴；不需要可以删掉。
 */
export function apiKey(): string {
  if (cachedKey) return cachedKey;

  const fromPrefs = prefs().apiKey;
  if (fromPrefs) return (cachedKey = fromPrefs);
  dbg("apiKey: prefs 为空，尝试环境变量");

  const fromEnv = process.env.DEEPSEEK_API_KEY?.trim();
  if (fromEnv) return (cachedKey = fromEnv);
  dbg("apiKey: 环境变量为空，尝试 ~/.dsh/.credentials.yaml");

  try {
    const raw = readFileSync(join(homedir(), ".dsh", ".credentials.yaml"), "utf8");
    const m = raw.match(/^\s*DEEPSEEK_API_KEY:\s*["']?([^"'\s]+)["']?\s*$/m);
    if (m?.[1]) {
      dbg("apiKey: 从 ~/.dsh/.credentials.yaml 取到");
      return (cachedKey = m[1]);
    }
    dbg("apiKey: credentials.yaml 里没有匹配到 DEEPSEEK_API_KEY");
  } catch (err) {
    dbg(`apiKey: 读 credentials.yaml 失败 ${String(err).slice(0, 200)}`);
  }

  throw new Error("找不到 API Key。请在扩展设置里填写 API Key，或设置环境变量 DEEPSEEK_API_KEY。");
}
