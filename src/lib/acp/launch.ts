import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * 「用哪个命令启动 agent」的解析。
 *
 * 单独放一个文件（而不是塞进 `config.ts`）是为了让它保持**纯 Node**：
 * `config.ts` 引了 `@raycast/api`，一旦被拖进来就没法在 `scripts/verify-acp.mjs`
 * 里直接跑了。
 */

/** 默认启动器：dsh 的 acp-enhanced 桥。这是 dsh 官方给 Zed 用的那条脚本，同样适用于任何 ACP 客户端 */
export const DEFAULT_AGENT_ARGS =
  "~/.dsh/profiles/acp-enhanced/node_modules/dsh-acp-enhanced/scripts/dsh-acp-zed.sh";

export interface AcpLaunchPreferences {
  command: string;
  args: string;
  cwd: string;
}

export interface AcpLaunch {
  command: string;
  args: string[];
  /** 子进程工作目录，同时也是 session 的 cwd（agent 的相对路径都基于它） */
  cwd: string;
}

/** `~` / `$HOME` 展开：偏好输入框里没法指望用户写绝对路径 */
export function expandHome(input: string, home: string = homedir()): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return resolve(home, trimmed.slice(2));
  return trimmed.replace(/^\$HOME(?=\/|$)/, home);
}

/**
 * 参数也要展开 `~`。
 *
 * 这不是锦上添花：`agentArgs` 的默认值就是 `~/.dsh/.../dsh-acp-zed.sh`，而 spawn 不做
 * shell 展开 —— 不处理的话默认配置一启动就是「no such file」，而且报错藏在子进程里，
 * 界面上只看到转圈。（这个坑是 verify-acp.mjs 的断言抓出来的。）
 *
 * 只展开**开头**的 `~` / `$HOME`：参数里出现在别处的 `~` 可能是有意义的字面量。
 */
export function expandArg(arg: string, home: string = homedir()): string {
  if (arg === "~" || arg.startsWith("~/") || arg.startsWith("$HOME/") || arg === "$HOME") {
    return expandHome(arg, home);
  }
  return arg;
}

/**
 * 命令行参数切分：按空白切，但尊重成对的引号。
 *
 * 不引 shell-quote 这类依赖（本仓库不擅自加包），也不走 `shell: true` ——
 * 后者会把用户偏好里的每一个字符都交给 shell 解释，路径里一个空格或 `;` 就能变味。
 * 这里够用的规则是：`"a b"` 和 `'a b'` 各自算一个参数，反斜杠转义下一个字符。
 */
export function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "\\" && quote !== "'" && i + 1 < input.length) {
      current += input[++i];
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) args.push(current);
  return args;
}

/**
 * 把偏好解析成可直接 spawn 的三元组。
 *
 * 起不来的原因要在这里讲清楚（而不是等 spawn 报一句 ENOENT）：agent 是一条链
 * （Raycast → bash → node → dsh → profile），任何一环缺失都表现为「界面一直转圈」，
 * 用户没法自己定位。
 */
export function resolveAcpLaunch(preferences: AcpLaunchPreferences, home: string = homedir()): AcpLaunch {
  const command = expandHome(preferences.command || "/bin/bash", home);
  if (!command) throw new Error("没有配置 agent 启动命令（扩展设置里的 Agent Command）。");

  const cwd = expandHome(preferences.cwd?.trim() || home, home);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`Agent 工作目录不存在：${cwd}（在扩展设置的 Agent Working Directory 里改）`);
  }

  return { command, args: splitArgs(preferences.args ?? "").map((arg) => expandArg(arg, home)), cwd };
}

/** 工作目录必须是绝对路径：ACP 规范要求 session 的 cwd 为绝对路径，相对路径会被 agent 拒绝 */
export function assertAbsoluteCwd(cwd: string): void {
  if (!isAbsolute(cwd)) throw new Error(`Agent 工作目录必须是绝对路径：${cwd}`);
}
