import { closeMainWindow, launchCommand, LaunchType, showToast, Toast } from "@raycast/api";
import { seekSelection } from "./lib/selection";

/**
 * 「带着选区开聊」——no-view 命令，先关窗口再读选区，然后拉起 Chat 并把内容作为**参考内容**带过去。
 *
 * 为什么必须是 no-view：
 *  `getSelectedText()` 读的是**最前台 App** 的选中文本。命令一启动 Raycast 就是
 *  最前台，此时读只会拿到空字符串（官方文档 + raycast/extensions#11793）。
 *  只有把窗口关掉、焦点还给原来的 App，才读得到。而 view 命令的窗口在读完之前
 *  就抢走了焦点，所以读文字这件事只能发生在「窗口关掉、扩展还没渲染 UI」的窗口期，
 *  也就是 no-view 命令。
 */
export default async function Command() {
  await closeMainWindow();

  const selection = await seekSelection();

  if (!selection.text && selection.images.length === 0) {
    await showToast({
      style: Toast.Style.Failure,
      title: "没读到选中内容",
      message: "先在别的 App 里选中文字，或在 Finder 里选中图片",
    });
    return;
  }

  await launchCommand({
    name: "chat",
    type: LaunchType.UserInitiated,
    context: { reference: selection.text, referenceImages: selection.images },
  });
}
