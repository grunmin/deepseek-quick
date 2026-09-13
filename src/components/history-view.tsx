import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { messageText } from "../lib/deepseek";
import { deleteConversation, listConversations, type Conversation } from "../lib/history";
import { ChatView } from "./chat-view";

/**
 * 两栏会话记录：左侧会话列表，右侧滚动查看该会话的完整内容。
 * Raycast 扩展没有真正的 sidebar，这是 List.isShowingDetail 能给到的最接近形态。
 */
export function HistoryView() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setLoading] = useState(true);

  const refresh = async () => {
    setConversations(await listConversations());
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="搜索历史对话…"
      navigationTitle="会话记录"
    >
      {conversations.length === 0 && !isLoading ? (
        <List.EmptyView
          title="还没有历史对话"
          description="在 Chat 里聊一次就会出现在这里"
          icon={Icon.Clock}
        />
      ) : null}

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
              <Action
                title="删除"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["cmd"], key: "x" }}
                onAction={async () => {
                  await deleteConversation(conversation.id);
                  await showToast({ style: Toast.Style.Success, title: "已删除" });
                  await refresh();
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

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
