import {
  Action,
  ActionPanel,
  confirmAlert,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { homedir } from "node:os";
import { AcpClient } from "../lib/acp/client";
import { agentLaunch, prefs } from "../lib/config";
import { dbg } from "../lib/debug";
import { TranscriptModel, transcriptMarkdown, type ProcessDetail, type Step, type ToolStep } from "../lib/acp/render";
import type {
  AvailableCommandWire,
  PermissionRequestWire,
  SessionConfigOptionWire,
  SessionInfoWire,
  SessionModeStateWire,
} from "../lib/acp/types";

/**
 * Agent 面板：热键唤起 → 搜索栏输入任务 → 交给一个**真正的 agent**（默认 dsh）执行。
 *
 * 它和 Chat / 快捷命令的区别只有一点，但正是最初想要的那件事：对面不是「补全 API 的模型」，
 * 而是一个会读文件、跑命令、改代码的 agent —— 工具调用在这里是**一等公民**，按时间线
 * 渲染出来，而不是藏在转圈的 loading 后面。
 *
 * 为什么走 ACP：这是编辑器（Zed 等）与 agent 之间的标准线格式，dsh / codex 都已经会说，
 * 换 agent 只要改一条启动命令（见 lib/acp/launch.ts），不用为一个新 agent 写适配层。
 *
 * UI 形态延续 ChatView 的取舍（AGENTS.md 约束 12）：`List` + `isShowingDetail`，
 * 搜索栏当输入框、右侧满宽 Markdown —— 整个 API 里没有第三个能渲染 Markdown 的地方。
 */

const FLUSH_INTERVAL_MS = 80;
/**
 * 发送时那次「归位到顶部」的短渲染要持续多久（约束 18：`Detail` 没有滚动 API，
 * 只有内容短到不需要滚动时才会被钳回 0）。
 */
const SCROLL_RESET_MS = 200;
const NEW_SESSION_ID = "__new__";
/** 会话下拉最多列这么多条 —— dsh 的会话存储是和 web / TUI 共用的，可能非常长 */
const MAX_SESSION_ITEMS = 30;

/**
 * 「过程显示」的三个档位，与 lib/acp/render.ts 的 ProcessDetail 一一对应。
 * 不写 `description`：`Action` 没有 subtitle（约束 17），摘要只能并进 title。
 */
const DETAIL_LEVELS: { value: ProcessDetail; title: string }[] = [
  { value: "concise", title: "精简：工具一行，不展开输出（默认）" },
  { value: "minimal", title: "只看结果：过程收成一行统计" },
  { value: "detailed", title: "详细：工具卡片 + 完整输出 / diff" },
];

export function AgentView() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("正在启动 agent…");
  const [draft, setDraft] = useState("");
  const [markdown, setMarkdown] = useState(() => transcriptMarkdown(new TranscriptModel(), { showReasoning: false }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sessions, setSessions] = useState<SessionInfoWire[]>([]);
  const [currentId, setCurrentId] = useState<string>();
  const [configOptions, setConfigOptions] = useState<SessionConfigOptionWire[]>([]);
  const [modes, setModes] = useState<SessionModeStateWire>();
  const [commands, setCommands] = useState<AvailableCommandWire[]>([]);
  /** 过程显示档位。偏好给默认值，⌘K 里可以只对**本次窗口**改（不写回设置） */
  const [detail, setDetail] = useState<ProcessDetail>("concise");

  const clientRef = useRef<AcpClient | null>(null);
  const modelRef = useRef(new TranscriptModel());
  const sessionRef = useRef<string | undefined>(undefined);
  /** 启动时解析出来的工作目录，切会话/开新会话都要带上它 */
  const cwdRef = useRef<string>(homedir());
  /** 审批对话框还开着时，用户按「停止」必须把它以 cancelled 回执掉，否则 agent 会一直等 */
  const pendingPermissionRef = useRef<((optionId: string | null) => void) | null>(null);
  /** 每次 startAgent / 卸载都自增：让上一轮异步流程的结果失效（StrictMode 会跑两遍 effect） */
  const lifecycleRef = useRef(0);
  const pinnedRef = useRef(false);
  const showReasoningRef = useRef(false);
  const detailRef = useRef<ProcessDetail>("concise");
  const lastFlushRef = useRef(0);
  const pushedRef = useRef("\u0000");
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    try {
      const p = prefs();
      showReasoningRef.current = p.showReasoning;
      detailRef.current = p.agentDetail;
      setDetail(p.agentDetail);
    } catch {
      showReasoningRef.current = false;
    }
  }, []);

  /** 重算 markdown 落成 state；内容没变就不 setState（约束 3：无变化重渲染会被 Raycast 警告） */
  const renderNow = useCallback(() => {
    const next = transcriptMarkdown(modelRef.current, {
      showReasoning: showReasoningRef.current,
      detail: detailRef.current,
      latestOnly: pinnedRef.current,
    });
    if (next === pushedRef.current) return;
    pushedRef.current = next;
    setMarkdown(next);
  }, []);

  /**
   * 一轮任务里几十条 update（每个工具都有 in_progress → completed 两条），每次都重建整份
   * markdown 既费 CPU，也容易触发 Raycast 的「rendering a lot without any changes」。
   */
  const scheduleFlush = useCallback(
    (immediate = false) => {
      const run = () => {
        flushTimerRef.current = null;
        lastFlushRef.current = Date.now();
        renderNow();
      };
      const since = Date.now() - lastFlushRef.current;
      if (immediate || since >= FLUSH_INTERVAL_MS) {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        run();
        return;
      }
      if (flushTimerRef.current) return;
      flushTimerRef.current = setTimeout(run, FLUSH_INTERVAL_MS - since);
    },
    [renderNow],
  );

  /** 会话级配置从模型同步到 state；这类 update 很少，不必节流 */
  const syncSessionState = useCallback(() => {
    const model = modelRef.current;
    setConfigOptions([...model.configOptions]);
    setModes(model.modes ? { ...model.modes } : undefined);
    setCommands([...model.commands]);
  }, []);

  /**
   * 切换「过程显示」档位，**只影响这次窗口**：不写设置、不碰会话。
   * 想改默认值去扩展设置里的 Agent Process Display。
   */
  const applyDetail = useCallback(
    (level: ProcessDetail) => {
      detailRef.current = level;
      setDetail(level);
      scheduleFlush(true);
    },
    [scheduleFlush],
  );

  const refreshSessions = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const list = await client.listSessions();
      setSessions(list.slice(0, MAX_SESSION_ITEMS));
    } catch (err) {
      dbg(`agent: 拉会话列表失败 ${String(err)}`);
    }
  }, []);

  /* ────────────────────────── 启动 / 退出 ────────────────────────── */

  const startAgent = useCallback(async () => {
    const token = ++lifecycleRef.current;
    const stale = () => token !== lifecycleRef.current;

    // 重启时先收掉上一份（StrictMode 下第一遍 effect 也会走到这里）
    clientRef.current?.dispose();
    clientRef.current = null;
    pendingPermissionRef.current = null;
    modelRef.current = new TranscriptModel();
    sessionRef.current = undefined;
    setReady(false);
    setError(undefined);
    setStatus("正在启动 agent…");
    setCurrentId(undefined);
    syncSessionState();
    scheduleFlush(true);

    let launch;
    try {
      launch = agentLaunch();
    } catch (err) {
      if (stale()) return;
      setError(message(err));
      setStatus("启动配置有误");
      scheduleFlush(true);
      return;
    }
    cwdRef.current = launch.cwd;
    dbg(`agent: 启动 ${launch.command} ${launch.args.join(" ")} (cwd=${launch.cwd})`);

    const client = AcpClient.spawn(
      { ...launch, log: (line) => dbg(`agent/acp: ${line}`) },
      {
        onUpdate: (update) => {
          modelRef.current.apply(update);
          // 配置 / 模式 / 命令表是低频事件，立刻同步，别等节流窗口
          const kind = update.sessionUpdate;
          if (
            kind === "config_option_update" ||
            kind === "current_mode_update" ||
            kind === "available_commands_update"
          ) {
            syncSessionState();
          }
          scheduleFlush();
        },
        onPermission: (request, respond) => {
          pendingPermissionRef.current = respond;
          void askPermission(modelRef.current, request, respond, () => {
            pendingPermissionRef.current = null;
            scheduleFlush(true);
          });
        },
        onStderr: (line) => dbg(`agent/stderr: ${line.slice(0, 300)}`),
        onExit: ({ code, signal }) => {
          // 主动 dispose 不算「异常退出」：那时 lifecycleRef 已经换了一代
          if (stale()) return;
          dbg(`agent: 子进程退出 code=${code} signal=${signal}`);
          setError(`agent 退出了（code ${code ?? signal ?? "?"}）\n\n${client.diagnostics}`.trim());
          setBusy(false);
          setStatus("agent 已退出");
          scheduleFlush(true);
        },
      },
    );
    clientRef.current = client;

    try {
      const capabilities = await client.initialize();
      if (stale()) {
        client.dispose();
        return;
      }
      dbg(`agent: 握手完成 loadSession=${Boolean(capabilities.loadSession)}`);

      const session = await client.newSession(launch.cwd);
      if (stale()) {
        client.dispose();
        return;
      }
      sessionRef.current = session.sessionId;
      setCurrentId(session.sessionId);
      if (session.modes) modelRef.current.modes = session.modes;
      if (session.configOptions) modelRef.current.configOptions = session.configOptions;
      syncSessionState();

      setReady(true);
      setStatus("");
      scheduleFlush(true);
      await refreshSessions();
    } catch (err) {
      if (stale()) return;
      const detail = message(err);
      dbg(`agent: 启动失败 ${detail}`);
      setError(`${detail}\n\n${client.diagnostics}`.trim());
      setStatus("agent 启动失败");
      scheduleFlush(true);
    }
  }, [refreshSessions, scheduleFlush, syncSessionState]);

  useEffect(() => {
    void startAgent();
    return () => {
      // 命令窗口关了就不该还留着一个 agent 进程
      lifecycleRef.current += 1;
      pendingPermissionRef.current?.(null);
      pendingPermissionRef.current = null;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [startAgent]);

  /* ────────────────────────── 发一轮 / 打断 ────────────────────────── */

  const stop = useCallback(() => {
    const sessionId = sessionRef.current;
    if (sessionId) clientRef.current?.cancel(sessionId);
    // ACP 规定：取消一轮时，所有挂起的审批都必须回执成 cancelled
    pendingPermissionRef.current?.(null);
    pendingPermissionRef.current = null;
  }, []);

  const scrollReset = useCallback(async () => {
    pinnedRef.current = true;
    renderNow();
    await new Promise((resolve) => setTimeout(resolve, SCROLL_RESET_MS));
    pinnedRef.current = false;
    renderNow();
  }, [renderNow]);

  const send = useCallback(
    async (text: string) => {
      // 一轮没跑完就再发一条会让 agent 的会话状态错乱，所以 ↵ 这时退化成「打断」
      if (busy) {
        stop();
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;

      const client = clientRef.current;
      const sessionId = sessionRef.current;
      if (!client || !sessionId) {
        await showToast({ style: Toast.Style.Failure, title: "agent 还没就绪" });
        return;
      }

      setDraft("");
      setError(undefined);
      setBusy(true);
      modelRef.current.startLocalTurn(trimmed);
      await scrollReset();

      try {
        const stopReason = await client.prompt(sessionId, trimmed);
        modelRef.current.finishTurn(stopReason);
        dbg(`agent: 一轮结束 stopReason=${stopReason}`);
      } catch (err) {
        // agent 侧的失败（进程没了 / 模型报错 / 工具抛错）留在时间线上，别只在 toast 里闪一下
        modelRef.current.finishTurn(undefined, message(err));
      } finally {
        setBusy(false);
        scheduleFlush(true);
        void refreshSessions();
      }
    },
    [busy, refreshSessions, scheduleFlush, scrollReset, stop],
  );

  /* ────────────────────────── 会话切换 ────────────────────────── */

  const switchSession = useCallback(
    async (id: string) => {
      const client = clientRef.current;
      if (!client || !ready || id === sessionRef.current) return;

      if (busy) {
        stop();
        setBusy(false);
      }

      // 换一份全新的模型：上一段对话的 markdown 不该留在新会话里
      const model = new TranscriptModel();
      modelRef.current = model;
      sessionRef.current = undefined;
      setError(undefined);
      setStatus("正在载入会话…");
      setCurrentId(id);
      syncSessionState();
      scheduleFlush(true);

      try {
        if (id === NEW_SESSION_ID) {
          const session = await client.newSession(cwdRef.current);
          sessionRef.current = session.sessionId;
          setCurrentId(session.sessionId);
          if (session.modes) model.modes = session.modes;
          if (session.configOptions) model.configOptions = session.configOptions;
        } else {
          // 载入会把历史用 session/update 重放一遍；重放期间的 user_message_chunk 才算「新的一轮」
          model.startReplay();
          const loaded = await client.loadSession(id, cwdRef.current);
          model.endReplay();
          sessionRef.current = id;
          if (loaded.modes) model.modes = loaded.modes;
          if (loaded.configOptions) model.configOptions = loaded.configOptions;
        }
        setStatus("");
        syncSessionState();
        scheduleFlush(true);
      } catch (err) {
        setStatus("");
        setError(`载入会话失败：${message(err)}`);
        scheduleFlush(true);
      }
    },
    [busy, ready, scheduleFlush, stop, syncSessionState],
  );

  /* ────────────────────────── 会话配置 ────────────────────────── */

  const applyConfigOption = useCallback(
    async (configId: string, value: string) => {
      const client = clientRef.current;
      const sessionId = sessionRef.current;
      if (!client || !sessionId) return;
      if (busy) {
        await showToast({ style: Toast.Style.Failure, title: "先等这一轮跑完（或 ↵ 打断）" });
        return;
      }
      try {
        const options = await client.setConfigOption(sessionId, configId, value);
        modelRef.current.configOptions = options;
        syncSessionState();
        const name = configOptions.find((item) => item.id === configId)?.name ?? configId;
        await showToast({ style: Toast.Style.Success, title: `${name} → ${value}` });
      } catch (err) {
        await showToast({ style: Toast.Style.Failure, title: "切换失败", message: message(err) });
      }
    },
    [busy, configOptions, syncSessionState],
  );

  const applyMode = useCallback(
    async (modeId: string) => {
      const client = clientRef.current;
      const sessionId = sessionRef.current;
      if (!client || !sessionId) return;
      if (busy) {
        await showToast({ style: Toast.Style.Failure, title: "先等这一轮跑完（或 ↵ 打断）" });
        return;
      }
      try {
        await client.setMode(sessionId, modeId);
        const current = modelRef.current.modes;
        if (current) modelRef.current.modes = { ...current, currentModeId: modeId };
        syncSessionState();
        await showToast({ style: Toast.Style.Success, title: `权限模式 → ${modeId}` });
      } catch (err) {
        await showToast({ style: Toast.Style.Failure, title: "切换模式失败", message: message(err) });
      }
    },
    [busy, syncSessionState],
  );

  /* ────────────────────────── 渲染 ────────────────────────── */

  const modelLabel = currentValue(configOptions, "model") ?? "默认模型";
  const subtitle = [status, error ? "⚠️ 出错" : "", modelLabel, modes?.currentModeId ?? ""]
    .filter(Boolean)
    .join(" · ");

  // 新建的会话在 session/list 里还没有标题，先补一条占位，免得下拉的 value 找不到对应条目
  const dropdownSessions =
    currentId && !sessions.some((session) => session.sessionId === currentId)
      ? [{ sessionId: currentId, title: "当前会话（尚未保存标题）" }, ...sessions]
      : sessions;

  return (
    <List
      filtering={false}
      isLoading={!ready || busy}
      isShowingDetail
      navigationTitle="Agent"
      searchText={draft}
      onSearchTextChange={setDraft}
      searchBarPlaceholder={placeholder(busy, ready, Boolean(error), modelLabel)}
      searchBarAccessory={
        ready ? (
          <List.Dropdown
            tooltip="切换会话"
            value={currentId ?? NEW_SESSION_ID}
            storeValue={false}
            onChange={(id) => void switchSession(id)}
          >
            <List.Dropdown.Item title="新会话" value={NEW_SESSION_ID} icon={Icon.Plus} />
            {dropdownSessions.length > 0 ? (
              <List.Dropdown.Section title="历史会话（含 dsh web / TUI 建的）">
                {dropdownSessions.map((session) => (
                  <List.Dropdown.Item
                    key={session.sessionId}
                    value={session.sessionId}
                    title={session.title?.trim() || session.sessionId.slice(0, 8)}
                    icon={Icon.SpeechBubble}
                  />
                ))}
              </List.Dropdown.Section>
            ) : null}
          </List.Dropdown>
        ) : null
      }
    >
      {/* 单锚点：List 行高固定 + nowrap，放不下时间线，整段内容只能进详情面板（约束 7 / 12） */}
      <List.Item
        id="__agent"
        title="Agent"
        subtitle={subtitle}
        detail={<List.Item.Detail markdown={markdown} />}
        actions={
          <ActionPanel>
            {/* ↵ 主操作 = 发送；跑着的时候同一个键变成「打断」 */}
            {busy ? (
              <Action title="停止生成" icon={Icon.Stop} onAction={stop} />
            ) : (
              <Action title="发送" icon={Icon.ArrowRight} onAction={() => void send(draft)} />
            )}

            <Action
              title="新会话"
              icon={Icon.Plus}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
              onAction={() => void switchSession(NEW_SESSION_ID)}
            />

            <ActionPanel.Submenu title="过程显示（本次窗口）" icon={Icon.Eye} filtering={false}>
              {DETAIL_LEVELS.map((level) => (
                <Action
                  key={level.value}
                  title={level.title}
                  icon={detail === level.value ? Icon.CheckCircle : Icon.Circle}
                  onAction={() => applyDetail(level.value)}
                />
              ))}
            </ActionPanel.Submenu>

            {configOptions.length > 0 || (modes?.availableModes?.length ?? 0) > 0 ? (
              <ActionPanel.Submenu title="会话配置（模型 / 强度 / 权限）" icon={Icon.Switch} filtering>
                {configOptions.map((option) => (
                  <ActionPanel.Section key={option.id} title={option.name}>
                    {flattenChoices(option).map((choice) => (
                      <Action
                        key={`${option.id}:${choice.value}`}
                        title={choice.name}
                        icon={option.currentValue === choice.value ? Icon.CheckCircle : Icon.Circle}
                        onAction={() => void applyConfigOption(option.id, choice.value)}
                      />
                    ))}
                    {/* 当前值不在候选里（值来自环境变量等）时也要看得见，否则像「没生效」 */}
                    {option.currentValue && !flattenChoices(option).some((c) => c.value === option.currentValue) ? (
                      <Action
                        title={`当前：${String(option.currentValue)}`}
                        icon={Icon.CheckCircle}
                        onAction={() => undefined}
                      />
                    ) : null}
                  </ActionPanel.Section>
                ))}
                {modes?.availableModes?.length ? (
                  <ActionPanel.Section title="权限模式">
                    {modes.availableModes.map((mode) => (
                      <Action
                        key={mode.id}
                        title={mode.description ? `${mode.name} — ${mode.description}` : mode.name}
                        icon={modes.currentModeId === mode.id ? Icon.CheckCircle : Icon.Circle}
                        onAction={() => void applyMode(mode.id)}
                      />
                    ))}
                  </ActionPanel.Section>
                ) : null}
              </ActionPanel.Submenu>
            ) : null}

            {commands.length > 0 ? (
              <ActionPanel.Submenu title="斜杠命令 / 技能" icon={Icon.Terminal} filtering>
                {commands.map((command) => (
                  <Action
                    key={command.name}
                    title={
                      command.description
                        ? `/${command.name} — ${command.description}`
                        : `/${command.name}`
                    }
                    onAction={() => setDraft(`/${command.name} `)}
                  />
                ))}
              </ActionPanel.Submenu>
            ) : null}

            <ActionPanel.Section>
              <Action.CopyToClipboard
                title="复制本次回复"
                content={lastAssistantText(modelRef.current)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
              />
              <Action.CopyToClipboard
                title="复制完整对话（含工具输出）"
                content={transcriptPlain(modelRef.current)}
                shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
              />
              <Action title="刷新会话列表" icon={Icon.ArrowClockwise} onAction={() => void refreshSessions()} />
            </ActionPanel.Section>

            <ActionPanel.Section title="配置">
              <Action
                title="配置 Agent 启动命令 / 工作目录"
                icon={Icon.Gear}
                onAction={openExtensionPreferences}
              />
              {error ? (
                <Action
                  title="重启 agent"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                  onAction={() => void startAgent()}
                />
              ) : null}
            </ActionPanel.Section>
          </ActionPanel>
        }
      />
    </List>
  );
}

/* ────────────────────────── 权限审批 ────────────────────────── */

/**
 * 工具审批。
 *
 * `confirmAlert` 在这里是合适的：agent 本来就在等回执，画面停在问题上是对的；
 * 换成 ActionPanel 让用户「稍后自己点」，agent 会卡在一个没有任何提示的状态。
 *
 * ⚠️ 审批请求里**只有 toolCallId**，工具名/标题必须回查我们自己的时间线 —— 否则对话框上
 * 只有一串 uuid，用户根本不知道自己在批准什么（实测踩到）。
 */
async function askPermission(
  model: TranscriptModel,
  request: PermissionRequestWire,
  respond: (optionId: string | null) => void,
  done: () => void,
): Promise<void> {
  const toolCallId = request.toolCall?.toolCallId;
  const tool: ToolStep | undefined = toolCallId ? model.toolCalls.get(toolCallId) : undefined;
  const what = tool ? `${tool.name} · ${tool.title || "(无标题)"}` : "一个工具调用";

  const allow =
    request.options.find((option) => option.kind === "allow_once") ??
    request.options.find((option) => option.kind === "allow_always") ??
    request.options[0];
  const reject =
    request.options.find((option) => option.kind === "reject_once") ??
    request.options.find((option) => option.kind === "reject_always");

  model.note(`请求权限：${what}`);

  if (!allow) {
    respond(null);
    done();
    return;
  }

  const detail = tool?.diff ? `\n\n文件：${tool.diff.path}` : "";
  const approved = await confirmAlert({
    title: "Agent 请求权限",
    message: `${what}${detail}`,
    primaryAction: { title: allow.name || "允许一次" },
    dismissAction: reject ? { title: reject.name || "拒绝" } : undefined,
  });

  model.note(approved ? `已允许：${what}` : `已拒绝：${what}`);
  respond(approved ? allow.optionId : (reject?.optionId ?? null));
  done();
}

/* ────────────────────────── 小工具 ────────────────────────── */

function placeholder(busy: boolean, ready: boolean, failed: boolean, modelLabel: string): string {
  if (failed) return "启动失败 —— ⌘K → 「重启 agent」看详情";
  if (!ready) return "正在启动 agent…";
  if (busy) return "agent 正在干活… ↵ 打断，也可以先打字";
  return `输入任务，按 ↵ 交给 agent（${modelLabel}）`;
}

function currentValue(options: SessionConfigOptionWire[], id: string): string | undefined {
  const option = options.find((item) => item.id === id);
  return typeof option?.currentValue === "string" ? option.currentValue : undefined;
}

interface Choice {
  value: string;
  name: string;
}

/** dsh 的模型目录是「按 provider 分组」的，codex 之类是平铺的，两种都得能展开 */
function flattenChoices(option: SessionConfigOptionWire): Choice[] {
  const choices: Choice[] = [];
  for (const entry of option.options ?? []) {
    if (entry && typeof entry === "object" && "options" in entry && Array.isArray(entry.options)) {
      choices.push(...entry.options.map((item) => ({ value: item.value, name: item.name })));
    } else if (entry && typeof entry === "object" && "value" in entry) {
      choices.push({ value: entry.value, name: entry.name });
    }
  }
  return choices;
}

function lastAssistantText(model: TranscriptModel): string {
  for (let i = model.turns.length - 1; i >= 0; i--) {
    const steps = model.turns[i].steps;
    for (let j = steps.length - 1; j >= 0; j--) {
      if (steps[j].kind === "message") return (steps[j] as { text: string }).text;
    }
  }
  return "";
}

function transcriptPlain(model: TranscriptModel): string {
  return model.turns
    .map((turn) => {
      const head = turn.user ? `你: ${turn.user}` : "（历史）";
      const body = turn.steps.map(stepPlain).filter(Boolean).join("\n\n");
      return [head, body].filter(Boolean).join("\n\n");
    })
    .join("\n\n---\n\n");
}

function stepPlain(step: Step): string {
  // 用 switch 而不是 if 链：`TextStep.kind` 是 "message" | "thought" 两个字面量的联合，
  // 连续两个否定式 if 并不能让 TS 完全排除它，最后一步取不到 ToolStep 的字段。
  switch (step.kind) {
    case "message":
      return step.text;
    case "thought":
      return "";
    case "note":
      return `[!] ${step.text}`;
    case "tool": {
      const parts = [`[工具] ${step.name} — ${step.title} (${step.status})`];
      if (step.diff) parts.push(`文件: ${step.diff.path}`);
      if (step.output?.trim()) parts.push(step.output.trim());
      return parts.join("\n");
    }
    default:
      return "";
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
