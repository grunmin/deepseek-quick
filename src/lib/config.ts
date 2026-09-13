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
  /** 中英互译：自动判断方向（默认开启）。关闭后才用 translateTo */
  translateBidirectional: boolean;
  translateTo: string;
  showReasoning: boolean;
  outputBehavior: "replace" | "copy";
}

function asEffort(value: unknown, fallback: Effort): Effort {
  return value === "none" || value === "low" || value === "high" || value === "max" ? value : fallback;
}

/** 只认四个合法档位；`"inherit"` / 空 / 其它一律当「没覆盖」 */
function asOptionalEffort(value: unknown): Effort | undefined {
  return value === "none" || value === "low" || value === "high" || value === "max" ? value : undefined;
}

/**
 * 命令级偏好（`package.json` 里每条 command 的 `preferences`）。
 *
 * `getPreferenceValues()` 返回的是**当前命令作用域**的值：命令级偏好会自动继承扩展级，
 * 并覆盖同名字段。所以这里不需要知道「现在跑的是哪条命令」。
 *
 * ⚠️ 字段必须与扩展级**不同名**。Raycast 的「命令级覆盖扩展级」是连同该字段的 `default`
 * 一起生效的 —— 如果这里也叫 `model` 且带默认值，用户改了扩展全局 Model 也会被命令自己的
 * default 盖掉，全局设置直接失效。所以统一用 `xxxOverride` 命名，代码里显式做「空则回落」。
 */
type CommandScopedPreferences = ExtensionPreferences & {
  modelOverride?: string;
  effortOverride?: string;
};

export function prefs(): ExtensionPreferences {
  const p = getPreferenceValues<CommandScopedPreferences>();

  // 优先级：本命令的覆盖 → 扩展全局设置 → 兜底默认值
  const override = asOptionalEffort(p.effortOverride);

  return {
    apiKey: p.apiKey?.trim() || undefined,
    apiEndpoint: (p.apiEndpoint?.trim() || "https://api.deepseek.com/v1").replace(/\/+$/, ""),
    model: p.modelOverride?.trim() || p.model?.trim() || "deepseek-flash",
    quickActionEffort: override ?? asEffort(p.quickActionEffort, "none"),
    reasoningEffort: override ?? asEffort(p.reasoningEffort, "low"),
    // checkbox 默认 true；未设置时也要当作开启，所以用 !== false 而不是 Boolean()
    translateBidirectional: p.translateBidirectional !== false,
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
