import { useEffect, useRef, useState } from "react";
import { streamChat, type ChatMessage, type Usage } from "./deepseek";
import { dbg } from "./debug";
import type { Effort } from "./config";

export interface StreamState {
  content: string;
  reasoning: string;
  isLoading: boolean;
  error?: string;
  usage?: Usage;
}

const FLUSH_INTERVAL_MS = 80;

/**
 * 跑一次流式请求，把增量合并进 state。
 * 之所以节流，是因为每个 token 都 setState 会让 Raycast 的 Detail 疯狂重排。
 */
export function useStream(messages: ChatMessage[] | null, opts?: { effort?: Effort; temperature?: number }) {
  const [state, setState] = useState<StreamState>({
    content: "",
    reasoning: "",
    isLoading: messages !== null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const optsRef = useRef(opts);
  const messagesRef = useRef(messages);

  useEffect(() => {
    const request = messagesRef.current;
    if (!request || startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    let content = "";
    let reasoning = "";
    let lastFlush = 0;
    // 记下已经推给 state 的值，避免「内容没变但每 80ms 重渲染一次」
    let pushedContent = "\u0000";
    let pushedReasoning = "\u0000";

    const flush = (force: boolean) => {
      if (content === pushedContent && reasoning === pushedReasoning) return;
      const now = Date.now();
      if (!force && now - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = now;
      pushedContent = content;
      pushedReasoning = reasoning;
      setState((prev) => ({ ...prev, content, reasoning }));
    };

    setState({ content: "", reasoning: "", isLoading: true });
    dbg(`useStream: 开始请求，msgs=${request.length}`);

    streamChat(
      request,
      {
        onContent: (full) => {
          content = full;
          flush(false);
        },
        onReasoning: (full) => {
          reasoning = full;
          flush(false);
        },
      },
      { ...optsRef.current, signal: controller.signal },
    )
      .then((result) => {
        dbg(`useStream: 完成 content=${result.content.length} reasoning=${result.reasoning.length}`);
        setState({
          content: result.content,
          reasoning: result.reasoning,
          isLoading: false,
          usage: result.usage,
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        dbg(`useStream: 出错 ${message.slice(0, 300)}`);
        if (controller.signal.aborted) {
          setState((prev) => ({ ...prev, isLoading: false, content, reasoning }));
          return;
        }
        setState((prev) => ({ ...prev, isLoading: false, error: message, content, reasoning }));
      })
      .finally(() => {
        abortRef.current = null;
      });

    // 刻意不在 cleanup 里 abort。
    // React（StrictMode / dev 下）会跑 effect -> cleanup -> effect，
    // 若在 cleanup 里 abort，第一次请求会被立刻掐断，而 startedRef
    // 又挡住了第二次，界面就永远是空白。
    // 取消由用户显式触发的 stop() 负责。
    return undefined;
  }, []);

  return { ...state, stop: () => abortRef.current?.abort() };
}
