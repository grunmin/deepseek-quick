import { REWRITE_SYSTEM } from "./lib/prompts";
import { QuickAction } from "./components/quick-action";

export default function Command() {
  return (
    <QuickAction
      command="rewrite"
      title="改写 / 润色"
      system={REWRITE_SYSTEM}
      buildUser={(selection) => `请改写下面这段文本：\n\n${selection}`}
    />
  );
}
