import { Action, ActionPanel, Clipboard, Detail, Icon, openCommandPreferences, showToast } from "@raycast/api";
import { useMemo } from "react";
import { prefs, type Effort } from "../lib/config";
import type { ChatMessage } from "../lib/deepseek";
import { useStream } from "../lib/use-stream";
import { ChatView } from "./chat-view";
import { ConfigureView } from "./prompt-config-view";

/**
 * 快捷命令的通用结果页：流式渲染 + 主操作（替换/复制）+ 继续讨论。
 */
export function ResultView({
  title,
  messages,
  effort,
}: {
  title: string;
  messages: ChatMessage[];
  effort?: Effort;
}) {
  const p = prefs();
  const { content, reasoning, isLoading, error, usage, stop } = useStream(messages, { effort });

  const markdown = useMemo(() => {
    const parts: string[] = [];

    if (p.showReasoning && reasoning) {
      parts.push(`> 💭 ${reasoning.replace(/\n/g, "\n> ")}`);
    }

    if (error) {
      parts.push(`### ⚠️ 出错了\n\n\`\`\`\n${error}\n\`\`\``);
    } else if (content) {
      parts.push(content);
    } else if (isLoading) {
      parts.push("_思考中…_");
    } else {
      parts.push("_没有返回内容。_");
    }

    if (usage?.completionTokens) {
      parts.push(
        `---\n\n<sub>${usage.promptTokens ?? "?"} in / ${usage.completionTokens} out` +
          ` · reasoning ${usage.reasoningTokens ?? 0} · cache hit ${usage.cachedTokens ?? 0}</sub>`,
      );
    }

    return parts.join("\n\n");
  }, [content, reasoning, error, isLoading, usage, p.showReasoning]);

  const followUpMessages: ChatMessage[] = [...messages, { role: "assistant", content }];

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={title}
      markdown={markdown}
      actions={
        <ActionPanel>
          {/* 主操作：不显式指定 shortcut，Raycast 会自动把它绑到 ↵（⌘↵ 是保留键） */}
          <ActionPanel.Section>
            {p.outputBehavior === "replace" ? (
              <Action
                title="替换选中文本"
                icon={Icon.Clipboard}
                onAction={async () => {
                  await Clipboard.paste(content);
                  await showToast({ title: "已替换选中文本" });
                }}
              />
            ) : (
              <Action.CopyToClipboard title="复制结果" content={content} />
            )}
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.Push
              title="继续讨论"
              icon={Icon.SpeechBubble}
              shortcut={{ modifiers: ["cmd"], key: "n" }}
              target={<ChatView initialMessages={followUpMessages} title={title} />}
            />
            {p.outputBehavior === "replace" ? (
              <Action.CopyToClipboard title="复制结果" content={content} />
            ) : null}
          </ActionPanel.Section>

          <ActionPanel.Section title="配置">
            <Action
              title="配置本命令的模型 / 思考强度"
              icon={Icon.Gear}
              onAction={openCommandPreferences}
            />
            <Action.Push title="自定义 Prompt" icon={Icon.Pencil} target={<ConfigureView />} />
          </ActionPanel.Section>

          <ActionPanel.Section>
            {isLoading ? <Action title="停止生成" icon={Icon.Stop} onAction={stop} /> : null}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
