import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  confirmAlert,
  environment,
  Form,
  Icon,
  List,
  showInFinder,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useCallback, useEffect, useState } from "react";
import {
  buildExportPayload,
  clearAllHistoryData,
  importConversations,
  parseHistoryFile,
  readCorruptedBackup,
  readHistory,
  type HistorySnapshot,
} from "../lib/history";
import {
  applyMigrationBundle,
  buildMigrationBundle,
  describeUndoPoint,
  isEmptyBundle,
  parseMigrationBundle,
  planImport,
  readLocalSnapshot,
  undoLastMigration,
  type ImportPlan,
  type LocalSnapshot,
  type ParsedBundle,
} from "../lib/migration";

/**
 * 历史的导出 / 导入 / 抢救。
 *
 * 存在的理由：历史存在 Raycast 的**加密本地库**里（`main.db` 是加密的，外部读不了），
 * 且没有跨设备同步（Cloud Sync 是 Pro 功能）。所以"能导出成普通 JSON 文件"
 * 是唯一能对抗「换机 / 重装 / 卸载」的手段。
 */
export function HistoryBackupView() {
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [corruptedBackup, setCorruptedBackup] = useState<string>();
  const [local, setLocal] = useState<LocalSnapshot | null>(null);
  const [undoAt, setUndoAt] = useState<number>();

  const reload = useCallback(async () => {
    setSnapshot(await readHistory());
    setCorruptedBackup(await readCorruptedBackup());
    setLocal(await readLocalSnapshot());
    setUndoAt((await describeUndoPoint())?.savedAt);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const conversations = snapshot?.conversations ?? [];
  const corrupted = snapshot?.corrupted ?? false;
  const loading = snapshot === null;

  const exportPayload = buildExportPayload(conversations);

  return (
    <List
      isLoading={loading}
      isShowingDetail
      navigationTitle="Backup History"
      searchBarPlaceholder="导出 / 导入对话历史"
    >
      <List.Section title="状态">
        <List.Item
          id="status"
          icon={corrupted ? Icon.Warning : Icon.Info}
          title={corrupted ? "历史数据读取失败" : `共 ${conversations.length} 条对话`}
          subtitle={corrupted ? "原始数据已自动备份，可导出抢救" : `约 ${formatBytes(snapshot?.bytes ?? 0)}`}
          detail={<List.Item.Detail markdown={statusMarkdown(snapshot, corruptedBackup)} />}
          actions={
            <ActionPanel>
              <Action title="重新读取" icon={Icon.ArrowClockwise} onAction={reload} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="换机迁移">
        <List.Item
          id="migrate-export"
          icon={Icon.Box}
          title="导出设备迁移包…"
          subtitle={local ? migrationSummary(local) : "读取中…"}
          detail={<List.Item.Detail markdown={migrationExportMarkdown(local)} />}
          actions={
            <ActionPanel>
              <Action.Push
                title="打包并导出"
                icon={Icon.Upload}
                target={<MigrationExportForm local={local} />}
              />
            </ActionPanel>
          }
        />

        <List.Item
          id="migrate-import"
          icon={Icon.Download}
          title="导入设备迁移包…"
          subtitle="先预览会改动什么，再决定是否写入"
          detail={
            <List.Item.Detail
              markdown={[
                "### 📦 导入设备迁移包",
                "",
                "从另一台机器导出的包，把**配置和历史**还原到这台机器。",
                "",
                "- 对话历史 / 自定义 Preset：**按 id 合并**，不会清空本机现有数据",
                "- 命令 Prompt 覆盖 / 内置 Preset 覆盖：**包里有哪个就替换哪个**，本机其余保持不变",
                "- 当前选中的 Preset：包里指定了才改",
                "",
                "选完文件会先给一份**改动预览**，确认后才写入；写入前会自动存一个撤销点。",
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="选择文件并预览"
                icon={Icon.Download}
                target={<MigrationImportForm onDone={reload} />}
              />
            </ActionPanel>
          }
        />

        {undoAt ? (
          <List.Item
            id="migrate-undo"
            icon={Icon.ArrowCounterClockwise}
            title="撤销上一次导入"
            subtitle={new Date(undoAt).toLocaleString()}
            detail={
              <List.Item.Detail
                markdown={[
                  "### ↩️ 撤销上一次导入",
                  "",
                  "把历史 / Preset / Prompt 覆盖 / 内置 Preset 覆盖恢复到**导入之前**的状态。",
                  "",
                  "撤销点只保留最近一次导入，用掉即失效。",
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="撤销导入"
                  icon={Icon.ArrowCounterClockwise}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    if (
                      await confirmAlert({
                        title: "撤销上一次导入？",
                        message: "历史 / Preset / Prompt 覆盖都会回到导入前的状态。",
                        primaryAction: { title: "撤销", style: Alert.ActionStyle.Destructive },
                      })
                    ) {
                      try {
                        const result = await undoLastMigration();
                        await reload();
                        await showToast({
                          style: Toast.Style.Success,
                          title: "已撤销",
                          message: `恢复 ${result.restored} 项`,
                        });
                      } catch (err) {
                        await showToast({
                          style: Toast.Style.Failure,
                          title: "撤销失败",
                          message: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        ) : null}
      </List.Section>

      <List.Section title="备份">
        <List.Item
          id="export"
          icon={Icon.Upload}
          title="导出到文件…"
          subtitle={conversations.length > 0 ? `${conversations.length} 条对话` : "当前没有可导出的对话"}
          detail={
            <List.Item.Detail
              markdown={[
                "### 📤 导出到文件",
                "",
                "把全部对话写成一个普通 JSON 文件，可放到 iCloud / Git / 网盘里长期保存。",
                "",
                "- 图片不会包含在内（历史里本来就只有 `[图片]` 占位）",
                "- 文件格式：`{ format, version, exportedAt, conversations }`",
                "- **导入时可以无损合并回来**",
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action.Push
                title="选择目录并导出"
                icon={Icon.Upload}
                target={<ExportForm payload={exportPayload} />}
              />
            </ActionPanel>
          }
        />

        <List.Item
          id="copy"
          icon={Icon.Clipboard}
          title="复制为 JSON"
          subtitle="直接进剪贴板，适合快速粘贴到别处"
          detail={
            <List.Item.Detail
              markdown={"### 📋 复制为 JSON\n\n把同样的导出内容直接放进剪贴板，不落文件。"}
            />
          }
          actions={
            <ActionPanel>
              <Action
                title="复制到剪贴板"
                icon={Icon.Clipboard}
                onAction={async () => {
                  await Clipboard.copy(exportPayload);
                  await showToast({
                    style: Toast.Style.Success,
                    title: "已复制",
                    message: `${conversations.length} 条对话`,
                  });
                }}
              />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="恢复">
        <List.Item
          id="import"
          icon={Icon.Download}
          title="从文件导入（合并）"
          subtitle="按 id 合并，不会覆盖现有历史"
          detail={
            <List.Item.Detail
              markdown={[
                "### 📥 从文件导入",
                "",
                "选一个之前导出的 JSON 文件，与现有历史**合并**：",
                "",
                "- 同一个 `id` 的对话，以 `updatedAt` 更新的那条为准",
                "- 现有没有的对话会被加进来",
                "- **不会**清空你现有的历史",
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action.Push title="选择文件并导入" icon={Icon.Download} target={<ImportForm onDone={reload} />} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="数据位置">
        <List.Item
          id="reveal"
          icon={Icon.Folder}
          title="在 Finder 中显示扩展数据目录"
          subtitle={environment.supportPath}
          detail={
            <List.Item.Detail
              markdown={[
                "### 📂 扩展数据目录",
                "",
                "`" + environment.supportPath + "`",
                "",
                "导出/导入的默认落点。注意：**历史本身不在这里** —— 它存在 Raycast 的加密本地库里。",
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action
                title="在 Finder 中显示"
                icon={Icon.Folder}
                onAction={() => showInFinder(environment.supportPath)}
              />
            </ActionPanel>
          }
        />
      </List.Section>

      {corrupted || corruptedBackup ? (
        <List.Section title="抢救损坏数据">
          <List.Item
            id="rescue"
            icon={Icon.Warning}
            title="导出损坏的原始数据"
            subtitle={corruptedBackup ? `${corruptedBackup.length} 字符` : "没有备份"}
            detail={
              <List.Item.Detail
                markdown={[
                  "### 🚑 原始数据备份",
                  "",
                  "读取历史失败时，扩展会把**原始字符串原样**备份一份，绝不静默丢弃。",
                  "把它导出来，就有机会用脚本/编辑器手工修复。",
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="导出到文件"
                  icon={Icon.Upload}
                  onAction={async () => {
                    if (!corruptedBackup) {
                      await showToast({ style: Toast.Style.Failure, title: "没有可导出的备份" });
                      return;
                    }
                    try {
                      const file = join(environment.supportPath, `deepseek-quick-corrupted-${stamp()}.json`);
                      await writeFile(file, corruptedBackup, "utf8");
                      await showInFinder(file);
                      await showToast({ style: Toast.Style.Success, title: "已导出原始数据", message: file });
                    } catch (err) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "导出失败",
                        message: err instanceof Error ? err.message : String(err),
                      });
                    }
                  }}
                />
              </ActionPanel>
            }
          />

          <List.Item
            id="wipe"
            icon={Icon.Trash}
            title="清除全部历史数据并重新开始"
            subtitle="包含损坏备份 —— 不可撤销"
            detail={
              <List.Item.Detail
                markdown={[
                  "### 🗑 清除全部历史",
                  "",
                  "同时删除历史本体和损坏备份。**不可撤销。**",
                  "",
                  "建议先把上面两项都导出来再执行。",
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="清除全部历史"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={async () => {
                    if (
                      await confirmAlert({
                        title: "清除全部历史数据？",
                        message: "历史本体和损坏备份都会被删除，不可撤销。",
                        primaryAction: { title: "清除", style: Alert.ActionStyle.Destructive },
                      })
                    ) {
                      await clearAllHistoryData();
                      await reload();
                      await showToast({ style: Toast.Style.Success, title: "已清除全部历史" });
                    }
                  }}
                />
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}
    </List>
  );
}

/** 导出：让用户选目录，留空则落到扩展数据目录 */
function ExportForm({ payload }: { payload: string }) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="导出历史"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="导出"
            onSubmit={async ({ dir }: { dir?: string[] }) => {
              const target = dir?.[0] ?? environment.supportPath;
              try {
                const file = join(target, `deepseek-quick-history-${stamp()}.json`);
                await writeFile(file, payload, "utf8");
                await showToast({ style: Toast.Style.Success, title: "已导出", message: file });
                await showInFinder(file);
                pop();
              } catch (err) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "导出失败",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="dir"
        title="导出到"
        info="留空则导出到扩展数据目录，导出后会自动在 Finder 中选中该文件"
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
      />
    </Form>
  );
}

/** 导入：选文件 → 解析 → 合并 */
function ImportForm({ onDone }: { onDone: () => Promise<void> }) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="导入历史"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="导入并合并"
            onSubmit={async ({ file }: { file?: string[] }) => {
              const path = file?.[0];
              if (!path) {
                await showToast({ style: Toast.Style.Failure, title: "请先选择一个 JSON 文件" });
                return;
              }
              try {
                const text = await readFile(path, "utf8");
                const incoming = parseHistoryFile(text);
                const result = await importConversations(incoming);
                await onDone();
                await showToast({
                  style: Toast.Style.Success,
                  title: "导入完成",
                  message: `新增 ${result.added} · 更新 ${result.updated} · 现有 ${result.total} 条`,
                });
                pop();
              } catch (err) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "导入失败",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="file"
        title="选择 JSON 文件"
        info="支持本扩展导出的格式，也接受裸的对话数组"
        canChooseFiles
        canChooseDirectories={false}
        allowMultipleSelection={false}
      />
      <Form.Description
        title="合并规则"
        text="按对话 id 去重；同一条以 updatedAt 更新的为准。现有历史不会被清空。"
      />
    </Form>
  );
}

function statusMarkdown(snapshot: HistorySnapshot | null, corruptedBackup?: string): string {
  if (!snapshot) return "_读取中…_";

  const lines = [
    "### 📊 历史状态",
    "",
    `- 对话数：**${snapshot.conversations.length}**`,
    `- 占用：约 **${formatBytes(snapshot.bytes)}**（存储上限 ${200} 条，超出会丢弃最旧的）`,
    `- 解析状态：${snapshot.corrupted ? "⚠️ **失败（保护模式，已停止写入）**" : "✅ 正常"}`,
    `- 损坏备份：${corruptedBackup ? `有（${corruptedBackup.length} 字符）` : "无"}`,
  ];

  if (snapshot.corrupted) {
    lines.push(
      "",
      "---",
      "",
      "**当前处于保护模式**：历史解析不出来，为避免覆盖原始数据，所有写入都被拒绝。",
      "请用上面的「导出损坏的原始数据」先抢救，确认后再「清除全部历史数据」。",
    );
  } else if (snapshot.conversations.length >= 200) {
    lines.push("", "---", "", "⚠️ 已经到达 200 条上限，**再新增会丢弃最旧的对话**。建议先导出备份。");
  }

  return lines.join("\n");
}

/* ───────────────────────── 换机迁移：文案 ───────────────────────── */

/** 状态行：一眼看出这台机器上有多少「会跟着迁移包走」的东西 */
function migrationSummary(local: LocalSnapshot): string {
  if (!local) return "读取中…";
  const parts = [
    `${local.conversations} 条对话`,
    `${local.presets} 个自定义预设`,
    `${local.promptOverrideCommands.length} 条 prompt 覆盖`,
  ];
  if (local.presetOverrideIds.length > 0) parts.push(`${local.presetOverrideIds.length} 个预设覆盖`);
  return parts.join(" · ");
}

function migrationExportMarkdown(local: LocalSnapshot | null): string {
  const lines = [
    "### 📦 设备迁移包",
    "",
    "把**这台机器上不可重建的数据**打成一个 JSON 文件，到新机器上导入即可。",
    "",
    "**会带走**",
    "",
    "| 内容 | 本机现状 |",
    "|---|---|",
    `| 对话历史 | ${local ? `${local.conversations} 条` : "…"} |`,
    `| 自定义 Preset | ${local ? `${local.presets} 个` : "…"} |`,
    `| 当前选中的 Preset | ${local?.activePreset ?? "…"} |`,
    `| 内置 Preset 覆盖 | ${local ? `${local.presetOverrideIds.length} 个` : "…"} |`,
    `| 命令 Prompt 覆盖 | ${local ? `${local.promptOverrideCommands.length} 条` : "…"} |`,
    "",
    "**刻意不带**",
    "",
    "- **API Key** —— 密钥不跟着文件走，新机器上重填（或用 `DEEPSEEK_API_KEY` / `~/.dsh/.credentials.yaml`）",
    "- Raycast 里的偏好设置（模型 / 思考强度 / 翻译方向等）—— 存在 Raycast 偏好库，没有导入接口，需要新机器上手填一次",
    "",
    "> 迁移包是**普通 JSON**，可丢进 iCloud / Git / 网盘。导入端会自动识别，",
    "> 旧的「只有历史」文件也照样能导入。",
  ];
  return lines.join("\n");
}

/* ───────────────────────── 换机迁移：导出 ───────────────────────── */

/** `ExportResult.items` 在表单里要列出来，做成「打包中」预览 */
function MigrationExportForm({ local }: { local: LocalSnapshot | null }) {
  const { pop } = useNavigation();
  const hasCorrupted = local?.hasCorruptedBackup ?? false;

  return (
    <Form
      navigationTitle="导出设备迁移包"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="打包并导出"
            icon={Icon.Upload}
            onSubmit={async ({ dir, corrupted }: { dir?: string[]; corrupted?: boolean }) => {
              try {
                const result = await buildMigrationBundle({ history: true, corruptedBackup: Boolean(corrupted) });
                if (isEmptyBundle(result)) {
                  await showToast({
                    style: Toast.Style.Failure,
                    title: "没有可迁移的数据",
                    message: "这台机器上还没有历史 / Preset / Prompt 覆盖可打包。",
                  });
                  return;
                }
                const target = dir?.[0] ?? environment.supportPath;
                const file = join(target, `deepseek-quick-migration-${stamp()}.json`);
                await writeFile(file, result.json, "utf8");
                await showToast({
                  style: Toast.Style.Success,
                  title: "已导出迁移包",
                  message:
                    result.items.length > 0
                      ? result.items.map((i) => `${i.label} ${i.count}`).join(" · ")
                      : "包里没有数据",
                });
                await showInFinder(file);
                pop();
              } catch (err) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "导出失败",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description
        title="包含内容"
        text="对话历史、自定义 Preset、当前选中的 Preset、内置 Preset 覆盖、命令 Prompt 覆盖。空的部分不会写进文件。"
      />
      <Form.FilePicker
        id="dir"
        title="导出到"
        info="留空则导出到扩展数据目录，导出后会自动在 Finder 中选中该文件"
        canChooseDirectories
        canChooseFiles={false}
        allowMultipleSelection={false}
      />
      {hasCorrupted ? (
        <Form.Checkbox
          id="corrupted"
          label="一并带上「损坏历史的原始数据」"
          defaultValue={false}
          info="本机检测到历史损坏时抢救下来的原始字符串。体积可能很大，默认不带；只有在需要到新机器上继续抢救时才勾选。"
        />
      ) : null}
    </Form>
  );
}

/* ───────────────────────── 换机迁移：导入 ───────────────────────── */

/**
 * 两段式导入：先选文件 → 出预览 → 确认后才写入。
 *
 * 之所以不一步到位：prompt / 内置预设覆盖是**替换语义**，会盖掉本机同 key 的内容，
 * 这个损失必须在写入前让用户看见。预览顺带承担了「文件是否合法」的校验。
 */
function MigrationImportForm({ onDone }: { onDone: () => Promise<void> }) {
  const [parsed, setParsed] = useState<ParsedBundle>();
  const [plan, setPlan] = useState<ImportPlan>();
  const [busy, setBusy] = useState(false);

  if (parsed && plan) {
    return <MigrationApplyForm parsed={parsed} plan={plan} onDone={onDone} />;
  }

  return (
    <Form
      navigationTitle="导入设备迁移包"
      isLoading={busy}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="解析并预览"
            icon={Icon.Eye}
            onSubmit={async ({ file }: { file?: string[] }) => {
              const path = file?.[0];
              if (!path) {
                await showToast({ style: Toast.Style.Failure, title: "请先选择一个 JSON 文件" });
                return;
              }
              setBusy(true);
              try {
                const text = await readFile(path, "utf8");
                const next = parseMigrationBundle(text);
                setPlan(await planImport(next));
                setParsed(next);
              } catch (err) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "解析失败",
                  message: err instanceof Error ? err.message : String(err),
                });
              } finally {
                setBusy(false);
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="file"
        title="选择迁移包"
        info="支持本扩展导出的迁移包；旧版「只有历史」的导出文件也能导入"
        canChooseFiles
        canChooseDirectories={false}
        allowMultipleSelection={false}
      />
      <Form.Description
        title="下一步"
        text="选好文件后按 ⌘⏎ 解析，会先给你一份改动预览，确认后才写入。"
      />
    </Form>
  );
}

/** 预览 + 确认写入 */
function MigrationApplyForm({
  parsed,
  plan,
  onDone,
}: {
  parsed: ParsedBundle;
  plan: ImportPlan;
  onDone: () => Promise<void>;
}) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="确认导入"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="确认导入"
            icon={Icon.Download}
            onSubmit={async () => {
              try {
                const result = await applyMigrationBundle(parsed);
                await onDone();
                await showToast({
                  style: Toast.Style.Success,
                  title: "导入完成",
                  message: summarizeApply(result),
                });
                pop();
              } catch (err) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "导入失败",
                  message: err instanceof Error ? err.message : String(err),
                });
              }
            }}
          />
          <Action title="返回重选" icon={Icon.ArrowLeft} onAction={pop} />
        </ActionPanel>
      }
    >
      <Form.Description title="改动预览" text={planMarkdown(plan)} />
      {plan.promptOverridesOverwriting.length > 0 || plan.presetOverridesOverwriting.length > 0 ? (
        <Form.Description
          title="⚠️ 会覆盖本机配置"
          text="上面标 ⚠️ 的项会替换这台机器上的同名配置。导入前会自动存一个撤销点，回列表页可以「撤销上一次导入」。"
        />
      ) : null}
      {plan.unknownSections.length > 0 ? (
        <Form.Description
          title="⚠️ 有不认识的字段"
          text={`包里包含当前扩展版本不认识的段：${plan.unknownSections.join("、")}。它可能来自更新的版本，导入不会带上这些内容。`}
        />
      ) : null}
      {plan.legacyHistoryOnly ? (
        <Form.Description
          title="ℹ️ 这是旧版历史文件"
          text="这个文件只含对话历史，不含 Preset 和 prompt 覆盖。如果另一台机器上还导出了「设备迁移包」，用它才能带上配置。"
        />
      ) : null}
    </Form>
  );
}

/** 把 `ImportPlan` 渲染成预览 markdown */
function planMarkdown(plan: ImportPlan): string {
  const lines: string[] = [];

  if (plan.history.incoming > 0) {
    lines.push(
      `**对话历史**：包内 ${plan.history.incoming} 条 → 新增 ${plan.history.added} · 更新 ${
        plan.history.updated
      }（按 id 合并，不清空本机）`,
    );
  }
  if (plan.presets.incoming > 0) {
    lines.push(
      `**自定义 Preset**：包内 ${plan.presets.incoming} 个 → 新增 ${plan.presets.added} · 更新 ${plan.presets.updated}`,
    );
  }
  if (plan.activePreset) {
    lines.push(`**当前选中的 Preset**：${plan.activePreset.from ?? "（未设置）"} → \`${plan.activePreset.to}\``);
  }
  if (plan.promptOverrides.length > 0) {
    lines.push(
      `**命令 Prompt 覆盖**：${plan.promptOverrides.length} 条 —— ${plan.promptOverrides
        .map((c) => (plan.promptOverridesOverwriting.includes(c) ? `⚠️ ${c}` : c))
        .join("、")}`,
    );
  }
  if (plan.presetOverrides.length > 0) {
    lines.push(
      `**内置 Preset 覆盖**：${plan.presetOverrides.length} 个 —— ${plan.presetOverrides
        .map((id) => (plan.presetOverridesOverwriting.includes(id) ? `⚠️ ${id}` : id))
        .join("、")}`,
    );
  }
  if (plan.presetIdConflicts.length > 0) {
    lines.push(
      `⚠️ **预设 id 冲突**：\`${plan.presetIdConflicts.join("`、`")}\` 在包里出现多次，` +
        "时间戳更新的那条会胜出，可能导致某些历史对话指向的预设内容变了。",
    );
  }
  if (plan.corruptedBackup) {
    lines.push(
      `**损坏历史原始数据**：${plan.corruptedBackup.chars} 字符${
        plan.corruptedBackup.overwriting ? "（⚠️ 本机已有一份，本机的不会被覆盖）" : "（本机没有，将恢复）"
      }`,
    );
  }

  if (lines.length === 0) return "这个包里没有可导入的内容。";

  lines.push("", "---", `迁移包版本：v${plan.bundleVersion}${plan.legacyHistoryOnly ? " · 旧格式（仅历史）" : ""}`);
  return lines.join("\n");
}

function summarizeApply(result: {
  history: { added: number; updated: number; total: number } | null;
  presets: { added: number; updated: number; total: number } | null;
  promptOverrides: number;
  presetOverrides: number;
  activePresetApplied: string | null;
}): string {
  const parts: string[] = [];
  if (result.history) parts.push(`历史 +${result.history.added} / ~${result.history.updated}`);
  if (result.presets) parts.push(`预设 +${result.presets.added} / ~${result.presets.updated}`);
  if (result.promptOverrides > 0) parts.push(`prompt ${result.promptOverrides}`);
  if (result.presetOverrides > 0) parts.push(`预设覆盖 ${result.presetOverrides}`);
  if (result.activePresetApplied) parts.push("已切到包里的预设");
  return parts.length > 0 ? parts.join(" · ") : "没有内容被写入";
}

function formatBytes(chars: number): string {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / 1024 / 1024).toFixed(2)} MB`;
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
