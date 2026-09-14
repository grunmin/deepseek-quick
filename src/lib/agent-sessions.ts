import { AcpClient } from "./acp/client";
import type { SessionInfoWire } from "./acp/types";
import { agentLaunch } from "./config";
import { dbg } from "./debug";

/**
 * History 里要展示的一条 **agent 侧会话**。
 *
 * 刻意只留台账字段：**不镜像会话内容**。正本在 agent 自己的会话存储里（`session/list` +
 * `session/load` 就是为此存在的接口，dsh web / TUI 也共用同一份），本地再存一份必然漂移 ——
 * 你在别处继续过的会话，Raycast 这边的副本不会知道。所以 History 只做「实时列举 + 一键回源」。
 *
 * 代价：打开 History 要冷启动一次 agent 查台账（实测 459 条会话时 ~3.3s），列表只有标题，
 * 全文得进 Agent 面板看。
 */
export interface AgentSessionInfo {
  sessionId: string;
  /** agent 生成的一句话标题。**只创建、没跑过内容的空会话没有标题**（实测 458 条里 117 条如此） */
  title?: string;
  /** 会话创建时的工作目录；`session/load` 要带它回去 */
  cwd?: string;
  /** 解析成毫秒；agent 给的是 ISO 串，解析不出来就当没有（不猜） */
  updatedAt?: number;
}

/**
 * 列 agent 那边的会话。
 *
 * 用完立刻 `dispose()`：这是一次性的台账查询，没有会话要保持住 —— Agent 面板自己那份
 * 进程在按 ↵ 打开会话时会重新起（约束 20：一条命令一个 agent 进程，卸载必须收掉）。
 *
 * 这次查询**不便宜**（实测 459 条会话时要 3.2s：握手 ~1s + agent 扫会话库 ~2s），所以：
 *   - **同一时刻只合并一次在途查询** —— StrictMode 会把 History 的 effect 跑两遍，
 *     不合并就是两次冷启动；
 *   - 结果**短缓存** `CACHE_TTL_MS`，让「打开 → 退出 → 再打开」不必重新起 agent。
 *     TTL 刻意很短：刚跑完的会话应该尽快出现在列表里；`force` 用来跳过缓存（刷新动作）。
 */
export async function listAgentSessions(options: { force?: boolean } = {}): Promise<AgentSessionInfo[]> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (inFlight) return inFlight;
  inFlight = queryAgentSessions()
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 15s 够盖住「打开 History → 返回 → 再打开」，又短到不至于让你看不到刚跑完的会话 */
const CACHE_TTL_MS = 15_000;
let cache: { at: number; value: AgentSessionInfo[] } | null = null;
let inFlight: Promise<AgentSessionInfo[]> | null = null;

async function queryAgentSessions(): Promise<AgentSessionInfo[]> {
  const launch = agentLaunch();
  const client = AcpClient.spawn(
    { ...launch, log: (line) => dbg(`agent/list: ${line}`) },
    { onStderr: (line) => dbg(`agent/list stderr: ${line.slice(0, 300)}`) },
  );

  try {
    await client.initialize();
    const sessions = await client.listSessions();
    dbg(`agent/list: 拿到 ${sessions.length} 条会话`);
    return sessions.map(normalizeSession).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch (err) {
    // 把 stderr 尾巴带上：agent 起不来时那是唯一的线索（和 Agent 面板同一套说法）
    const detail = client.diagnostics;
    throw new Error(`${describe(err)}${detail ? `\n\n${detail}` : ""}`);
  } finally {
    client.dispose();
  }
}

/** 线上对象 → 展示用的台账条目。字段一律当可缺席（见 acp/types.ts 的约定） */
export function normalizeSession(info: SessionInfoWire): AgentSessionInfo {
  const parsed = typeof info.updatedAt === "string" ? Date.parse(info.updatedAt) : NaN;
  const title = typeof info.title === "string" ? info.title.trim() : "";
  const cwd = typeof info.cwd === "string" ? info.cwd.trim() : "";
  return {
    sessionId: info.sessionId,
    title: title || undefined,
    cwd: cwd || undefined,
    updatedAt: Number.isFinite(parsed) ? parsed : undefined,
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
