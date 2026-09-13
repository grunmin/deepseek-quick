import { AgentView } from "./components/agent-view";

/**
 * Agent 命令入口。
 *
 * 这里必须是**同步**组件（约束 9）：`mode: "view"` 的命令返回 Promise 会让 Raycast
 * 反复重挂载。所有异步（spawn agent、握手、开会话）都在 `AgentView` 的 effect 里做。
 */
export default function Command() {
  return <AgentView />;
}
