import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  AgentCapabilitiesWire,
  PermissionRequestWire,
  SessionConfigOptionWire,
  SessionInfoWire,
  SessionModeStateWire,
  SessionUpdateWire,
  StopReason,
} from "./types";

/**
 * ACP 客户端：stdio 上的 NDJSON + JSON-RPC 2.0。
 *
 * 刻意不引 `@agentclientprotocol/sdk`：
 *   - 协议本身就只有「一行一个 JSON」这一条约定（SDK 里就是 `LineBuffer` 按 `\n` 切），
 *     没有 Content-Length 头之类的额外分帧；
 *   - 本仓库的约定是不擅自加依赖，手写这 200 行比多一个包更可控；
 *   - 这个文件**只依赖 node 内置模块**，不碰 `@raycast/api` —— 于是它能被
 *     `scripts/verify-acp.mjs` 直接编译执行，对着真的 dsh 跑端到端验证，
 *     不用开 Raycast 手工点。
 *
 * 生命周期：一条命令 = 一个 agent 子进程。命令窗口关掉（组件卸载）就 dispose，
 * 会话本身活在 agent 那边的会话存储里，下次用 `session/list` + `session/load` 接回来。
 */

const DEFAULT_TIMEOUT_MS = 60_000;
/** 握手最慢也就几秒；给 30s 是为了让「agent 起不来」这件事尽早报出来 */
const INIT_TIMEOUT_MS = 30_000;
/** 出错时带回给用户的 stderr 尾巴（长这样：codex 的 config 解析错误、node 找不到 …） */
const STDERR_TAIL_LINES = 30;

export interface AcpSpawnOptions {
  /** 可执行文件；启动脚本本身可执行时也可以直接给脚本路径 */
  command: string;
  args?: string[];
  /** 子进程的工作目录（同时用作 session 的 cwd） */
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** 线上收发的摘要日志，接 `lib/debug.ts` 的 dbg */
  log?: (message: string) => void;
}

export interface AcpHandlers {
  /** 每个 session/update 都走这里，含流式文本、工具卡片、用量 */
  onUpdate?: (update: SessionUpdateWire) => void;
  /**
   * 审批请求。**必须**调用 `respond`：给 optionId 表示选中某个选项，给 `null` 表示
   * 「已取消」（ACP 规定 cancel 时所有挂起的审批都要用它回执，否则 agent 会一直等）。
   */
  onPermission?: (request: PermissionRequestWire, respond: (optionId: string | null) => void) => void;
  onStderr?: (line: string) => void;
  /** 子进程退出（含异常退出）。正常 dispose 也会触发，调用方自行用 disposed 判断 */
  onExit?: (info: { code: number | null; signal: string | null; error?: string }) => void;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/** agent 主动发过来的请求（需要客户端回执）；认不出的一律回 JSON-RPC 错误，别让它一直挂着 */
interface IncomingRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export class AcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly handlers: AcpHandlers;
  private readonly log: (message: string) => void;
  private readonly stderrTail: string[] = [];
  private readonly pending = new Map<number, PendingRequest>();

  private nextId = 1;
  private exited = false;
  /** 退出原因（stderr 尾巴或 spawn 错误），用来把「agent 起不来」讲清楚 */
  private exitReason = "";

  private constructor(options: AcpSpawnOptions, handlers: AcpHandlers) {
    this.handlers = handlers;
    this.log = options.log ?? (() => undefined);

    this.child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;

    // spawn 失败（命令不存在等）走 error 事件，不抛异常 —— 不接住就是 unhandled error
    this.child.on("error", (err) => {
      this.exitReason = String(err);
      this.failAll(`无法启动 ACP agent：${this.exitReason}`);
      this.notifyExit(null, null, this.exitReason);
    });

    this.child.on("exit", (code, signal) => {
      this.notifyExit(code, signal);
    });

    const out = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    out.on("line", (line) => this.handleLine(line));

    const err = createInterface({ input: this.child.stderr, crlfDelay: Infinity });
    err.on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
      this.handlers.onStderr?.(line);
    });
  }

  static spawn(options: AcpSpawnOptions, handlers: AcpHandlers = {}): AcpClient {
    return new AcpClient(options, handlers);
  }

  get alive(): boolean {
    return !this.exited && this.child.exitCode === null;
  }

  /** 子进程的 stderr 尾巴，用于错误提示（agent 起不来时这是唯一的线索） */
  get diagnostics(): string {
    return this.exitReason || this.stderrTail.join("\n");
  }

  /* ────────────────────────── 握手与会话 ────────────────────────── */

  /**
   * 客户端能力里 `fs` / `terminal` 一律声明为 false。
   *
   * 这不是偷懒：声明 true 意味着 agent 会把读写文件和跑命令**代理给客户端**（Zed 就是这么
   * 把编辑塞进自己的 diff 视图、把命令塞进自己的终端的）。我们这个面板不提供这些，
   * 让 agent 用它自己的工具闭环反而更简单，也少一层权限语义。
   */
  async initialize(): Promise<AgentCapabilitiesWire> {
    const result = (await this.request(
      "initialize",
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      },
      INIT_TIMEOUT_MS,
    )) as { agentCapabilities?: AgentCapabilitiesWire };
    return result.agentCapabilities ?? {};
  }

  async newSession(cwd: string): Promise<{
    sessionId: string;
    modes?: SessionModeStateWire;
    configOptions?: SessionConfigOptionWire[];
  }> {
    const result = (await this.request("session/new", { cwd, mcpServers: [] })) as {
      sessionId: string;
      modes?: SessionModeStateWire;
      configOptions?: SessionConfigOptionWire[];
    };
    return result;
  }

  /**
   * 载入既有会话。agent 会把历史通过 `session/update` **重放**一遍，
   * 所以调用方必须先把渲染层的「重放模式」打开（见 `render.ts` 的 user_message_chunk 处理）。
   */
  async loadSession(
    sessionId: string,
    cwd: string,
  ): Promise<{ modes?: SessionModeStateWire; configOptions?: SessionConfigOptionWire[] }> {
    const result = (await this.request("session/load", { sessionId, cwd, mcpServers: [] })) as {
      modes?: SessionModeStateWire;
      configOptions?: SessionConfigOptionWire[];
    };
    return result ?? {};
  }

  async listSessions(): Promise<SessionInfoWire[]> {
    const result = (await this.request("session/list", {})) as { sessions?: SessionInfoWire[] };
    return result?.sessions ?? [];
  }

  /* ────────────────────────── 一轮对话 ────────────────────────── */

  /** 发一轮。**不设超时**：agent 跑工具可能好几分钟，超时会把正常的长任务误杀 */
  async prompt(sessionId: string, text: string): Promise<StopReason> {
    const result = (await this.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text }] },
      undefined,
    )) as { stopReason?: StopReason };
    return result?.stopReason ?? "end_turn";
  }

  /** 取消在途的一轮。是通知（不等回执），prompt 那个请求会以 stopReason=cancelled 返回 */
  cancel(sessionId: string): void {
    this.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }

  /** 换模型 / 推理强度 / 权限预设 / agent 预设，都走这一个方法；返回更新后的全部选项 */
  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<SessionConfigOptionWire[]> {
    const result = (await this.request("session/set_config_option", { sessionId, configId, value })) as {
      configOptions?: SessionConfigOptionWire[];
    };
    return result?.configOptions ?? [];
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.request("session/set_mode", { sessionId, modeId });
  }

  dispose(): void {
    if (this.exited) return;
    this.exited = true;
    // 先温柔后强硬：脚本里是 `exec dsh ...`，SIGTERM 会直接落到 dsh 上
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* 进程可能已经没了 */
    }
    const child = this.child;
    const hardKill = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* 同上 */
      }
    }, 2000);
    // 别让这个定时器把 Node 事件循环吊住（Raycast 关窗后进程要能退干净）
    hardKill.unref?.();
    this.failAll("ACP agent 已关闭");
  }

  /* ────────────────────────── 传送层 ────────────────────────── */

  private send(message: unknown): void {
    if (this.exited) return;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (err) {
      this.log(`acp: 写入失败 ${String(err)}`);
    }
  }

  private request(method: string, params: unknown, timeoutMs: number | undefined = DEFAULT_TIMEOUT_MS) {
    const id = this.nextId++;
    this.log(`acp: -> ${method} #${id}`);
    return new Promise<unknown>((resolve, reject) => {
      if (this.exited) {
        reject(new Error(`ACP agent 已退出，无法发送 ${method}`));
        return;
      }
      const entry: PendingRequest = { method, resolve, reject };
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method} 超时（${timeoutMs / 1000}s）`));
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // 不认识的噪音（agent 往 stdout 打了非协议内容）不能拖垮整条连接，记一笔就行
      this.log(`acp: 非 JSON 行 ${trimmed.slice(0, 200)}`);
      return;
    }

    const id = message.id;

    // 回执
    if (id !== undefined && id !== null && ("result" in message || "error" in message)) {
      const entry = this.pending.get(Number(id));
      if (!entry) return;
      this.pending.delete(Number(id));
      if (entry.timer) clearTimeout(entry.timer);
      if ("error" in message) {
        const error = message.error as { message?: string; code?: number } | undefined;
        entry.reject(new Error(`${entry.method} 失败：${error?.message ?? JSON.stringify(message.error)}`));
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    const method = message.method as string | undefined;
    if (!method) return;

    // agent 主动发来的通知
    if (id === undefined || id === null) {
      if (method === "session/update") {
        const update = (message.params as { update?: SessionUpdateWire } | undefined)?.update;
        if (update) this.handlers.onUpdate?.(update);
      }
      return;
    }

    // agent 主动发来的请求
    this.handleIncoming(message as unknown as IncomingRequest);
  }

  private handleIncoming(request: IncomingRequest): void {
    const params = request.params as Record<string, unknown> | undefined;

    if (request.method === "session/request_permission") {
      const permission = params as unknown as PermissionRequestWire;
      const respond = (optionId: string | null) => {
        this.send({
          jsonrpc: "2.0",
          id: request.id,
          result: optionId
            ? { outcome: { outcome: "selected", optionId } }
            : { outcome: { outcome: "cancelled" } },
        });
      };
      if (this.handlers.onPermission) {
        this.handlers.onPermission(permission, respond);
      } else {
        respond(null);
      }
      return;
    }

    // elicitation（agent 反问用户）本客户端没有声明能力，正常不会被调到；
    // 真收到就明确 decline，别让 agent 干等。
    if (request.method === "elicitation/create") {
      this.send({ jsonrpc: "2.0", id: request.id, result: { action: "decline" } });
      return;
    }

    this.log(`acp: 不支持 agent 请求 ${request.method}，回 error`);
    this.send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: `client does not support ${request.method}` },
    });
  }

  private failAll(reason: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.timer) clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.reject(new Error(reason));
    }
  }

  private notifyExit(code: number | null, signal: string | null, error?: string): void {
    if (this.exited) return;
    this.exited = true;
    if (!this.exitReason) {
      this.exitReason = this.stderrTail.join("\n") || `退出码 ${code ?? "?"}${signal ? ` (${signal})` : ""}`;
    }
    this.failAll(`ACP agent 已退出：${this.exitReason}`);
    this.handlers.onExit?.({ code, signal, error });
  }
}
