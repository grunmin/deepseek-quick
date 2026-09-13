import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Form,
  Icon,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { resolveSystemPrompt } from "../lib/prompt-config";
import {
  BUILTIN_PRESETS,
  DEFAULT_PRESET_ID,
  deletePreset,
  describeBuiltin,
  describePreset,
  getActivePresetId,
  listPresets,
  setActivePresetId,
  upsertPreset,
  type BuiltinPreset,
  type ChatPreset,
  type PresetEffort,
} from "../lib/presets";
import { CHAT_SYSTEM } from "../lib/prompts";
import { ConfigureView } from "./prompt-config-view";

/** 内置预设的图标（按 id 给，避免把 UI 概念塞进 lib/presets.ts） */
const BUILTIN_ICON: Record<string, Icon> = {
  [DEFAULT_PRESET_ID]: Icon.Star,
  __senior__: Icon.Person,
  __research__: Icon.MagnifyingGlass,
};

/**
 * Chat 预设管理：每个预设 = 一套 system prompt + 模型 + 思考强度。
 *
 * 内置预设是**只读**的（开箱即用），想改就「复制为新的」变成可编辑的自定义预设。
 * `onChanged` 用于被 Chat 内嵌打开时通知父级刷新 Submenu 列表。
 */
export function ChatPresetsView({ onChanged }: { onChanged?: () => void | Promise<void> } = {}) {
  const [presets, setPresets] = useState<ChatPreset[] | null>(null);
  const [activeId, setActiveId] = useState<string>(DEFAULT_PRESET_ID);
  /** 内置「默认」预设实际用的 prompt（来自 Configure Prompts） */
  const [builtinPrompt, setBuiltinPrompt] = useState(CHAT_SYSTEM);

  const reload = useCallback(async () => {
    setPresets(await listPresets());
    setActiveId(await getActivePresetId());
    setBuiltinPrompt(await resolveSystemPrompt("chat", CHAT_SYSTEM));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const notifyChanged = useCallback(async () => {
    await reload();
    await onChanged?.();
  }, [reload, onChanged]);

  const activate = useCallback(
    async (id: string, name: string) => {
      await setActivePresetId(id);
      await notifyChanged();
      await showToast({ style: Toast.Style.Success, title: `已切换到「${name}」` });
    },
    [notifyChanged],
  );

  const loading = presets === null;

  /** 内置「默认」的 prompt 来自 Configure Prompts，其余内置是写死的 */
  const promptOf = (builtin: BuiltinPreset) => builtin.systemPrompt ?? builtinPrompt;

  return (
    <List
      isLoading={loading}
      isShowingDetail
      navigationTitle="Chat Presets"
      searchBarPlaceholder="管理 Chat 预设（prompt / 模型 / 思考强度）"
    >
      <List.Section title="内置" subtitle="开箱即用 · 只读，想改就「复制为新的」">
        {BUILTIN_PRESETS.map((builtin) => {
          const active = builtin.id === activeId;
          const isDefault = builtin.id === DEFAULT_PRESET_ID;
          const prompt = promptOf(builtin);

          return (
            <List.Item
              key={builtin.id}
              id={builtin.id}
              icon={active ? Icon.CheckCircle : (BUILTIN_ICON[builtin.id] ?? Icon.Circle)}
              title={builtin.name}
              subtitle={builtin.subtitle}
              accessories={active ? [{ tag: { value: "使用中", color: Color.Green } }] : []}
              detail={
                <List.Item.Detail
                  markdown={promptMarkdown(builtin.name, prompt)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label
                        title="Model"
                        text={builtin.model?.trim() || "跟随 Chat 命令 / 扩展全局"}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Reasoning"
                        text={builtin.effort === "inherit" ? "跟随 Chat 命令 / 扩展全局" : builtin.effort}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Prompt 来源"
                        text={builtin.systemPrompt ? "内置（只读）" : "Configure Prompts → Chat"}
                      />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="一句话" text={describeBuiltin(builtin)} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="设为当前 Preset"
                    icon={Icon.CheckCircle}
                    onAction={() => activate(builtin.id, builtin.name)}
                  />
                  <Action.Push
                    title="复制为新的（可编辑）"
                    icon={Icon.CopyClipboard}
                    target={
                      <PresetForm
                        initial={{
                          name: `${builtin.name} 副本`,
                          systemPrompt: prompt,
                          model: builtin.model,
                          effort: builtin.effort,
                        }}
                        onDone={notifyChanged}
                      />
                    }
                  />
                  <Action.Push title="新建 Preset…" icon={Icon.Plus} target={<PresetForm onDone={notifyChanged} />} />
                  {isDefault ? (
                    <ActionPanel.Section>
                      <Action.Push
                        title="编辑「默认」的 Prompt（Configure Prompts）"
                        icon={Icon.Pencil}
                        target={<ConfigureView />}
                      />
                    </ActionPanel.Section>
                  ) : null}
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>

      <List.Section
        title="自定义"
        subtitle={presets && presets.length > 0 ? `${presets.length} 个` : "还没有自定义预设"}
      >
        {(presets ?? []).map((preset) => {
          const active = preset.id === activeId;
          return (
            <List.Item
              key={preset.id}
              id={preset.id}
              icon={active ? Icon.CheckCircle : Icon.Circle}
              title={preset.name}
              subtitle={describePreset(preset)}
              accessories={active ? [{ tag: { value: "使用中", color: Color.Green } }] : []}
              detail={
                <List.Item.Detail
                  markdown={promptMarkdown(preset.name, preset.systemPrompt)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label
                        title="Model"
                        text={preset.model?.trim() || "跟随 Chat 命令 / 扩展全局"}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Reasoning"
                        text={preset.effort === "inherit" ? "跟随 Chat 命令 / 扩展全局" : preset.effort}
                      />
                      <List.Item.Detail.Metadata.Label title="更新于" text={new Date(preset.updatedAt).toLocaleString()} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="设为当前 Preset"
                    icon={Icon.CheckCircle}
                    onAction={() => activate(preset.id, preset.name)}
                  />
                  <Action.Push
                    title="编辑"
                    icon={Icon.Pencil}
                    target={<PresetForm initial={preset} editingId={preset.id} onDone={notifyChanged} />}
                  />
                  <Action.Push
                    title="复制为新的"
                    icon={Icon.CopyClipboard}
                    target={
                      <PresetForm initial={{ ...preset, name: `${preset.name} 副本` }} onDone={notifyChanged} />
                    }
                  />
                  <Action.Push title="新建 Preset…" icon={Icon.Plus} target={<PresetForm onDone={notifyChanged} />} />
                  <ActionPanel.Section>
                    <Action
                      title="删除"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={async () => {
                        if (
                          await confirmAlert({
                            title: `删除「${preset.name}」？`,
                            message: active ? "它正在被使用，删除后会回落到内置「默认」。" : "不可撤销。",
                            primaryAction: { title: "删除", style: Alert.ActionStyle.Destructive },
                          })
                        ) {
                          await deletePreset(preset.id);
                          await notifyChanged();
                          await showToast({ style: Toast.Style.Success, title: "已删除" });
                        }
                      }}
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
 * 新建 / 编辑表单。
 *
 * 用 `initial` + `editingId` 而不是整个 `ChatPreset` —— 因为「从内置复制」时
 * 没有 id 也没有 createdAt/updatedAt，硬凑一个假 ChatPreset 很容易写错。
 */
function PresetForm({
  initial,
  editingId,
  onDone,
}: {
  initial?: { name?: string; systemPrompt?: string; model?: string; effort?: PresetEffort };
  editingId?: string;
  onDone: () => Promise<void>;
}) {
  const { pop } = useNavigation();
  const isEdit = Boolean(editingId);

  return (
    <Form
      navigationTitle={isEdit ? `编辑「${initial?.name}」` : "新建 Preset"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={isEdit ? "保存" : "创建"}
            onSubmit={async (values: { name?: string; prompt?: string; model?: string; effort?: string }) => {
              const name = values.name?.trim();
              if (!name) {
                await showToast({ style: Toast.Style.Failure, title: "请填一个名称" });
                return;
              }
              await upsertPreset({
                id: editingId,
                name,
                systemPrompt: values.prompt ?? "",
                model: values.model,
                effort: (values.effort ?? "inherit") as PresetEffort,
              });
              await onDone();
              await showToast({ style: Toast.Style.Success, title: isEdit ? "已保存" : `已创建「${name}」` });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="名称"
        placeholder="例如：代码审查 / 翻译润色 / 苏格拉底式提问"
        defaultValue={initial?.name}
        autoFocus
      />
      <Form.TextArea
        id="prompt"
        title="System Prompt"
        placeholder={CHAT_SYSTEM}
        defaultValue={initial?.systemPrompt ?? CHAT_SYSTEM}
        info="支持多行"
      />
      <Form.TextField
        id="model"
        title="Model"
        placeholder="留空 = 跟随 Chat 命令 / 扩展全局"
        defaultValue={initial?.model}
        info="只影响这个预设，不影响其它命令"
      />
      <Form.Dropdown id="effort" title="思考强度" defaultValue={initial?.effort ?? "inherit"}>
        <Form.Dropdown.Item value="inherit" title="跟随 Chat 命令 / 扩展全局" icon={Icon.ArrowRight} />
        <Form.Dropdown.Item value="none" title="None（关闭思考，最快）" />
        <Form.Dropdown.Item value="low" title="Low" />
        <Form.Dropdown.Item value="high" title="High" />
        <Form.Dropdown.Item value="max" title="Max" />
      </Form.Dropdown>
    </Form>
  );
}

function promptMarkdown(name: string, prompt: string): string {
  return [
    `### 🎭 ${name}`,
    "",
    "**System Prompt**",
    "",
    "```text",
    prompt.replace(/`{3,}/g, (m) => m.split("").join("\u200b")),
    "```",
  ].join("\n");
}
