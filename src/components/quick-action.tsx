import { Detail, getSelectedText } from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { prefs } from "../lib/config";
import type { ChatMessage } from "../lib/deepseek";
import { dbg } from "../lib/debug";
import { ResultView } from "./result-view";

/**
 * 快捷命令的通用外壳：读选中文本 -> 组装 messages -> 交给 ResultView。
 */
export function QuickAction({
  title,
  system,
  buildUser,
}: {
  title: string;
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
        const selection = (await getSelectedText()).trim();
        dbg(`QuickAction: getSelectedText 返回 ${selection.length} 字符`);
        if (!selection) throw new Error("当前没有选中的文本。");
        setMessages([
          { role: "system", content: system },
          { role: "user", content: buildUser(selection) },
        ]);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        dbg(`QuickAction: 失败 ${message.slice(0, 200)}`);
        setError(
          message.includes("selected text")
            ? "读不到选中的文本。请先在任意 App 里选中一段文字，再触发这个命令。"
            : message,
        );
      }
    })();
  }, [system, buildUser]);

  if (error) {
    return <Detail navigationTitle={title} markdown={`### 无法开始\n\n${error}`} />;
  }

  if (!messages) {
    return <Detail isLoading navigationTitle={title} markdown="" />;
  }

  return <ResultView title={title} messages={messages} effort={prefs().quickActionEffort} />;
}
