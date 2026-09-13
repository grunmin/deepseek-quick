import { apiKey, prefs, type Effort } from "./config";
import { dbg } from "./debug";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  usage: Usage;
}

export interface StreamHandlers {
  onContent?: (full: string) => void;
  onReasoning?: (full: string) => void;
}

export interface StreamOptions {
  model?: string;
  effort?: Effort;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

function buildBody(messages: ChatMessage[], opts: StreamOptions): Record<string, unknown> {
  const p = prefs();
  const effort = opts.effort ?? p.reasoningEffort;

  const body: Record<string, unknown> = {
    model: opts.model ?? p.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  // DeepSeek：reasoning_effort 取 low / high / max（默认 high，medium 会被映射成 high）。
  // 想彻底关掉思考要用 thinking.disabled，而不是 reasoning_effort: "none"。
  if (effort === "none") {
    body.thinking = { type: "disabled" };
  } else {
    body.reasoning_effort = effort;
  }

  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

  return body;
}

export async function streamChat(
  messages: ChatMessage[],
  handlers: StreamHandlers = {},
  opts: StreamOptions = {},
): Promise<StreamResult> {
  const p = prefs();
  const url = `${p.apiEndpoint}/chat/completions`;
  dbg(`--> POST ${url} model=${opts.model ?? p.model} effort=${opts.effort ?? p.reasoningEffort} msgs=${messages.length}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(buildBody(messages, opts)),
    signal: opts.signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    dbg(`<-- HTTP ${res.status} ${detail.slice(0, 300)}`);
    throw new Error(`请求失败 HTTP ${res.status}${detail ? `：${detail.slice(0, 400)}` : ""}`);
  }
  if (!res.body) {
    throw new Error("响应没有 body，无法流式读取。");
  }

  let content = "";
  let reasoning = "";
  let usage: Usage = {};

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let chunk: DeepSeekChunk;
      try {
        chunk = JSON.parse(payload) as DeepSeekChunk;
      } catch {
        continue;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (delta?.reasoning_content) {
        reasoning += delta.reasoning_content;
        handlers.onReasoning?.(reasoning);
      }
      if (delta?.content) {
        content += delta.content;
        handlers.onContent?.(content);
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
        };
      }
    }
  }

  dbg(`<-- OK content=${content.length} reasoning=${reasoning.length} usage=${JSON.stringify(usage)}`);
  return { content, reasoning, usage };
}

interface DeepSeekChunk {
  choices?: {
    delta?: { content?: string; reasoning_content?: string };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** 把文本消息的纯文本内容取出来（用于历史标题、复制等） */
export function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : "[图片]"))
    .join(" ")
    .trim();
}

export function imagePart(dataUri: string): ContentPart {
  return { type: "image_url", image_url: { url: dataUri } };
}

export function textPart(text: string): ContentPart {
  return { type: "text", text };
}
