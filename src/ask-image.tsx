import { Action, ActionPanel, Detail, Form, getSelectedFinderItems } from "@raycast/api";
import { useEffect, useState } from "react";
import { imagePart, textPart } from "./lib/deepseek";
import { prefs } from "./lib/config";
import { IMAGE_SYSTEM } from "./lib/prompts";
import { resolveSystemPrompt } from "./lib/prompt-config";
import { isImagePath, toDataUri } from "./lib/images";
import { ResultView, type ResultRun } from "./components/result-view";

export default function Command() {
  const [images, setImages] = useState<string[] | null>(null);
  /** 这条命令生效的 system prompt（可能被 Configure Prompts 覆盖） */
  const [systemPrompt, setSystemPrompt] = useState(IMAGE_SYSTEM);
  const [error, setError] = useState<string>();
  const [run, setRun] = useState<ResultRun | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [items, system] = await Promise.all([
          getSelectedFinderItems(),
          resolveSystemPrompt("ask-image", IMAGE_SYSTEM),
        ]);
        setSystemPrompt(system);

        const paths = items.map((item) => item.path).filter(isImagePath);
        if (paths.length === 0) {
          setError("请在 Finder 里选中一张图片（png / jpg / webp / gif / bmp）。");
          return;
        }
        setImages(await Promise.all(paths.map(toDataUri)));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (error) return <Detail markdown={`### 无法读取图片\n\n${error}`} />;
  if (!images) return <Detail isLoading markdown="" />;
  if (run) return <ResultView title="看图问答" run={run} />;

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="提问"
            onSubmit={({ question }: { question?: string }) => {
              const p = prefs();
              setRun({
                system: systemPrompt,
                user: [textPart(question?.trim() || "描述这张图片。"), ...images.map(imagePart)],
                model: p.model,
                effort: p.quickActionEffort,
                // 不开放「换模型 / 强度重新生成」：换到不带 vision 的模型会直接失败
              });
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="question" title="问题" defaultValue="描述这张图片" autoFocus />
      <Form.Description title="图片" text={`已读取 ${images.length} 张`} />
    </Form>
  );
}
