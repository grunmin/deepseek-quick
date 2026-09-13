import { ChatView } from "./components/chat-view";
import { seekSelection } from "./lib/selection";

/**
 * 「带着选区开聊」：读取当前选中的文字 / Finder 里选中的图片，
 * 直接预填到对话输入框（不自动发送，留给自己补一句问题，或直接 ↵ 发出去）。
 *
 * 选区在 ChatView 渲染之前读，避免和聊天窗口抢焦点。
 */
export default async function Command() {
  const selection = await seekSelection();
  return <ChatView title="和选中内容对话" prefillText={selection.text} prefillImages={selection.images} />;
}
