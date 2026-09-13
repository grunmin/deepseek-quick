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
import {
  BUILTIN_PRESETS,
  DEFAULT_PRESET_ID,
  clearBuiltinOverride,
  deletePreset,
  describePreset,
  getActivePresetId,
  listPresets,
  resolveBuiltinEffective,
  setActivePresetId,
  setBuiltinOverride,
  upsertPreset,
  type BuiltinPreset,
  type ChatPreset,
  type EffectiveBuiltin,
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
 * - **自定义预设**：随便增删改
 * - **内置预设**：永远在、可恢复。prompt / 模型 / 强度都能改，改动以「覆盖」的形式
 *   叠在内置值之上（和 `prompt-config.ts` 覆盖命令 prompt 是同一套思路）
 * - **「默认」预设**例外：它代表"让 Chat 用它原本的配置"，prompt 归 Configure Prompts 管，
 *   模型与强度归 Chat 命令级偏好管，所以这里不提供覆盖入口
 */
export function ChatPresetsView({ onChanged }: { onChanged?: () => void | Promise<void> } = {}) {
  const [presets, setPresets] = useState<ChatPreset[] | null>(null);
  const [builtins, setBuiltins] = useState<EffectiveBuiltin[] | null>(null);
  const [activeId, setActiveId] = useState<string>(DEFAULT_PRESET_ID);

  const reload = useCallback(async () => {
    const [list, active, effective] = await Promise.all([
      listPresets(),
      getActivePresetId(),
      Promise.all(BUILTIN_PRESETS.map(resolveBuiltinEffective)),
    ]);
    setPresets(list);
    setActiveId(active);
    setBuiltins(effective);
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

  /**
   * 保存内置预设的覆盖。若改完之后和内置值**完全一样**，就把覆盖删掉 ——
   * 这样"打开表单直接保存"不会把内置值固化成一份副本。
   */
  const saveBuiltinOverride = useCallback(
    async (
      builtin: BuiltinPreset,
      values: { systemPrompt: string; model?: string; effort: PresetEffort },
      onDone: () => Promise<void>,
    ) => {
      const samePrompt = values.systemPrompt.trim() === (builtin.systemPrompt ?? "").trim();
      const sameModel = (values.model?.trim() || undefined) === (builtin.model?.trim() || undefined);
      const sameEffort = values.effort === builtin.effort;

      if (samePrompt && sameModel && sameEffort) {
        await clearBuiltinOverride(builtin.id);
      } else {
        await setBuiltinOverride(builtin.id, {
          systemPrompt: values.systemPrompt,
          model: values.model,
          effort: values.effort,
        });
      }
      await onDone();
    },
    [],
  );

  const loading = presets === null || builtins === null;
  const effectiveById = new Map((builtins ?? []).map((b) => [b.id, b]));

  return (
    <List
      isLoading={loading}
      isShowingDetail
      navigationTitle="Chat Presets"
      searchBarPlaceholder="管理 Chat 预设（prompt / 模型 / 思考强度）"
    >
      <List.Section title="内置" subtitle="永远在 · 可直接编辑，也可恢复内置默认">
        {BUILTIN_PRESETS.map((builtin) => {
          const eff = effectiveById.get(builtin.id);
          const active = builtin.id === activeId;
          const isDefault = builtin.id === DEFAULT_PRESET_ID;
          if (!eff) return null;

          const accessories: List.Item.Accessory[] = [];
          if (eff.hasOverride) accessories.push({ tag: { value: "已自定义", color: Color.Orange } });
          if (active) accessories.push({ tag: { value: "使用中", color: Color.Green } });

          return (
            <List.Item
              key={builtin.id}
              id={builtin.id}
              icon={active ? Icon.CheckCircle : (BUILTIN_ICON[builtin.id] ?? Icon.Circle)}
              title={eff.name}
              subtitle={builtin.subtitle}
              accessories={accessories}
              detail={
                <List.Item.Detail
                  markdown={promptMarkdown(eff.name, eff.systemPrompt)}
                  metadata={
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Label
                        title="Model"
                        text={eff.model?.trim() || "跟随 Chat 命令 / 扩展全局"}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Reasoning"
                        text={eff.effort === "inherit" ? "跟随 Chat 命令 / 扩展全局" : eff.effort}
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Prompt 来源"
                        text={isDefault ? "Configure Prompts → Chat" : eff.hasOverride ? "内置 + 你的覆盖" : "内置"}
                      />
                      <List.Item.Detail.Metadata.Separator />
                      <List.Item.Detail.Metadata.Label title="状态" text={eff.hasOverride ? "已自定义" : "内置默认"} />
                    </List.Item.Detail.Metadata>
                  }
                />
              }
              actions={
                <ActionPanel>
                  <Action
                    title="设为当前 Preset"
                    icon={Icon.CheckCircle}
                    onAction={() => activate(builtin.id, eff.name)}
                  />

                  {isDefault ? (
                    // 「默认」= 让 Chat 用它原本的配置：prompt 去 Configure Prompts 改，
                    // 模型/强度去命令设置改，所以这里不给覆盖入口
                    <Action.Push
                      title="编辑它的 Prompt（Configure Prompts）"
                      icon={Icon.Pencil}
                      target={<ConfigureView />}
                    />
                  ) : (
                    <Action.Push
                      title="编辑（覆盖内置）"
                      icon={Icon.Pencil}
                      target={
                        <PresetForm
                          showName={false}
                          navigationTitle={`编辑「${eff.name}」`}
                          submitTitle="保存覆盖"
                          initial={{
                            systemPrompt: eff.systemPrompt,
                            model: eff.model,
                            effort: eff.effort,
                          }}
                          onSubmit={(values) => saveBuiltinOverride(builtin, values, notifyChanged)}
                        />
                      }
                    />
                  )}

                  {eff.hasOverride ? (
                    <Action
                      title="恢复内置默认"
                      icon={Icon.ArrowCounterClockwise}
                      onAction={async () => {
                        await clearBuiltinOverride(builtin.id);
                        await notifyChanged();
                        await showToast({ style: Toast.Style.Success, title: `已恢复「${eff.name}」的内置默认` });
                      }}
                    />
                  ) : null}

                  <Action.Push
                    title="复制为新的（可编辑）"
                    icon={Icon.CopyClipboard}
                    target={
                      <PresetForm
                        navigationTitle="复制为新预设"
                        submitTitle="创建"
                        initial={{
                          name: `${eff.name} 副本`,
                          systemPrompt: eff.systemPrompt,
                          model: eff.model,
                          effort: eff.effort,
                        }}
                        onSubmit={async (values) => {
                          await upsertPreset({
                            name: values.name,
                            systemPrompt: values.systemPrompt,
                            model: values.model,
                            effort: values.effort,
                          });
                          await notifyChanged();
                        }}
                      />
                    }
                  />
                  <Action.Push title="新建 Preset…" icon={Icon.Plus} target={<NewPresetForm onDone={notifyChanged} />} />
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
                    target={
                      <PresetForm
                        navigationTitle={`编辑「${preset.name}」`}
                        submitTitle="保存"
                        initial={preset}
                        onSubmit={async (values) => {
                          await upsertPreset({
                            id: preset.id,
                            name: values.name,
                            systemPrompt: values.systemPrompt,
                            model: values.model,
                            effort: values.effort,
                          });
                          await notifyChanged();
                        }}
                      />
                    }
                  />
                  <Action.Push
                    title="复制为新的"
                    icon={Icon.CopyClipboard}
                    target={
                      <PresetForm
                        navigationTitle="复制为新预设"
                        submitTitle="创建"
                        initial={{ ...preset, name: `${preset.name} 副本` }}
                        onSubmit={async (values) => {
                          await upsertPreset({
                            name: values.name,
                            systemPrompt: values.systemPrompt,
                            model: values.model,
                            effort: values.effort,
                          });
                          await notifyChanged();
                        }}
                      />
                    }
                  />
                  <Action.Push title="新建 Preset…" icon={Icon.Plus} target={<NewPresetForm onDone={notifyChanged} />} />
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

/** 新建空白预设 */
function NewPresetForm({ onDone }: { onDone: () => Promise<void> }) {
  return (
    <PresetForm
      navigationTitle="新建 Preset"
      submitTitle="创建"
      onSubmit={async (values) => {
        await upsertPreset({
          name: values.name,
          systemPrompt: values.systemPrompt,
          model: values.model,
          effort: values.effort,
        });
        await onDone();
      }}
    />
  );
}

/**
 * 预设表单。同时服务三种场景，靠 props 区分而不是塞假数据：
 *   - 新建 / 编辑自定义预设 → `showName`，`onSubmit` 里调 `upsertPreset`
 *   - 覆盖内置预设           → `showName={false}`（名字固定），`onSubmit` 里写覆盖
 */
function PresetForm({
  initial,
  showName = true,
  navigationTitle,
  submitTitle,
  onSubmit,
}: {
  initial?: { name?: string; systemPrompt?: string; model?: string; effort?: PresetEffort };
  showName?: boolean;
  navigationTitle: string;
  submitTitle: string;
  onSubmit: (values: {
    name: string;
    systemPrompt: string;
    model?: string;
    effort: PresetEffort;
  }) => Promise<void>;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle={navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={submitTitle}
            onSubmit={async (values: { name?: string; prompt?: string; model?: string; effort?: string }) => {
              const name = showName ? values.name?.trim() : (initial?.name ?? "未命名");
              if (showName && !name) {
                await showToast({ style: Toast.Style.Failure, title: "请填一个名称" });
                return;
              }
              await onSubmit({
                name: name || "未命名",
                systemPrompt: values.prompt ?? "",
                model: values.model,
                effort: (values.effort ?? "inherit") as PresetEffort,
              });
              await showToast({ style: Toast.Style.Success, title: `${submitTitle}成功` });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      {showName ? (
        <Form.TextField
          id="name"
          title="名称"
          placeholder="例如：代码审查 / 翻译润色 / 苏格拉底式提问"
          defaultValue={initial?.name}
          autoFocus
        />
      ) : null}
      <Form.TextArea
        id="prompt"
        title="System Prompt"
        placeholder={CHAT_SYSTEM}
        defaultValue={initial?.systemPrompt ?? CHAT_SYSTEM}
        info="支持多行。改回与内置完全一致时，覆盖会自动清除。"
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
