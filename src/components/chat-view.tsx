import {
  Action,
  ActionPanel,
  Form,
  Icon,
  List,
  openCommandPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { imagePart, messageText, streamChat, type ChatMessage, type ContentPart } from "../lib/deepseek";
import { listConversations, readHistory, saveConversation, type Conversation } from "../lib/history";
import { CHAT_SYSTEM } from "../lib/prompts";
import { dbg } from "../lib/debug";
import { toDataUri } from "../lib/images";
import {
  listSwitchablePresets,
  resolveActivePreset,
  setActivePresetId,
  type ResolvedChatPreset,
  type SwitchablePreset,
} from "../lib/presets";
import { HistoryView } from "./history-view";
import { ChatPresetsView } from "./chat-presets-view";
import { ConfigureView } from "./prompt-config-view";

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
  reference = "",
  referenceImages = [],
}: {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  title?: string;
  /**
   * 参考内容：不作为 prompt，而是作为「背景资料」挂在对话开头。
   * 展示在右侧详情面板里，用户随后在搜索栏输入自己的问题。
   */
  reference?: string;
  /** 参考图片（data URI），随参考内容一起作为背景资料 */
  referenceImages?: string[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages && initialMessages.length > 0 ? initialMessages : [{ role: "system", content: CHAT_SYSTEM }],
  );
  const [draft, setDraft] = useState("");
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  // 参考内容独立于输入框：搜出栏只放用户的问题，参考内容只显示在详情面板。
  const [referenceBlock, setReferenceBlock] = useState<ReferenceBlock | null>(() =>
    reference.trim() || referenceImages.length > 0 ? makeReferenceBlock(reference, referenceImages) : null,
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string>();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** 历史数据损坏时为 true：此时禁止写入，并在界面上明确提示 */
  const [historyCorrupted, setHistoryCorrupted] = useState(false);
  /** 「回答已生成、但写历史失败」的提示。和「请求失败」是两码事，不能混 */
  const [saveError, setSaveError] = useState<string>();
  /** 当前生效的 Chat 预设（内置「默认」或某个自定义预设） */
  const [preset, setPreset] = useState<ResolvedChatPreset | null>(null);
  /** 切换 Preset 的候选：内置 + 自定义（走 listSwitchablePresets，别只取自定义的） */
  const [switcher, setSwitcher] = useState<{ builtins: SwitchablePreset[]; custom: SwitchablePreset[] }>({
    builtins: [],
    custom: [],
  });

  /**
   * `run()` 是 `useCallback([], ...)`，闭包里的 `preset` 会永远停在首次渲染的 `null`。
   * 用 ref 拿最新值 —— 否则「切换预设后发的第一条消息」仍然会用旧配置。
   */
  const presetRef = useRef<ResolvedChatPreset | null>(null);
  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  /** 当前对话用的 system prompt（预设解析不了时兜底内置） */
  const systemPrompt = preset?.systemPrompt ?? CHAT_SYSTEM;

  const [currentId, setCurrentId] = useState<string | undefined>(initialConversationId);
  const currentIdRef = useRef<string | undefined>(initialConversationId);
  useEffect(() => {
    currentIdRef.current = currentId;
  }, [currentId]);

  const abortRef = useRef<AbortController | null>(null);
  const runTokenRef = useRef(0);
  const busy = pending !== null;

  // 首次加载会话列表 + 当前生效的 Chat 预设 + 预设列表。
  // 必须先 loaded 才能渲染条目，否则下拉和锚点会先落到空数据上，视觉上跳一下。
  useEffect(() => {
    void (async () => {
      const [history, resolved, presets] = await Promise.all([
        readHistory(),
        resolveActivePreset(),
        listSwitchablePresets(),
      ]);
      setConversations(history.conversations);
      setHistoryCorrupted(history.corrupted);
      presetRef.current = resolved;
      setPreset(resolved);
      setSwitcher(presets);
      // 没有从外部带进来的对话（新开一段）时，用当前预设的 prompt 当 system
      if (!initialMessages || initialMessages.length === 0) {
        setMessages([{ role: "system", content: resolved.systemPrompt }]);
      }
      setLoaded(true);
    })();
  }, []);

  /**
   * 强制开一段全新对话。
   *
   * 刻意不做「已经在新对话里就跳过」的守卫：⌘N 的语义是「给我一段干净的」，
   * 即使当前就在新对话状态（比如刚挂上参考内容、或想清空重来）也应该重置。
   * 之前复用了 switchTo 的去重守卫，导致在「新对话」状态下按 ⌘N 直接 return，
   * 表现就是「发起新对话无效」。
   */
  /** 作废在途请求 + 清掉所有临时状态，切会话/开新对话共用 */
  const resetTransient = useCallback(() => {
    runTokenRef.current += 1; // 让在途请求的结果失效，避免覆盖新会话
    abortRef.current?.abort();
    abortRef.current = null;
    setDraft("");
    setError(undefined);
    setPending(null);
    setReferenceBlock(null);
    setSaveError(undefined);
  }, []);

  const startNewChat = useCallback(() => {
    dbg("startNewChat: 重置为全新对话");
    resetTransient();
    currentIdRef.current = undefined;
    setCurrentId(undefined);
    setMessages([{ role: "system", content: systemPrompt }]);
  }, [resetTransient, systemPrompt]);

  /** 预设管理界面改过东西后，刷新 Submenu 里的列表 */
  const reloadPresets = useCallback(async () => {
    setSwitcher(await listSwitchablePresets());
  }, []);

  /**
   * 切换预设：写到 LocalStorage，并同步更新当前对话的 system 消息。
   *
   * 注意这里要用 `resolveActivePreset()` 重新解析 —— 它会调 `prefs()`，
   * 而 `prefs()` 是**命令作用域**的，在 chat 里才会带上 chat 的 modelOverride / effortOverride。
   */
  const switchPreset = useCallback(async (id: string) => {
    await setActivePresetId(id);
    const resolved = await resolveActivePreset();
    presetRef.current = resolved;
    setPreset(resolved);
    setMessages((prev) => withSystemPrompt(prev, resolved.systemPrompt));
    await showToast({
      style: Toast.Style.Success,
      title: `已切换到「${resolved.name}」`,
      message: `${resolved.model} · reasoning ${resolved.effort}`,
    });
  }, []);

  /** 下拉里选中某条会话。开新对话请走 startNewChat，别复用这里的去重守卫 */
  const switchTo = useCallback(
    (id: string) => {
      if (id === (currentIdRef.current ?? NEW_CHAT_ID)) return;
      dbg(`switchTo: ${currentIdRef.current ?? "none"} -> ${id}`);

      if (id === NEW_CHAT_ID) {
        startNewChat();
        return;
      }

      resetTransient();
      const target = conversations.find((c) => c.id === id);
      if (target) {
        currentIdRef.current = target.id;
        setCurrentId(target.id);
        setMessages(target.messages);
        dbg(`switchTo: 载入会话 ${target.id} 消息数=${target.messages.length}`);
      } else {
        dbg(`switchTo: 找不到会话 ${id}（conversations=${conversations.length}）`);
      }
    },
    [conversations, resetTransient, startNewChat],
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

    // 发送时用**当前预设**的 system 覆盖掉历史里的那条 —— 中途切预设才能立刻生效。
    // model / effort 里"跟随"的项已经在 resolveActivePreset() 里回落好了。
    const active = presetRef.current;
    const outgoing = withSystemPrompt(history, active?.systemPrompt ?? CHAT_SYSTEM);

    try {
      const result = await streamChat(
        outgoing,
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
        {
          signal: controller.signal,
          model: active?.model,
          effort: active?.effort,
        },
      );
      if (stale()) return;

      const complete: ChatMessage[] = [...history, { role: "assistant", content: result.content }];
      setMessages(complete);

      // 保存历史**单独** try/catch：写盘失败不该被当成「请求失败」，
      // 更不该把已经拿到的回答回退掉（旧版就会那样）。
      try {
        const id = await saveConversation(complete, currentIdRef.current);
        if (stale()) return;
        // 先把列表刷新好再切 currentId，保证左侧一定存在这个条目
        setConversations(await listConversations());
        currentIdRef.current = id;
        setCurrentId(id);
        setSaveError(undefined);
        setHistoryCorrupted(false);
      } catch (saveErr: unknown) {
        if (stale()) return;
        const message = saveErr instanceof Error ? saveErr.message : String(saveErr);
        dbg(`run: 保存历史失败 ${message.slice(0, 300)}`);
        setSaveError(message);
        await showToast({ style: Toast.Style.Failure, title: "回答已生成，但没能存进历史", message });
      }
    } catch (err: unknown) {
      // 走到这里只剩「请求本身」的错误
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

      // 参考内容不是 prompt 本身：包成「背景资料 + 我的问题」再发出去。
      // 只在首条带上（它已经进了对话历史，后续轮次不用重复塞）。
      const withReference = referenceBlock
        ? [{ role: "user" as const, content: wrapReference(referenceBlock) }, { role: "user" as const, content }]
        : [{ role: "user" as const, content }];

      setDraft("");
      setAttachedImages([]);
      setReferenceBlock(null);
      const next: ChatMessage[] = [...messages, ...withReference];
      setMessages(next);
      await run(next);
    },
    [attachedImages, messages, referenceBlock, run],
  );

  /** 不想提问、只想让模型看/分析参考内容时，直接把它发出去 */
  const sendReference = useCallback(async () => {
    if (!referenceBlock) return;
    const wrapped = wrapReference(referenceBlock);
    setDraft("");
    setReferenceBlock(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: wrapped }];
    setMessages(next);
    await run(next);
  }, [messages, referenceBlock, run]);

  const transcript = [
    historyCorrupted ? CORRUPTED_NOTICE : "",
    transcriptMarkdown(messages, pending, error, referenceBlock),
    saveError ? saveFailureNotice(saveError) : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const actions = () => (
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

      {/* 预设切换走 Submenu（搜索栏那个位置只能放一个 Dropdown，已经被会话占用） */}
      <ActionPanel.Submenu title={`切换 Preset（${preset?.name ?? "默认"}）`} icon={Icon.Switch}>
        <ActionPanel.Section title="内置">
          {switcher.builtins.map((item) => (
            <Action
              key={item.id}
              title={item.name}
              icon={preset?.id === item.id ? Icon.CheckCircle : Icon.Circle}
              onAction={() => switchPreset(item.id)}
            />
          ))}
        </ActionPanel.Section>
        {switcher.custom.length > 0 ? (
          <ActionPanel.Section title="自定义">
            {switcher.custom.map((item) => (
              <Action
                key={item.id}
                title={item.name}
                icon={item.id === preset?.id ? Icon.CheckCircle : Icon.Circle}
                onAction={() => switchPreset(item.id)}
              />
            ))}
          </ActionPanel.Section>
        ) : null}
        <ActionPanel.Section>
          <Action.Push
            title="管理 Presets…"
            icon={Icon.Gear}
            target={<ChatPresetsView onChanged={reloadPresets} />}
          />
        </ActionPanel.Section>
      </ActionPanel.Submenu>

      {referenceBlock ? (
        <ActionPanel.Section>
          <Action
            title="只发参考内容（不提问）"
            icon={Icon.Eye}
            shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
            onAction={sendReference}
          />
        </ActionPanel.Section>
      ) : null}

      <ActionPanel.Section>
        <Action
          title="新对话"
          icon={Icon.Plus}
          shortcut={{ modifiers: ["cmd"], key: "n" }}
          onAction={startNewChat}
        />
        <Action
          title="清空当前对话"
          icon={Icon.Trash}
          shortcut={{ modifiers: ["cmd"], key: "z" }}
          onAction={startNewChat}
        />
        <Action.Push
          title="会话记录（两栏浏览）"
          icon={Icon.Clock}
          shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
          target={<HistoryView />}
        />
      </ActionPanel.Section>

      {referenceBlock ? (
        <ActionPanel.Section>
          <Action
            title="移除参考内容"
            icon={Icon.XMarkCircle}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={async () => {
              setReferenceBlock(null);
              await showToast({ style: Toast.Style.Success, title: "已移除参考内容" });
            }}
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

      <ActionPanel.Section title="配置">
        <Action
          title="配置本命令的模型 / 思考强度"
          icon={Icon.Gear}
          onAction={openCommandPreferences}
        />
        <Action.Push title="自定义 Prompt" icon={Icon.Pencil} target={<ConfigureView />} />
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
      // 会话切换搬进搜索栏下拉，列表里不再为每个会话占一行 ——
      // Raycast 的 List 行高固定且 nowrap，一行放不下对话内容，
      // 所以把整个对话放进右侧主区域，左侧只留一个锚点。
      searchBarAccessory={
        loaded ? (
          <List.Dropdown
            tooltip="切换会话"
            value={currentId ?? NEW_CHAT_ID}
            storeValue={false}
            onChange={(id) => {
              dbg(`dropdown 选中 ${id} (当前 currentId=${currentIdRef.current ?? "none"})`);
              switchTo(id);
            }}
          >
            <List.Dropdown.Item title="新对话" value={NEW_CHAT_ID} icon={Icon.Plus} />
            {conversations.length > 0 ? (
              <List.Dropdown.Section title="历史会话">
                {conversations.map((c) => (
                  <List.Dropdown.Item
                    key={c.id}
                    value={c.id}
                    title={c.title}
                    icon={Icon.SpeechBubble}
                  />
                ))}
              </List.Dropdown.Section>
            ) : null}
          </List.Dropdown>
        ) : null
      }
      searchBarPlaceholder={placeholder(busy, attachedImages.length, referenceBlock !== null, preset?.name)}
    >
      {loaded ? (
        <List.Item
          id="__transcript"
          title={title}
          subtitle={
            conversations.find((c) => c.id === currentId)?.title ?? "新对话（发第一条消息会自动保存）"
          }
          detail={<List.Item.Detail markdown={transcript} />}
          actions={actions()}
        />
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

function placeholder(busy: boolean, imageCount: number, hasReference: boolean, presetName?: string): string {
  // 把当前预设显示在输入框提示里 —— 否则切了预设没有任何视觉反馈
  const suffix = presetName ? ` · ${presetName}` : "";
  if (busy) return "生成中…可以先打字，↵ 会先打断";
  if (hasReference) return `已挂参考内容 · 直接问关于它的问题，↵ 发送${suffix}`;
  if (imageCount > 0) return `已附 ${imageCount} 张图，输入问题后 ↵ 发送${suffix}`;
  return `输入消息，按 ↵ 发送${suffix}`;
}

/**
 * 用给定的 system prompt **替换**消息列表里的那条 system。
 *
 * 发送前用它把历史里的 system 换成本次生效的预设 —— 这样中途切换预设能立刻生效，
 * 而不用要求用户开新对话。
 */
function withSystemPrompt(messages: ChatMessage[], system: string): ChatMessage[] {
  return [{ role: "system", content: system }, ...messages.filter((m) => m.role !== "system")];
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

function transcriptMarkdown(
  messages: ChatMessage[],
  pending: Pending | null,
  error: string | undefined,
  reference: ReferenceBlock | null,
): string {
  const blocks: string[] = [];

  if (reference) blocks.push(referenceMarkdown(reference));

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

/* ────────────────────────── 参考内容（不是 prompt） ────────────────────────── */

const PREVIEW_LINES = 14;

interface ReferenceBlock {
  text: string;
  images: string[];
  preview: string;
  truncated: boolean;
}

/**
 * 参考内容只作为「背景资料」，不占输入框。
 *
 * 预览限制行数：详情面板要留给对话本身，参考内容不该把它挤掉。
 */
function makeReferenceBlock(text: string, images: string[]): ReferenceBlock {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const truncated = lines.length > PREVIEW_LINES;
  return {
    text: trimmed,
    images,
    preview: truncated ? lines.slice(0, PREVIEW_LINES).join("\n") : trimmed,
    truncated,
  };
}

/** 拼成一条提交给模型的 user 消息：背景资料在前，用户的问题在后 */
function wrapReference(block: ReferenceBlock): string | ContentPart[] {
  const header = "以下是我的背景资料 / 参考内容，请先读它，然后回答我后面的问题。";
  const body = `${header}\n\n--- 参考内容开始 ---\n${block.text}\n--- 参考内容结束 ---`;

  if (block.images.length === 0) return body;
  return [
    { type: "text", text: body },
    { type: "text", text: "参考图片：" },
    ...block.images.map(imagePart),
  ];
}

/** 详情面板里参考内容的展示块 */
function referenceMarkdown(block: ReferenceBlock): string {
  const parts = ["### 📎 参考内容", "> _以下内容作为背景资料，不是你的提问_"];

  if (block.preview) {
    parts.push(block.preview.replace(/\n/g, "\n> ").replace(/^(?!>)/, "> "));
    if (block.truncated) {
      parts.push(`> _…（已截断，完整 ${block.text.length} 字会完整发给模型）_`);
    }
  }
  if (block.images.length > 0) parts.push(`> 🖼 附 ${block.images.length} 张参考图片`);

  return parts.join("\n\n");
}

/* ────────────────────────── 存储异常提示 ────────────────────────── */

/** 历史损坏时的顶部横幅 —— 必须让人一眼看到"现在不会写历史" */
const CORRUPTED_NOTICE = [
  "### ⚠️ 历史数据读取失败",
  "",
  "存储里的历史**解析不出来**。为避免覆盖原始数据，**当前不会写入任何历史**。",
  "原始内容已自动备份，请运行 **`Backup History`** 把它导出来，再决定是否清理。",
  "",
  "_对话本身可以正常继续，只是这一条不会存进历史。_",
].join("\n");

/**
 * 回答成功、但写历史失败时的提示。
 * 刻意和「请求失败」分开：模型已经答完了，内容没有丢，别让用户以为要重试。
 */
function saveFailureNotice(message: string): string {
  return [
    "### ⚠️ 回答已生成，但没能存进历史",
    "",
    "```",
    message,
    "```",
    "",
    "_内容没有丢，可以直接复制走；但这条对话不会出现在历史里。_",
  ].join("\n");
}
