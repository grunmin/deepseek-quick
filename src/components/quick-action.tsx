import { Detail, getSelectedText } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { prefs } from "../lib/config";
import type { ChatMessage } from "../lib/deepseek";
import { dbg } from "../lib/debug";
import { resolveSystemPrompt, type PromptCommand } from "../lib/prompt-config";
import { ResultView } from "./result-view";

/**
 * 快捷命令的通用外壳：读选中文本 → 解析这条命令生效的 system prompt → 组装 messages → 交给 ResultView。
 *
 * system prompt 会被 `Configure Prompts` 命令的覆盖替换（见 lib/prompt-config.ts）。
 */
export function QuickAction({
  command,
  title,
  system,
  buildUser,
}: {
  /** 命令标识，用来查这条命令的 prompt 覆盖 */
  command: PromptCommand;
  title: string;
  /** 内置 system prompt；有覆盖时以覆盖为准 */
  system: string;
  buildUser: (selection: string) => string;
}) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string>();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      try {
        const [selection, systemPrompt] = await Promise.all([
          getSelectedText(),
          resolveSystemPrompt(command, system),
        ]);
        const text = selection.trim();
        dbg(`QuickAction[${command}]: getSelectedText 返回 ${text.length} 字符`);
        if (!text) throw new Error("当前没有选中的文本。");
        setMessages([
          { role: "system", content: systemPrompt },
          { role: "user", content: buildUser(text) },
        ]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        dbg(`QuickAction[${command}]: 失败 ${message.slice(0, 200)}`);
        setError(
          message.includes("selected text")
            ? "读不到选中的文本。请先在任意 App 里选中一段文字，再触发这个命令。"
            : message,
        );
      }
    })();
  }, [command, system, buildUser]);

  if (error) {
    return <Detail navigationTitle={title} markdown={`### 无法开始\n\n${error}`} />;
  }

  if (!messages) {
    return <Detail isLoading navigationTitle={title} markdown="" />;
  }

  return <ResultView title={title} messages={messages} effort={prefs().quickActionEffort} />;
}
