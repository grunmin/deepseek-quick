import { EXPLAIN_SYSTEM } from "./lib/prompts";
import { QuickAction } from "./components/quick-action";

export default function Command() {
  return (
    <QuickAction
      command="explain"
      title="解释选中文本"
      system={EXPLAIN_SYSTEM}
      buildUser={(selection) => `请解释下面这段文本：\n\n${selection}`}
    />
  );
}
