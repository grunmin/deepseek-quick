import { RUN_PROMPT_SYSTEM } from "./lib/prompts";
import { QuickAction } from "./components/quick-action";

/** 选中的文本就是 prompt 本身，不需要再包一层「请解释下面这段」 */
const asPrompt = (selection: string) => selection;

/**
 * 把选中的文本当作 prompt 直接执行。
 *
 * 与 explain / translate / rewrite 的区别：那三条是「选中内容 + 固定指令」，
 * 这条是「选中内容 **就是** 指令」，所以 user 消息原样发送，只由 system prompt 约束回答风格。
 * 典型用法：从笔记 / 网页里选中一段写好的 prompt，直接跑。
 */
export default function Command() {
  return (
    <QuickAction command="run-prompt" title="执行 Prompt" system={RUN_PROMPT_SYSTEM} buildUser={asPrompt} />
  );
}
