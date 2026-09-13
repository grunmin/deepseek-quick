import { prefs } from "./lib/config";
import {
  TRANSLATE_SYSTEM_BIDIRECTIONAL,
  translateBidirectionalUser,
  translateSystem,
  translateUser,
} from "./lib/prompts";
import { QuickAction } from "./components/quick-action";

/**
 * 翻译命令，两种模式：
 *   - 中英互译（默认，偏好 translateBidirectional = 开）：由模型判断方向，中文→英文 / 英文→中文
 *   - 指定目标语言（关掉上面那项之后）：用偏好 Translate To
 */
export default function Command() {
  const { translateBidirectional, translateTo } = prefs();

  return translateBidirectional ? (
    <QuickAction
      command="translate"
      title="中英互译"
      system={TRANSLATE_SYSTEM_BIDIRECTIONAL}
      buildUser={translateBidirectionalUser}
    />
  ) : (
    <QuickAction
      command="translate"
      title={`翻译成${translateTo}`}
      system={translateSystem(translateTo)}
      buildUser={(selection) => translateUser(selection, translateTo)}
    />
  );
}
