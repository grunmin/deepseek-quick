import { Action, ActionPanel, Form, Icon, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageText, streamChat, type ChatMessage } from "../lib/deepseek";
import { listConversations, saveConversation, deleteConversation, type Conversation } from "../lib/history";
import { CHAT_SYSTEM } from "../lib/prompts";
import { prefs } from "../lib/config";
import { dbg } from "../lib/debug";
import { toDataUri } from "../lib/images";
import { seekSelection } from "../lib/selection";
import { HistoryView } from "./history-view";

const FLUSH_INTERVAL_MS = 80;
const NEW_CHAT_ID = "__new__";

interface Pending {
  content: string;
  reasoning: string;
}

/**
 * 对话视图：左侧会话列表（侧边栏）+ 右侧当前会话内容 + 搜索栏输入。
 *
 * Raycast 没有真正的 sidebar，也没有能给 Detail 用的输入框，所以：
 *   - 左侧 List.Item 列   = 会话列表（点/方向键选中即切换）
 *   - 右侧 List.Item.Detail = 当前会话的完整内容（markdown，可滚动）
 *   - 搜索栏              = 消息输入框（filtering=false，一直聚焦，↵ 发送）
 */
export function ChatView({
  initialMessages,
  initialConversationId,
  title = "DeepSeek Chat",
  prefillText = "",
  prefillImages = [],
}: {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  title?: string;
  /** 进来自动填进输入框的文字（用于「和选中内容对话」） */
  prefillText?: string;
  /** 进来自动挂上的图片（data URI） */
  prefillImages?: string[];
}) {
  const p = prefs();

  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages && initialMessages.length > 0 ? initialMessages : [{ role: "system", content: CHAT_SYSTEM }],
  );
  const [draft, setDraft] = useState(prefillText);
  const [attachedImages, setAttachedImages] = useState<string[]>(prefillImages);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [currentId, setCurrentId] = useState<string | undefined>(initialConversationId);
  const currentIdRef = useRef<string | undefined>(initialConversationId);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);
  const busy = pending !== null;

  // 首次加载会话列表。必须先 loaded 才能渲染条目，
  // 否则 selectedItemId 会指向一个不存在的会话，Raycast 会把它弹回第一项。
  useEffect(() => {
    void listConversations().then((list) => {
      setConversations(list);
      setLoaded(true);
    });
  }, []);

  const switchTo = useCallback(
    (id: string) => {
      if (id === (currentIdRef.current ?? NEW_CHAT_ID)) return;
      dbg(`switchTo: ${currentIdRef.current ?? "none"} -> ${id}`);
      runTokenRef.current += 1; // 让在途请求的结果失效，避免覆盖新会话
      abortRef.current?.abort();
      abortRef.current = null;
      setDraft("");
      setError(undefined);
      setPending(null);

      if (id === NEW_CHAT_ID) {
        currentIdRef.current = undefined;
        setCurrentId(undefined);
        setMessages([{ role: "system", content: CHAT_SYSTEM }]);
        return;
      }
      const target = conversations.find((c) => c.id === id);
      if (target) {
        currentIdRef.current = target.id;
        setCurrentId(target.id);
        setMessages(target.messages);
      }
    },
    [conversations],
  );

  const run = useCallback(async (history: ChatMessage[]) => {
    const token = runTokenRef.current;
    const stale = () => token !== runTokenRef.current;

    setError(undefined);
    setPending({ content: "", reasoning: "" });

    const controller = new AbortController();
    abortRef.current = controller;

    let content = "";
    let reasoning = "";
    let lastFlush = 0;
    let pushedContent = "\u0000";
    let pushedReasoning = "\u0000";

    const flush = () => {
      if (content === pushedContent && reasoning === pushedReasoning) return;
      const now = Date.now();
      if (now - lastFlush < FLUSH_INTERVAL_MS) return;
      lastFlush = now;
      pushedContent = content;
      pushedReasoning = reasoning;
      if (!stale()) setPending({ content, reasoning });
    };

    try {
      const result = await streamChat(
        history,
        {
          onContent: (full) => {
            content = full;
            flush();
          },
          onReasoning: (full) => {
            reasoning = full;
            flush();
          },
        },
        { signal: controller.signal },
      );
      if (stale()) return;

      const complete: ChatMessage[] = [...history, { role: "assistant", content: result.content }];
      setMessages(complete);
      const id = await saveConversation(complete, currentIdRef.current);
      if (stale()) return;
      // 先把列表刷新好再切 currentId，保证左侧一定存在这个条目
      setConversations(await listConversations());
      currentIdRef.current = id;
      setCurrentId(id);
    } catch (err: unknown) {
      if (stale()) return;
      if (controller.signal.aborted) {
        setMessages(content ? [...history, { role: "assistant", content }] : history);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setMessages(history);
        await showToast({ style: Toast.Style.Failure, title: "请求失败", message });
      }
    } finally {
      if (!stale()) {
        setPending(null);
        abortRef.current = null;
      }
    }
  }, []);

  const send = useCallback(
    async (text: string, images: string[] = []) => {
      const allImages = [...attachedImages, ...images];
      const trimmed = text.trim();
      if (!trimmed && allImages.length === 0) {
        await showToast({ style: Toast.Style.Failure, title: "先输入内容" });
        return;
      }

      const content = allImages.length
        ? [
            { type: "text" as const, text: trimmed || "看看这些图片。" },
            ...allImages.map((uri) => ({ type: "image_url" as const, image_url: { url: uri } })),
          ]
        : trimmed;

      setDraft("");
      setAttachedImages([]);
      const userMessage: ChatMessage = { role: "user", content };
      const next: ChatMessage[] = [...messages, userMessage];
      setMessages(next);
      await run(next);
    },
    [attachedImages, messages, run],
  );

  /** 读一次当前选区（选中文字或 Finder 选中的图片），可以直接发送或先填进输入框 */
  const grabSelection = useCallback(
    async (mode: "fill" | "send") => {
      const sel = await seekSelection();
      if (!sel.text && sel.images.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "没读到选中内容",
          message: "先在别的 App 里选中文字，或在 Finder 里选中图片",
        });
        return;
      }
      if (mode === "send") {
        await send(sel.text, sel.images);
        return;
      }
      setDraft(sel.text);
      if (sel.images.length > 0) setAttachedImages(sel.images);
      await showToast({
        style: Toast.Style.Success,
        title: "已填入输入框",
        message: sel.images.length > 0 ? `文字 ${sel.text.length} 字 + ${sel.images.length} 张图` : `${sel.text.length} 字`,
      });
    },
    [send],
  );

  /** 从列表里删掉一条会话；如果删的正好是当前打开的，就退回新对话 */
  const removeConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      await showToast({ style: Toast.Style.Success, title: "已删除会话" });
      setConversations(await listConversations());

      if (currentIdRef.current === id) {
        // 当前正在看的就是被删的这条：连同在途请求一起作废，切回新对话
        runTokenRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        currentIdRef.current = undefined;
        setCurrentId(undefined);
        setPending(null);
        setError(undefined);
        setDraft("");
        setMessages([{ role: "system", content: CHAT_SYSTEM }]);
      }
    },
    [],
  );

  const selectedId = currentId ?? NEW_CHAT_ID;
  const transcript = transcriptMarkdown(messages, pending, error);

  const actions = (conversationId?: string) => (
    <ActionPanel>
      {/* ↵ 主操作 = 发送搜索栏里的内容 */}
      <Action title="发送" icon={Icon.ArrowRight} onAction={() => send(draft)} />

      {busy ? <Action title="停止生成" icon={Icon.Stop} onAction={() => abortRef.current?.abort()} /> : null}

      <Action.Push
        title="附加图片发送"
        icon={Icon.Image}
        shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
        target={<AttachForm draft={draft} attached={attachedImages} onSubmit={send} />}
      />

      <ActionPanel.Section>
        <Action
          title="读当前选区填入输入框"
          icon={Icon.TextSelection}
          shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
          onAction={() => grabSelection("fill")}
        />
        <Action
          title="读当前选区直接发送"
          icon={Icon.ArrowRight}
          shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
          onAction={() => grabSelection("send")}
        />
      </ActionPanel.Section>

      <ActionPanel.Section>
        <Action
          title="新对话"
          icon={Icon.Plus}
          shortcut={{ modifiers: ["cmd"], key: "n" }}
          onAction={() => switchTo(NEW_CHAT_ID)}
        />
        <Action.Push
          title="会话记录（两栏浏览）"
          icon={Icon.Clock}
          shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
          target={<HistoryView />}
        />
      </ActionPanel.Section>

      {conversationId ? (
        <ActionPanel.Section>
          <Action
            title="删除这条会话"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["cmd"], key: "x" }}
            onAction={() => removeConversation(conversationId)}
          />
        </ActionPanel.Section>
      ) : null}

      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="复制本次回复"
          content={lastAssistantText(messages)}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
        <Action.CopyToClipboard
          title="复制完整对话"
          content={transcriptPlain(messages)}
          shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );

  return (
    <List
      filtering={false}
      isLoading={busy || !loaded}
      isShowingDetail
      navigationTitle={title}
      searchText={draft}
      onSearchTextChange={setDraft}
      selectedItemId={loaded ? selectedId : undefined}
      onSelectionChange={(id) => {
        if (loaded && id && id !== selectedId) switchTo(id);
      }}
      searchBarPlaceholder={placeholder(busy, attachedImages.length)}
    >
      {loaded ? (
        <>
          <List.Item
            id={NEW_CHAT_ID}
            icon={Icon.Plus}
            title="新对话"
            subtitle="开一段新的对话"
            detail={
              <List.Item.Detail
                markdown={selectedId === NEW_CHAT_ID ? transcript : "_左侧选中的会话会显示在这里。_"}
              />
            }
            actions={actions()}
          />

          {conversations.length > 0 ? (
            <List.Section title="历史会话">
              {conversations.map((c) => (
                <List.Item
                  key={c.id}
                  id={c.id}
                  icon={Icon.SpeechBubble}
                  title={c.title}
                  subtitle={`${c.messages.filter((m) => m.role !== "system").length} 条`}
                  accessories={[{ date: new Date(c.updatedAt) }]}
                  detail={
                    <List.Item.Detail
                      markdown={c.id === selectedId ? transcript : previewMarkdown(c.messages)}
                    />
                  }
                  actions={actions(c.id)}
                />
              ))}
            </List.Section>
          ) : (
            <List.Item
              id="__empty"
              icon={Icon.Info}
              title="还没有历史会话"
              subtitle="发第一条消息就会自动保存"
              detail={<List.Item.Detail markdown={transcript} />}
              actions={actions()}
            />
          )}
        </>
      ) : null}
    </List>
  );
}

/** 只在需要发图时用（搜索栏塞不了文件） */
function AttachForm({
  draft,
  attached,
  onSubmit,
}: {
  draft: string;
  attached: string[];
  onSubmit: (text: string, images: string[]) => void;
}) {
  return (
    <Form
      navigationTitle="附加图片发送"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="发送"
            onSubmit={async (values: { text?: string; files?: string[] }) => {
              const files = values.files ?? [];
              let images: string[] = [];
              try {
                images = await Promise.all(files.map(toDataUri));
              } catch (err: unknown) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "图片读取失败",
                  message: err instanceof Error ? err.message : String(err),
                });
                return;
              }
              // send() 会把 attached 里的预挂图片一起带上
              onSubmit(values.text ?? "", images);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="text" title="消息" defaultValue={draft} autoFocus />
      <Form.FilePicker
        id="files"
        title="图片"
        info={attached.length > 0 ? `已带有 ${attached.length} 张选中图片，这里留空即可` : undefined}
        allowMultipleSelection
        canChooseDirectories={false}
      />
    </Form>
  );
}

function placeholder(busy: boolean, imageCount: number): string {
  if (busy) return "生成中…可以先打字，↵ 会先打断";
  if (imageCount > 0) return `已附 ${imageCount} 张图，输入问题后 ↵ 发送`;
  return "输入消息，按 ↵ 发送";
}

function lastAssistantText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messageText(messages[i]);
  }
  return "";
}

function transcriptPlain(messages: ChatMessage[]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "你" : "DeepSeek"}: ${messageText(m)}`)
    .join("\n\n");
}

function previewMarkdown(msgs: ChatMessage[]): string {
  const blocks: string[] = [];
  for (const message of msgs) {
    if (message.role === "system") continue;
    const text = messageText(message);
    if (!text) continue;
    blocks.push(message.role === "user" ? `**你**\n\n> ${text.replace(/\n/g, "\n> ")}` : `**DeepSeek**\n\n${text}`);
  }
  return blocks.length > 0 ? blocks.join("\n\n---\n\n") : "_这个会话还没有内容。_";
}

function transcriptMarkdown(messages: ChatMessage[], pending: Pending | null, error: string | undefined): string {
  const blocks: string[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    const text = messageText(message);
    if (!text) continue;
    if (message.role === "user") {
      blocks.push(`**你**\n\n${text.replace(/\n/g, "\n> ").replace(/^(?!>)/, "> ")}`);
    } else {
      blocks.push(`**DeepSeek**\n\n${text}`);
    }
  }

  if (pending) {
    blocks.push(`**DeepSeek**\n\n${pending.content || "…"}`);
    if (pending.reasoning) {
      blocks.push(`> 💭 ${pending.reasoning.replace(/\n/g, "\n> ")}`);
    }
  }

  if (error) blocks.push(`### ⚠️ 出错了\n\n\`\`\`\n${error}\n\`\`\``);
  if (blocks.length === 0) return "_在搜索栏输入消息，按 `↵` 发送。_";

  return blocks.join("\n\n---\n\n");
}
