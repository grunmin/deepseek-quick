import { getPreferenceValues } from "@raycast/api";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dbg } from "./debug";
import { DEFAULT_AGENT_ARGS, resolveAcpLaunch, type AcpLaunch } from "./acp/launch";

export type Effort = "none" | "low" | "high" | "max";

/**
 * 「换模型重新生成」菜单的候选来源。
 *
 * Model 本身是**自由文本**偏好（OpenAI 兼容端点可以接任意模型名），枚举不完，
 * 所以这里只放确认可用的；菜单里还会并上「当前全局 Model」与「各 Preset 用到的模型」
 * （见 `components/result-view.tsx`），要接别的模型走菜单里的「自定义模型…」。
 */
export const KNOWN_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

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
  /** ACP agent（Agent 命令）的启动命令 / 参数 / 工作目录，解析见 lib/acp/launch.ts */
  agentCommand: string;
  agentArgs: string;
  agentCwd: string;
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
    // Agent 命令的三项都留空也行：command 兜底 /bin/bash，args 兜底 dsh 的 ACP 桥，
    // cwd 留空表示「用家目录」（真正的展开与校验在 resolveAcpLaunch 里）
    agentCommand: p.agentCommand?.trim() || "/bin/bash",
    agentArgs: p.agentArgs?.trim() || DEFAULT_AGENT_ARGS,
    agentCwd: p.agentCwd?.trim() || "",
  };
}

/**
 * Agent 命令要 spawn 什么。
 *
 * 单独包一层是为了让「偏好 → spawn 三元组」的解析只有一处：视图里直接拿结果去
 * `AcpClient.spawn`，不重复做 `~` 展开和参数切分。
 */
export function agentLaunch(): AcpLaunch {
  const p = prefs();
  return resolveAcpLaunch({ command: p.agentCommand, args: p.agentArgs, cwd: p.agentCwd });
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
