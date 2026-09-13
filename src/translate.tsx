import { prefs } from "./lib/config";
import { translateSystem, translateUser } from "./lib/prompts";
import { QuickAction } from "./components/quick-action";

export default function Command() {
  const target = prefs().translateTo;
  return (
    <QuickAction
      command="translate"
      title={`翻译成${target}`}
      system={translateSystem(target)}
      buildUser={(selection) => translateUser(selection, target)}
    />
  );
}
