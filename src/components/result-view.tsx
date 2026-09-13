import {
  Action,
  ActionPanel,
  Clipboard,
  Detail,
  Form,
  Icon,
  openCommandPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KNOWN_MODELS, prefs, type Effort } from "../lib/config";
import type { ChatMessage, Usage } from "../lib/deepseek";
import {
  listPresetRunOptions,
  resolvePresetForRun,
  type PresetRunBase,
  type PresetRunOption,
} from "../lib/presets";
import { useStream } from "../lib/use-stream";
import { ChatView } from "./chat-view";
import { ChatPresetsView } from "./chat-presets-view";
import { ConfigureView } from "./prompt-config-view";

/**
 * 结果页要跑的东西。
 *
 * `system` / `user` 分开传、而不是直接给现成的 `messages`，是因为「换 prompt 重新生成」需要用
 * 本命令的基线重建 messages —— 见 `QuickAction`。
 */
export interface ResultRun {
  /** 本命令生效的 system prompt（`Configure Prompts` 覆盖之后的值） */
  system: string;
  /** user 侧内容：纯文本，或「文本 + 图片」 */
  user: ChatMessage["content"];
  /** 本命令的基线模型 / 思考强度（Preset 里的「跟随」落到这里） */
  model: string;
  effort: Effort;
  /**
   * 是否提供「换模型 / 换强度 / 换 Preset 重新生成」。
   * `Ask About Image` 没有开：换到不带 vision 的模型会直接失败。
   */
  regenerable?: boolean;
}

/** 这一次生成**实际**用的配置；「重新生成」就是改它并换 key 重挂载 */
interface RunConfig {
  system: string;
  model: string;
  effort: Effort;
  /** 当前这套配置来自哪个 Preset；单独改模型 / 强度后会清空（那已经不是这个预设本身了） */
  presetId?: string;
  presetName?: string;
}

const EFFORT_OPTIONS: Array<{ value: Effort; title: string }> = [
  { value: "none", title: "None（不思考，最快）" },
  { value: "low", title: "Low" },
  { value: "high", title: "High" },
  { value: "max", title: "Max" },
];

/**
 * 快捷命令的结果页：流式渲染 + 主操作（替换 / 复制）+ 继续讨论 + 换配置重新生成。
 */
export function ResultView({ title, run }: { title: string; run: ResultRun }) {
  const [config, setConfig] = useState<RunConfig>(() => ({
    system: run.system,
    model: run.model,
    effort: run.effort,
  }));

  /**
   * 重新生成 = **换 key 重挂载**，而不是去改 `useStream` 的 effect。
   * 它「只跑一次」是刻意设计（约束 1：cleanup 里 abort 会让界面永远空白），
   * 重挂载是最不碰它的做法；在途请求由 `StreamedResult` 自己 `stop()` 掐掉。
   */
  const [nonce, setNonce] = useState(0);

  /** Preset 的回落基线：这条命令自己的 prompt / 模型 / 强度，全程不变 */
  const base = useMemo<PresetRunBase>(
    () => ({ system: run.system, model: run.model, effort: run.effort }),
    [run.system, run.model, run.effort],
  );

  const [presets, setPresets] = useState<{
    builtins: PresetRunOption[];
    custom: PresetRunOption[];
  } | null>(null);
  const [models, setModels] = useState<string[]>(() => uniqueModels([base.model, ...KNOWN_MODELS]));

  useEffect(() => {
    if (!run.regenerable) return;
    let alive = true;
    (async () => {
      const options = await listPresetRunOptions(base);
      if (!alive) return;
      setPresets(options);
      setModels(
        uniqueModels([
          base.model,
          ...KNOWN_MODELS,
          ...options.builtins.map((o) => o.model),
          ...options.custom.map((o) => o.model),
        ]),
      );
    })();
    return () => {
      alive = false;
    };
  }, [run.regenerable, base]);

  const messages = useMemo<ChatMessage[]>(
    () => [
      { role: "system", content: config.system },
      { role: "user", content: run.user },
    ],
    [config.system, run.user],
  );

  const apply = useCallback((patch: Partial<RunConfig>) => {
    // 手填的自定义模型也进候选列表，方便在本次会话里切回来
    if (patch.model) setModels((prev) => uniqueModels([...prev, patch.model as string]));
    setConfig((prev) => ({ ...prev, ...patch }));
    setNonce((n) => n + 1);
  }, []);

  return (
    <StreamedResult
      key={nonce}
      title={title}
      messages={messages}
      config={config}
      base={base}
      models={models}
      presets={presets}
      regenerable={run.regenerable}
      onRegenerate={apply}
    />
  );
}

/** 真正跑流式请求的那一层。靠外层换 `key` 重挂载来重跑，所以它自己不需要处理配置变化 */
function StreamedResult({
  title,
  messages,
  config,
  base,
  models,
  presets,
  regenerable,
  onRegenerate,
}: {
  title: string;
  messages: ChatMessage[];
  config: RunConfig;
  base: PresetRunBase;
  models: string[];
  presets: { builtins: PresetRunOption[]; custom: PresetRunOption[] } | null;
  regenerable?: boolean;
  onRegenerate: (patch: Partial<RunConfig>) => void;
}) {
  const p = prefs();
  const { content, reasoning, isLoading, error, usage, stop } = useStream(messages, {
    model: config.model,
    effort: config.effort,
  });

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

    // 底部始终标出**这次用的组合**：换过模型 / 强度 / 预设后，一眼能看出回答是谁给的
    const footer = [comboLabel(config), formatUsage(usage)].filter(Boolean).join(" · ");
    parts.push(`---\n\n<sub>${footer}</sub>`);

    return parts.join("\n\n");
  }, [content, reasoning, error, isLoading, usage, p.showReasoning, config]);

  const followUpMessages: ChatMessage[] = [...messages, { role: "assistant", content }];

  /** 重新生成前先停掉在途请求，别让旧回答继续烧 token */
  const regenerate = (patch: Partial<RunConfig>) => {
    stop();
    onRegenerate(patch);
  };

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

          {regenerable ? (
            <RegenerateActions
              config={config}
              base={base}
              models={models}
              presets={presets}
              onApply={regenerate}
            />
          ) : null}

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

/**
 * 「重新生成」的动作组：**三个单轴子菜单**，每次只动一个维度。
 *
 * 为什么不摊成「预设 × 模型 × 强度」的组合清单：那是 20+ 项，子菜单直接没法用；
 * 而大多数时候用户只想改其中一个。要整套换就选 Preset —— 它本身就是一套组合。
 */
function RegenerateActions({
  config,
  base,
  models,
  presets,
  onApply,
}: {
  config: RunConfig;
  base: PresetRunBase;
  models: string[];
  presets: { builtins: PresetRunOption[]; custom: PresetRunOption[] } | null;
  onApply: (patch: Partial<RunConfig>) => void;
}) {
  /** 单独换模型 / 强度后，这套配置就不再等于某个预设了 */
  const detach = { presetId: undefined, presetName: undefined };

  return (
    <ActionPanel.Section title="重新生成">
      <Action
        title="重新生成（同配置）"
        icon={Icon.Redo}
        shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
        onAction={() => onApply({})}
      />

      <ActionPanel.Submenu title={`换模型重新生成（${config.model}）`} icon={Icon.Switch} filtering>
        {models.map((model) => (
          <Action
            key={model}
            title={model}
            icon={config.model === model ? Icon.CheckCircle : Icon.Circle}
            onAction={() => onApply({ model, ...detach })}
          />
        ))}
        <ActionPanel.Section>
          <Action.Push
            title="自定义模型…"
            icon={Icon.Pencil}
            target={<CustomModelForm onSubmit={(model) => onApply({ model, ...detach })} />}
          />
        </ActionPanel.Section>
      </ActionPanel.Submenu>

      <ActionPanel.Submenu
        title={`换思考强度重新生成（${effortLabel(config.effort)}）`}
        icon={Icon.Gauge}
      >
        {EFFORT_OPTIONS.map((option) => (
          <Action
            key={option.value}
            title={option.title}
            icon={config.effort === option.value ? Icon.CheckCircle : Icon.Circle}
            onAction={() => onApply({ effort: option.value, ...detach })}
          />
        ))}
      </ActionPanel.Submenu>

      <ActionPanel.Submenu
        title={`换 Preset 重新生成${config.presetName ? `（${config.presetName}）` : ""}`}
        icon={Icon.Switch}
        isLoading={presets === null}
      >
        <ActionPanel.Section title="内置">
          {(presets?.builtins ?? []).map((option) => (
            <PresetAction
              key={option.id}
              option={option}
              base={base}
              currentId={config.presetId}
              onApply={onApply}
            />
          ))}
        </ActionPanel.Section>
        {presets && presets.custom.length > 0 ? (
          <ActionPanel.Section title="自定义">
            {presets.custom.map((option) => (
              <PresetAction
                key={option.id}
                option={option}
                base={base}
                currentId={config.presetId}
                onApply={onApply}
              />
            ))}
          </ActionPanel.Section>
        ) : null}
        <ActionPanel.Section>
          <Action.Push title="管理 Presets…" icon={Icon.Gear} target={<ChatPresetsView />} />
        </ActionPanel.Section>
      </ActionPanel.Submenu>
    </ActionPanel.Section>
  );
}

/** Action 没有 subtitle（只有 List.Item 有），所以把摘要并进标题 */
function PresetAction({
  option,
  base,
  currentId,
  onApply,
}: {
  option: PresetRunOption;
  base: PresetRunBase;
  currentId?: string;
  onApply: (patch: Partial<RunConfig>) => void;
}) {
  return (
    <Action
      title={`${option.name}（${option.summary}）`}
      icon={currentId === option.id ? Icon.CheckCircle : Icon.Circle}
      onAction={async () => {
        // 点选时重新解析：期间可能刚在「管理 Presets…」里改过这个预设
        const resolved = await resolvePresetForRun(option.id, base);
        if (!resolved) {
          await showToast({ style: Toast.Style.Failure, title: "这个 Preset 已经不存在了" });
          return;
        }
        onApply({
          system: resolved.system,
          model: resolved.model,
          effort: resolved.effort,
          presetId: resolved.id,
          presetName: resolved.name,
        });
      }}
    />
  );
}

/** 菜单里没有的模型走这里手填（Model 是自由文本偏好，枚举不完） */
function CustomModelForm({ onSubmit }: { onSubmit: (model: string) => void }) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="用自定义模型重新生成"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="重新生成"
            onSubmit={({ model }: { model?: string }) => {
              const value = model?.trim();
              if (!value) {
                void showToast({ style: Toast.Style.Failure, title: "请填写模型名" });
                return;
              }
              pop();
              onSubmit(value);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="model"
        title="模型"
        placeholder="deepseek-v4-pro"
        autoFocus
        info="填端点支持的模型名。只影响这一次生成，不会改任何设置。"
      />
    </Form>
  );
}

/* ─────────────────────────── 展示辅助 ─────────────────────────── */

function uniqueModels(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function effortLabel(effort: Effort): string {
  return effort === "none" ? "不思考" : `reasoning ${effort}`;
}

/** 这次回答用的是哪套组合：`资深模式 · deepseek-v4-pro · reasoning high` */
function comboLabel(config: RunConfig): string {
  return [config.presetName, config.model, effortLabel(config.effort)].filter(Boolean).join(" · ");
}

/**
 * 用量摘要。**只在有值时**才显示 reasoning / cache ——
 *
 *   - reasoning：快捷命令默认 `thinking: disabled`，本来就不产生思考 token，恒为 0；
 *   - cache hit：DeepSeek 的缓存是「前缀完整匹配 + 已落盘」才命中，以 64 tokens 为存储单位，
 *     实际门槛远高于 64，几十到几百字的选中文本基本够不到（实测 136 tokens 连试 3 次都是 0，
 *     2937 tokens 的第 2 次才命中 2688）。所以它常态就是 0。
 *
 * 把恒为 0 的字段摆出来只会让人以为坏了 —— 有值才显示，缓存顺便带上命中占比。
 */
function formatUsage(usage?: Usage): string | undefined {
  if (!usage?.completionTokens) return undefined;

  const bits = [`${usage.promptTokens ?? "?"} in / ${usage.completionTokens} out`];
  if (usage.reasoningTokens) bits.push(`reasoning ${usage.reasoningTokens}`);
  if (usage.cachedTokens) bits.push(`cache hit ${usage.cachedTokens}/${usage.promptTokens ?? "?"}`);

  return bits.join(" · ");
}
