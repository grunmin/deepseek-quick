import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  List,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { prefs } from "../lib/config";
import {
  CHAT_SYSTEM,
  EXPLAIN_SYSTEM,
  IMAGE_SYSTEM,
  REWRITE_SYSTEM,
  RUN_PROMPT_SYSTEM,
  TRANSLATE_SYSTEM_BIDIRECTIONAL,
  translateSystem,
} from "../lib/prompts";
import {
  clearPromptOverrides,
  listPromptOverrides,
  PROMPT_COMMANDS,
  removePromptOverride,
  setPromptOverride,
  type PromptCommand,
  type PromptOverrides,
} from "../lib/prompt-config";

/**
 * 每条命令的 system prompt 配置界面。
 *
 * 为什么 prompt 不走 Raycast 偏好：偏好类型没有多行输入（见 lib/prompt-config.ts 的说明）。
 * model / 思考强度则相反 —— 它们是单值，直接用 Raycast 原生命令级偏好，不需要自建 UI。
 */

const META: Record<PromptCommand, { title: string; subtitle: string }> = {
  explain: { title: "Explain Selection", subtitle: "解释选中文本" },
  translate: { title: "Translate Selection", subtitle: "翻译选中文本" },
  rewrite: { title: "Rewrite Selection", subtitle: "改写 / 润色" },
  "run-prompt": { title: "Run Prompt", subtitle: "选中文本即 prompt，直接执行" },
  "ask-image": { title: "Ask About Image", subtitle: "看图问答" },
  chat: { title: "Chat", subtitle: "多轮对话（Chat with Selection 也走这条）" },
};

/** 该命令的内置 prompt。translate 的目标语言来自全局设置，所以是动态拼的。 */
function builtinPrompt(command: PromptCommand): string {
  switch (command) {
    case "explain":
      return EXPLAIN_SYSTEM;
    case "translate": {
      // 内置 prompt 取决于「中英互译」是否开启
      const p = prefs();
      return p.translateBidirectional ? TRANSLATE_SYSTEM_BIDIRECTIONAL : translateSystem(p.translateTo);
    }
    case "rewrite":
      return REWRITE_SYSTEM;
    case "run-prompt":
      return RUN_PROMPT_SYSTEM;
    case "ask-image":
      return IMAGE_SYSTEM;
    case "chat":
      return CHAT_SYSTEM;
  }
}

export function ConfigureView() {
  const [overrides, setOverrides] = useState<PromptOverrides | null>(null);

  const refresh = useCallback(async () => {
    setOverrides(await listPromptOverrides());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasAnyOverride = Object.values(overrides ?? {}).some((value) => value?.trim());

  return (
    <List
      isLoading={overrides === null}
      isShowingDetail
      navigationTitle="Configure Prompts"
      searchBarPlaceholder="搜索命令…"
    >
      <List.Section title="AI 命令" subtitle="选中即可编辑该命令的 system prompt">
        {PROMPT_COMMANDS.map((command) => {
          const override = overrides?.[command];
          const customized = Boolean(override?.trim());
          const builtin = builtinPrompt(command);
          const effective = customized ? (override as string) : builtin;

          return (
            <List.Item
              key={command}
              icon={customized ? Icon.Pencil : Icon.Document}
              title={META[command].title}
              subtitle={META[command].subtitle}
              accessories={[{ tag: customized ? "已自定义" : "内置默认" }]}
              detail={
                <List.Item.Detail
                  markdown={previewMarkdown(effective, builtin)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label title="命令" text={META[command].title} />
                      <List.Item.Detail.Metadata.Label
                        title="System Prompt"
                        text={customized ? "已自定义" : "内置默认"}
                      />
                      <List.Item.Detail.Metadata.Label title="字数" text={`${effective.length}`} />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="当前生效内容" />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action.Push
                    title="编辑 Prompt"
                    icon={Icon.Pencil}
                    target={<PromptForm command={command} override={override} onSaved={refresh} />}
                  />
                  {customized ? (
                    <Action
                      title="恢复内置默认"
                      icon={Icon.ArrowCounterClockwise}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
                      onAction={async () => {
                        await removePromptOverride(command);
                        await refresh();
                        await showToast({
                          style: Toast.Style.Success,
                          title: "已恢复内置默认",
                          message: META[command].title,
                        });
                      }}
                    />
                  ) : null}
                  <ActionPanel.Section>
                    {hasAnyOverride ? (
                      <Action
                        title="清空全部自定义"
                        icon={Icon.Trash}
                        style={Action.Style.Destructive}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
                        onAction={async () => {
                          if (
                            await confirmAlert({
                              title: "清空全部自定义 Prompt？",
                              message: "所有命令都会回到内置默认，此操作不可撤销。",
                              primaryAction: { title: "清空", style: Alert.ActionStyle.Destructive },
                            })
                          ) {
                            await clearPromptOverrides();
                            await refresh();
                            await showToast({ style: Toast.Style.Success, title: "已清空全部自定义" });
                          }
                        }}
                      />
                    ) : null}
                    <Action
                      title="打开扩展设置（全局 Model / 思考强度 / API Key）"
                      icon={Icon.Gear}
                      onAction={openExtensionPreferences}
                    />
                  </ActionPanel.Section>
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

/**
 * 编辑单条命令的 prompt。
 *
 * `override` 由列表页传入（已经加载好了），所以这里不用再异步读一次 ——
 * 否则 `Form.TextArea` 的 defaultValue 会先用内置值渲染、再被覆盖，出现闪一下或存错值。
 */
function PromptForm({
  command,
  override,
  onSaved,
}: {
  command: PromptCommand;
  override?: string;
  onSaved: () => Promise<void>;
}) {
  const { pop } = useNavigation();
  const builtin = builtinPrompt(command);
  const effective = override?.trim() ? override : builtin;

  return (
    <Form
      navigationTitle={`${META[command].title} · Prompt`}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="保存"
            onSubmit={async ({ prompt }: { prompt?: string }) => {
              // 留空、或与内置完全相同 → 删掉覆盖，避免把内置 prompt 固化成副本
              await setPromptOverride(command, prompt ?? "", builtin);
              await onSaved();
              await showToast({ style: Toast.Style.Success, title: "已保存", message: META[command].title });
              pop();
            }}
          />
          <Action
            title="恢复内置默认"
            icon={Icon.ArrowCounterClockwise}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            onAction={async () => {
              await removePromptOverride(command);
              await onSaved();
              await showToast({
                style: Toast.Style.Success,
                title: "已恢复内置默认",
                message: META[command].title,
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="prompt"
        title="System Prompt"
        placeholder={builtin}
        defaultValue={effective}
        info="支持多行。清空、或与内置内容完全相同，都会回落到内置默认。"
      />
      <Form.Description
        title="作用范围"
        text={`只影响 ${META[command].title}。模型与思考强度不在这里，请在该命令的设置里改（结果页 ⌘K →「配置本命令的模型 / 思考强度」）。`}
      />
    </Form>
  );
}

function previewMarkdown(effective: string, builtin: string): string {
  const parts = ["### 当前生效的 System Prompt", "", "```text", fence(effective), "```"];
  if (effective.trim() === builtin.trim()) {
    parts.push("", "_当前就是内置默认。_");
  } else {
    parts.push("", "_已自定义 —— 想还原就 ⌘⇧R 恢复内置默认。_");
  }
  return parts.join("\n");
}

/** prompt 里若出现连续反引号会截断代码块，这里做最小转义 */
function fence(text: string): string {
  return text.replace(/`{3,}/g, (match) => match.split("").join("\u200b"));
}
