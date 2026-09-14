import { Action, ActionPanel, Icon, List, openExtensionPreferences, showToast, Toast } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { homedir } from "node:os";
import { listAgentSessions, type AgentSessionInfo } from "../lib/agent-sessions";
import { messageText } from "../lib/deepseek";
import { deleteConversation, readHistory, type Conversation } from "../lib/history";
import { AgentView } from "./agent-view";
import { ChatView } from "./chat-view";
import { HistoryBackupView } from "./history-backup-view";

/**
 * 两栏会话记录：左侧会话列表，右侧滚动查看内容。
 * Raycast 扩展没有真正的 sidebar，这是 List.isShowingDetail 能给到的最接近形态。
 *
 * 列表里有**两个来源**，别混：
 *
 * - **对话**：Chat 链路的记录，存在 Raycast 的 LocalStorage 里（`lib/history.ts`）。
 * - **Agent 会话**：Agent（ACP）链路的会话，**正本在 agent 自己的存储里**（dsh web / TUI 共用），
 *   这里只用 `session/list` 实时列台账，按 ↵ 时用 `session/load` 在 Agent 面板里接回去。
 *   刻意不在本地镜像内容 —— 镜像必然与 agent 侧漂移，详见 `lib/agent-sessions.ts`。
 */

/** agent 的会话库是和 dsh web / TUI 共用的，实测动辄几百条；列表只铺最近这些 */
const MAX_AGENT_ROWS = 60;
/** 项目筛选下拉里「全部」那一项的 value（cwd 不可能是这个字符串） */
const ALL_PROJECTS = "__all__";

export function HistoryView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [corrupted, setCorrupted] = useState(false);
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [agentError, setAgentError] = useState<string>();
  const [agentLoading, setAgentLoading] = useState(true);
  const [showUntitled, setShowUntitled] = useState(false);
  const [project, setProject] = useState(ALL_PROJECTS);
  const [isLoading, setLoading] = useState(true);

  const loadChat = async () => {
    const snapshot = await readHistory();
    setConversations(snapshot.conversations);
    setCorrupted(snapshot.corrupted);
    setLoading(false);
  };

  /**
   * 列 agent 会话要**冷启动一次 agent**（~1s，用完就收掉）。失败只影响这个分区，
   * 聊天历史照常显示 —— 原因摆在列表里，不做成转瞬即逝的 toast。
   */
  const loadAgentSessions = async (force = false) => {
    setAgentLoading(true);
    try {
      setAgentSessions(await listAgentSessions({ force }));
      setAgentError(undefined);
    } catch (err) {
      setAgentSessions([]);
      setAgentError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgentLoading(false);
    }
  };

  useEffect(() => {
    void loadChat();
    // 不带 force：15s 内重开 History 直接吃缓存，别再冷启动一次 agent
    void loadAgentSessions();
  }, []);

  const projects = useMemo(() => listProjects(agentSessions), [agentSessions]);

  const agentRows = useMemo(() => {
    const inProject = agentSessions.filter((s) => project === ALL_PROJECTS || s.cwd === project);
    // 只创建、没跑过内容的空会话没有标题（实测 458 条里 117 条如此），默认折叠，免得刷屏
    const visible = showUntitled ? inProject : inProject.filter((s) => s.title);
    return {
      visible: visible.slice(0, MAX_AGENT_ROWS),
      total: visible.length,
      olderCount: Math.max(0, visible.length - MAX_AGENT_ROWS),
      untitledCount: inProject.filter((s) => !s.title).length,
    };
  }, [agentSessions, project, showUntitled]);

  const nothing = conversations.length === 0 && agentSessions.length === 0 && !agentError;

  return (
    <List
      isLoading={isLoading || agentLoading}
      isShowingDetail
      searchBarPlaceholder="搜索会话…"
      navigationTitle="会话记录"
      searchBarAccessory={
        projects.length > 1 ? (
          <List.Dropdown
            tooltip="Agent 会话：按项目筛选"
            value={project}
            storeValue={false}
            onChange={setProject}
          >
            <List.Dropdown.Item
              title={`全部项目（${agentSessions.length}）`}
              value={ALL_PROJECTS}
              icon={Icon.Folder}
            />
            <List.Dropdown.Section title="按项目">
              {projects.map((item) => (
                <List.Dropdown.Item
                  key={item.cwd}
                  title={`${shortenPath(item.cwd)}（${item.count}）`}
                  value={item.cwd}
                  icon={Icon.Folder}
                />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : null
      }
    >
      {nothing && !isLoading && !agentLoading ? (
        corrupted ? (
          <List.EmptyView
            title="历史数据读取失败"
            description="原始数据已自动备份。为避免覆盖，写入已暂停 —— 请先抢救导出"
            icon={Icon.Warning}
            actions={
              <ActionPanel>
                <Action.Push
                  title="打开 Backup History"
                  icon={Icon.Upload}
                  target={<HistoryBackupView />}
                />
              </ActionPanel>
            }
          />
        ) : (
          <List.EmptyView
            title="还没有会话记录"
            description="在 Chat 里聊一次，或在 Agent 里跑一个任务，都会出现在这里"
            icon={Icon.Clock}
            actions={
              <ActionPanel>
                <Action.Push
                  title="导出 / 导入历史"
                  icon={Icon.Upload}
                  target={<HistoryBackupView />}
                />
              </ActionPanel>
            }
          />
        )
      ) : null}

      {corrupted && conversations.length > 0 ? (
        <List.Section title="警告">
          <List.Item
            id="__corrupted"
            icon={Icon.Warning}
            title="历史数据读取失败"
            subtitle="写入已暂停，避免覆盖原始数据"
            detail={
              <List.Item.Detail
                markdown={
                  "### ⚠️ 历史数据读取失败\n\n原始内容已自动备份。为避免覆盖，**当前不会写入新的历史**。\n\n请用 **Backup History** 抢救导出。"
                }
              />
            }
            actions={
              <ActionPanel>
                <Action.Push
                  title="打开 Backup History"
                  icon={Icon.Upload}
                  target={<HistoryBackupView />}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}

      {conversations.length > 0 ? (
        <List.Section title="对话" subtitle={`${conversations.length} 条`}>
          {conversations.map((conversation) => (
            <List.Item
              key={conversation.id}
              icon={Icon.SpeechBubble}
              title={conversation.title}
              subtitle={`${conversation.messages.filter((m) => m.role !== "system").length} 条`}
              accessories={[{ date: new Date(conversation.updatedAt) }]}
              detail={<List.Item.Detail markdown={previewMarkdown(conversation)} />}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="继续这条对话"
                    icon={Icon.ArrowRight}
                    target={
                      <ChatView
                        initialMessages={conversation.messages}
                        initialConversationId={conversation.id}
                        title={conversation.title}
                      />
                    }
                  />
                  <Action.CopyToClipboard
                    title="复制完整对话"
                    content={plainTranscript(conversation)}
                    shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                  />
                  <ActionPanel.Section>
                    <Action
                      title="删除"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      shortcut={{ modifiers: ["cmd"], key: "x" }}
                      onAction={async () => {
                        try {
                          await deleteConversation(conversation.id);
                          await showToast({ style: Toast.Style.Success, title: "已删除" });
                        } catch (err: unknown) {
                          await showToast({
                            style: Toast.Style.Failure,
                            title: "删除失败",
                            message: err instanceof Error ? err.message : String(err),
                          });
                        }
                        // 只重读聊天历史：agent 那边不用为一次删除再冷启动一遍
                        await loadChat();
                      }}
                    />
                  </ActionPanel.Section>

                  <ActionPanel.Section>
                    <Action.Push
                      title="导出 / 导入历史…"
                      icon={Icon.Upload}
                      target={<HistoryBackupView />}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      ) : null}

      <List.Section
        title="Agent 会话"
        subtitle={agentError ? "不可用" : `${agentRows.total} 条（来自 agent）`}
      >
        {agentError ? (
          <List.Item
            id="__agent_error"
            icon={Icon.Warning}
            title="Agent 会话列不出来"
            subtitle="agent 没起来，或启动配置有误"
            detail={
              <List.Item.Detail
                markdown={`### ⚠️ Agent 会话列不出来\n\n\`\`\`\n${agentError.replace(/```/g, "'''")}\n\`\`\`\n\n会话正本在 agent 自己的存储里，这里只做列举 —— 修好启动配置后重试即可。`}
              />
            }
            actions={
              <ActionPanel>
                <Action title="重试" icon={Icon.ArrowClockwise} onAction={() => void loadAgentSessions(true)} />
                <Action
                  title="配置 Agent 启动命令 / 工作目录"
                  icon={Icon.Gear}
                  onAction={openExtensionPreferences}
                />
              </ActionPanel>
            }
          />
        ) : null}

        {!agentError && !agentLoading && agentSessions.length === 0 ? (
          <List.Item
            id="__agent_empty"
            icon={Icon.Terminal}
            title="agent 那边还没有会话"
            subtitle="在 Agent 命令里跑一个任务就会出现"
            detail={
              <List.Item.Detail markdown={"### 🛠 还没有 Agent 会话\n\n用 **Agent** 命令跑一个任务，会话会存在 agent 自己的存储里（dsh web / TUI 建的会话也会出现在这里）。"} />
            }
            actions={
              <ActionPanel>
                <Action.Push title="打开 Agent" icon={Icon.ArrowRight} target={<AgentView />} />
              </ActionPanel>
            }
          />
        ) : null}

        {agentRows.visible.map((session) => (
          <List.Item
            key={session.sessionId}
            icon={session.title ? Icon.Terminal : Icon.CircleDisabled}
            title={session.title || `未命名会话 ${session.sessionId.slice(0, 8)}`}
            subtitle={session.cwd ? shortenPath(session.cwd) : undefined}
            keywords={[session.sessionId, session.cwd ?? ""].filter(Boolean)}
            accessories={[
              { text: session.sessionId.slice(0, 8) },
              ...(session.updatedAt ? [{ date: new Date(session.updatedAt) }] : []),
            ]}
            detail={<List.Item.Detail markdown={agentSessionMarkdown(session)} />}
            actions={
              <ActionPanel>
                <Action.Push
                  title="在 Agent 里打开"
                  icon={Icon.ArrowRight}
                  target={
                    <AgentView initialSessionId={session.sessionId} initialCwd={session.cwd} />
                  }
                />
                <Action.CopyToClipboard
                  title="复制会话 ID"
                  content={session.sessionId}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                />
                <ActionPanel.Section>
                  <Action.Push title="新建 Agent 会话" icon={Icon.Plus} target={<AgentView />} />
                  <Action
                    title="刷新 Agent 会话列表"
                    icon={Icon.ArrowClockwise}
                    onAction={() => void loadAgentSessions(true)}
                  />
                  <Action
                    title="配置 Agent 启动命令 / 工作目录"
                    icon={Icon.Gear}
                    onAction={openExtensionPreferences}
                  />
                </ActionPanel.Section>
                <ActionPanel.Section>
                  <Action.Push
                    title="导出 / 导入历史…"
                    icon={Icon.Upload}
                    target={<HistoryBackupView />}
                  />
                </ActionPanel.Section>
              </ActionPanel>
            }
          />
        ))}

        {agentRows.untitledCount > 0 && !showUntitled ? (
          <List.Item
            id="__agent_untitled"
            icon={Icon.Info}
            title={`还有 ${agentRows.untitledCount} 条未命名会话`}
            subtitle="多数是只创建、没跑过内容的空会话"
            detail={
              <List.Item.Detail
                markdown={`### ${agentRows.untitledCount} 条未命名会话\n\nagent 会给跑过内容的会话生成标题；没有标题的通常是**只创建、没发出过消息**的空会话（每次打开 Agent 面板都会建一个）。\n\n按 \`↵\` 把它们也列出来。`}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="也显示未命名会话"
                  icon={Icon.Eye}
                  onAction={() => setShowUntitled(true)}
                />
              </ActionPanel>
            }
          />
        ) : null}

        {showUntitled ? (
          <List.Item
            id="__agent_untitled_off"
            icon={Icon.Info}
            title="正在显示全部会话（含未命名）"
            detail={
              <List.Item.Detail markdown={"_当前会把没有标题的空会话也列出来。_"} />
            }
            actions={
              <ActionPanel>
                <Action
                  title="只看有内容的会话"
                  icon={Icon.EyeDisabled}
                  onAction={() => setShowUntitled(false)}
                />
              </ActionPanel>
            }
          />
        ) : null}

        {agentRows.olderCount > 0 ? (
          <List.Item
            id="__agent_older"
            icon={Icon.Info}
            title={`还有 ${agentRows.olderCount} 条更早的会话没显示`}
            subtitle={`一次最多铺 ${MAX_AGENT_ROWS} 条`}
            detail={
              <List.Item.Detail
                markdown={`### 还有 ${agentRows.olderCount} 条更早的会话\n\n这个列表一次最多铺 **${MAX_AGENT_ROWS}** 条（agent 的会话库是和 dsh web / TUI 共用的，可能很长）。\n\n用搜索栏按标题找，或换上面的**项目**筛选把它缩小。`}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="刷新 Agent 会话列表"
                  icon={Icon.ArrowClockwise}
                  onAction={() => void loadAgentSessions(true)}
                />
              </ActionPanel>
            }
          />
        ) : null}
      </List.Section>
    </List>
  );
}

/* ────────────────────────── Agent 会话 ────────────────────────── */

interface ProjectGroup {
  cwd: string;
  count: number;
}

/** 按工作目录归类，条数多的排前面 —— 458 条会话里找自己那个项目，比翻列表快 */
function listProjects(sessions: AgentSessionInfo[]): ProjectGroup[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (!session.cwd) continue;
    counts.set(session.cwd, (counts.get(session.cwd) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cwd, count]) => ({ cwd, count }))
    .sort((a, b) => b.count - a.count || a.cwd.localeCompare(b.cwd));
}

function agentSessionMarkdown(session: AgentSessionInfo): string {
  const lines = [
    `### ${session.title ?? "未命名会话"}`,
    "",
    `- 会话 ID：\`${session.sessionId}\``,
    `- 工作目录：${session.cwd ? `\`${session.cwd}\`` : "_agent 没报_"}`,
    session.updatedAt ? `- 最后活动：${new Date(session.updatedAt).toLocaleString()}` : "",
    "",
    "按 `↵` 在 **Agent** 面板里打开，agent 会用 `session/load` 把历史重放出来，接着聊就行。",
    "",
    "_内容存在 agent 自己的会话存储里（dsh web / TUI 共用同一份）——这边只列台账，不复制内容，所以永远是最新的。_",
  ];
  return lines.filter(Boolean).join("\n");
}

function shortenPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/* ────────────────────────── 对话 ────────────────────────── */

function plainTranscript(conversation: Conversation): string {
  return conversation.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "你" : "DeepSeek"}: ${messageText(m)}`)
    .join("\n\n");
}

function previewMarkdown(conversation: Conversation): string {
  const blocks: string[] = [];

  for (const message of conversation.messages) {
    if (message.role === "system") continue;
    const text = messageText(message);
    if (!text) continue;
    if (message.role === "user") {
      blocks.push(`**你**\n\n${text.replace(/\n/g, "\n> ").replace(/^(?!>)/, "> ")}`);
    } else {
      blocks.push(`**DeepSeek**\n\n${text}`);
    }
  }

  if (blocks.length === 0) return "_这条会话没有可显示的内容。_";
  return blocks.join("\n\n---\n\n");
}
