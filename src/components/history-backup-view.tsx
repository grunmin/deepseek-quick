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

  const reload = useCallback(async () => {
    setSnapshot(await readHistory());
    setCorruptedBackup(await readCorruptedBackup());
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
