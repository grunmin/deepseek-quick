import type { LaunchProps } from "@raycast/api";
import { ChatView } from "./components/chat-view";

interface ChatLaunchContext {
  reference?: string;
  referenceImages?: string[];
}

/**
 * Chat 命令。正常进来是空对话；
 * 从 `Chat with Selection` 通过 launchContext 进来时，会把读到的选区作为**参考内容**挂上。
 */
export default function Command(props: LaunchProps<{ launchContext?: ChatLaunchContext }>) {
  const context = props.launchContext;

  return (
    <ChatView
      reference={context?.reference ?? ""}
      referenceImages={context?.referenceImages ?? []}
    />
  );
}
