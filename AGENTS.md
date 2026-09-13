# AGENTS.md

面向 **AI 编码助手**（Claude Code / Cursor / Zed / Copilot / Codex 等）与**人类贡献者**的工程说明。

- 想了解**怎么安装、怎么用** → 看 [README.md](./README.md)
- 想了解**怎么改、哪些地方不能乱改** → 看本文

---

## 项目一句话

一个 macOS **Raycast 扩展**：读取当前选区文本（或 Finder 里的图片），直连 DeepSeek API，
提供 解释 / 翻译 / 改写 / 看图 / 多轮对话，并本地保存历史。

## 技术栈

| 项 | 值 |
|---|---|
| 语言 | TypeScript（`strict: true`，`isolatedModules`） |
| UI | React 19 + `@raycast/api` 2.3.1（**没有 DOM / CSS**，只有 Raycast 组件） |
| JSX | `react-jsx`（无需 `import React`） |
| 构建 | Raycast CLI（内部用 esbuild），入口是 `package.json` 里的 `commands` |
| 运行环境 | Raycast 桌面端内嵌的 Node 运行时；`node:fs` / `fetch` 均可用 |
| 测试 | **无测试框架**。验证 = `npx tsc --noEmit` + `npm run lint` + 手动跑命令 |

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # ray develop：导入 Raycast + 热更新（日常开发用这个）
npm run build      # ray build -e dist：构建到 dist/
npm run lint       # ray lint
npm run fix-lint   # ray lint --fix
npx tsc --noEmit   # 类型检查，CI 友好、无副作用
```

> `npm run dev` 会**自动生成 `raycast-env.d.ts`**（内容来自 `package.json`）。该文件已在
> `.gitignore` 里，**永远不要手动编辑它** —— 改 `package.json` 即可。
>
> **改完代码的验收顺序**：`npx tsc --noEmit` → `npm run lint` → 在 Raycast 里手动跑一遍对应命令。

## 目录地图

```
src/
  lib/
    config.ts        偏好设置解析（prefs()）+ API Key 三级回退（apiKey()）
    deepseek.ts      SSE 流式客户端 streamChat()、ContentPart/imagePart/textPart/messageText
    prompts.ts       各命令的 system prompt（纯字符串常量，无逻辑）
    history.ts       LocalStorage 会话存储：list/save/delete/clear，剥图片、限 200 条
    images.ts        图片文件路径 → data URI（isImagePath / toDataUri）
    selection.ts     seekSelection()：统一读取「当前选区」（文字优先，否则 Finder 图片）
    use-stream.ts    useStream()：单次流式请求的 React hook（80ms 节流 + 去重）
    debug.ts         dbg()：追加写 /tmp/dsq-debug.log（临时调试用，可整体删除）
  components/
    quick-action.tsx 快捷命令通用外壳：读选区 → 组装 messages → ResultView
    result-view.tsx  结果页：流式渲染 + 主操作（替换/复制）+ ⌘N 继续讨论
    chat-view.tsx    对话主界面（搜索栏当输入框）+ 会话切换/删除 + 附件表单
    history-view.tsx 两栏历史浏览器（List.isShowingDetail）
  explain.tsx / translate.tsx / rewrite.tsx / ask-image.tsx /
  chat.tsx / chat-selection.tsx / history.tsx      ← 7 个命令入口，文件名 = command name
```

**入口约定**：`package.json` → `commands[].name` 必须与 `src/<name>.tsx` 的**文件名**一致，
且该文件 **default export** 一个 React 组件（`chat-selection.tsx` 是唯一例外：default export 一个
`async` 函数，因为要在渲染前读选区）。

## 架构与数据流

### 1. 快捷命令链路（explain / translate / rewrite）

```
用户选文本 → 按热键
  → src/explain.tsx 渲染 <QuickAction>
  → quick-action.tsx: getSelectedText()  → messages = [system, user]
  → result-view.tsx: useStream(messages, { effort: prefs().quickActionEffort })
  → use-stream.ts: streamChat() SSE → 节流 setState
  → Detail markdown 流式渲染
  → 主操作 ↵ ：Clipboard.paste() 替换原文 / CopyToClipboard
  → ⌘N ：<ChatView initialMessages={[...messages, assistant]} />
```

### 2. 对话链路（chat / chat-selection）

```
chat.tsx → <ChatView>
  - List(filtering={false}) 的**搜索栏 = 输入框**（searchText=draft, onSearchTextChange=setDraft）
  - 左侧 List.Item = 会话列表；右侧 List.Item.Detail = 当前会话 Markdown
  - ↵ 主操作 → send(draft) → streamChat → saveConversation → 刷新列表 → setCurrentId
```

- 每条消息都是 `ChatMessage`；带图消息的 `content` 是 `ContentPart[]`。
- **流式中间态**放在 `pending`，不写进 `messages`；流结束才 append 成完整 assistant 消息。
- 图片只在发送时转 base64；**存历史前会剥掉**（见约束 6）。

### 3. 历史存储

- Key：`deepseek-quick.conversations`，整个数组 JSON 序列化后放 `LocalStorage`。
- 保存时 `stripImages()` 把 `image_url` 换成 `[图片]` 占位。
- 容量上限 `MAX_CONVERSATIONS = 200`，按 `updatedAt` 倒序保留最新的 200 条。
- 标题由第一条 user 消息派生，截断到 60 字符（`deriveTitle`）。

### 4. 选区读取

`seekSelection()` 是统一入口，两个来源**互斥**：

1. 先 `getSelectedText()`，若成功且**不像图片路径** → 返回文字。
2. 否则 `getSelectedFinderItems()` 过滤图片扩展名 → 转 data URI 返回。

> 为什么第 1 步要判断「像不像图片路径」：Finder 里选中图片时，系统剪贴板通常给出**文件路径列表**，
> 必须忽略掉，否则会把路径当正文发给模型。

### 5. 流式协议

`streamChat()` 手写 SSE 解析（不用 SDK）：

- POST `{apiEndpoint}/chat/completions`，`stream: true` + `stream_options.include_usage: true`。
- 逐行读 `data:`，忽略 `[DONE]`，`JSON.parse` 失败就跳过（容忍半包/心跳）。
- `choices[0].delta.content` → 正文；`choices[0].delta.reasoning_content` → 思考链（两者分开累积）。
- 末尾 `usage` 取出 token 用量。

## 硬性约束（Invariants）—— 改代码前必读

以下每一条都是**实测踩坑后修好的**，改动时不要改回去。

### 1. `useStream` 的 effect cleanup 里**绝对不能** `abort()`

React（StrictMode / dev）会跑 `effect → cleanup → effect`。若在 cleanup 里 abort，
第一次请求会被立刻掐断，而 `startedRef` 又挡住了第二次 —— **界面永远空白**。
取消只能由用户显式触发的 `stop()` 负责。（`src/lib/use-stream.ts:96-101`）

### 2. `⌘↵` 和 `⌘C` 是 Raycast **保留键**

给 `Action` 显式设这些 shortcut 会抛错：
`The shortcut prop provided to the Action ... is reserved by Raycast and has been removed.`
抛错会触发 React 重挂载 → 又走到约束 1 的 cleanup → 请求被 abort。

> **正确做法**：把主操作放在 `ActionPanel` 的**第一位**，Raycast 会自动给它绑 `↵`。

### 3. 流式 `setState` 必须**节流 + 去重**

否则内容没变也会每 80ms 重渲染，Raycast 会警告
`Looks like the command is rendering a lot without any changes`，严重时会
"arbitrarily decide to terminate the extension"。

见 `use-stream.ts` 的 `pushedContent` / `pushedReasoning` 哨兵值，以及 `chat-view.tsx` 的 `flush()`。

### 4. **deeplink 启动拿不到选中文本**

用 `raycast://` 启动命令时 `getSelectedText()` 会报
`Unable to retrieve selected text via clipboard`。
这正是必须用**原生热键**、而不能用 Quicklink + deeplink 的原因。

### 5. 关闭思考要用 `thinking:{"type":"disabled"}`

DeepSeek 的 `reasoning_effort` 只接受 `low` / `high` / `max`（默认 `high`，`medium` 被映射成 `high`）。
传 `reasoning_effort: "none"` **不会**关闭思考。`none` 档必须走 `thinking.disabled`。
（`src/lib/deepseek.ts:50-56`）

### 6. 写历史前必须剥掉图片 base64

否则几条带图对话就会把 `LocalStorage` 撑爆。见 `history.ts` 的 `stripImages()`。

### 7. `ChatView` 必须 `loaded` 之后才渲染列表条目

否则 `selectedItemId` 会指向一个尚不存在的会话，Raycast 会把它弹回第一项（视觉上「跳一下」）。

### 8. 切换 / 删除会话时必须作废在途请求

`switchTo()` 和 `removeConversation()` 都要 `runTokenRef.current += 1` 并 `abort()`，
否则旧请求的结果会覆盖新会话的内容（`stale()` 守卫）。

## 常见任务

### 新增一条快捷命令（例：Summarize）

1. **加 prompt** — `src/lib/prompts.ts`：

   ```ts
   export const SUMMARIZE_SYSTEM = ["你是一个总结助手。", "", "要求：", "- 用 3 条以内的要点概括。"].join("\n");
   ```

2. **加入口** — 新建 `src/summarize.tsx`（文件名必须 = command name）：

   ```tsx
   import { SUMMARIZE_SYSTEM } from "./lib/prompts";
   import { QuickAction } from "./components/quick-action";

   export default function Command() {
     return (
       <QuickAction
         title="总结选中文本"
         system={SUMMARIZE_SYSTEM}
         buildUser={(selection) => `请总结下面这段文本：\n\n${selection}`}
       />
     );
   }
   ```

3. **注册 manifest** — `package.json` 的 `commands` 数组追加：

   ```json
   {
     "name": "summarize",
     "title": "Summarize Selection",
     "subtitle": "DeepSeek",
     "description": "总结选中的文本",
     "mode": "view"
   }
   ```

4. `npm run dev`（重新生成类型）→ 在 Raycast 里验收。热键由用户在 Raycast 设置里自己绑。

> 需要读图的命令参考 `ask-image.tsx`（它自己处理 `getSelectedFinderItems` + `Form` 提问，
> 最后仍然复用 `ResultView`）。

### 修改某个命令的 prompt

只改 `src/lib/prompts.ts` 里的常量即可，无逻辑耦合。注意 prompt 里已声明「用 Markdown」等约定，
保持风格一致。

### 新增一个配置项

1. `package.json` → `preferences` 加一项（要有 `name` / `title` / `type`）。
2. `src/lib/config.ts` → `ExtensionPreferences` 接口加字段，并在 `prefs()` 里给出默认值与规整逻辑
   （参考 `asEffort()` / endpoint 去尾斜杠的写法）。
3. 使用处通过 `prefs()` 读取 —— **不要**散落调用 `getPreferenceValues()`。

### 换模型 / 接别的 OpenAI 兼容端点

改扩展设置里的 **Model** / **API Endpoint** 即可，代码无需改动。
`deepseek-v4-pro` 已验证可用。端点不要带 `/chat/completions`（代码会自动拼）。

### 调整历史容量

`src/lib/history.ts` 的 `MAX_CONVERSATIONS`。注意这是**整个数组**一起序列化，
条数过多会让每次读写变慢。

## 数据模型速查

```ts
type Effort = "none" | "low" | "high" | "max";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];       // 带图时是数组
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };  // url 是 data:...;base64,...

interface Conversation {
  id: string;            // `c_<ts>_<rand>`
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];   // 已剥图
}

interface Selection { text: string; images: string[] }   // images 是 data URI
```

## 调试

- **文件日志**：所有请求/响应摘要写到 `/tmp/dsq-debug.log`（`src/lib/debug.ts` 的 `dbg()`）。
  ```bash
  tail -f /tmp/dsq-debug.log
  ```
  里面能看到 endpoint / model / effort / 消息数 / HTTP 状态 / 返回长度 / token 用量。
- **清理**：排查完想删掉日志机制，删 `src/lib/debug.ts` 及所有 `dbg(` 调用即可，无其它耦合。
- **Raycast 开发者工具**：`npm run dev` 后可在 Raycast 里对扩展开 "Show Extension Logs"。

## 代码风格与提交约定

- **注释用中文**，且解释 **「为什么」** 而不是「做了什么」—— 本仓库的注释偏重踩坑原因。
- 保持 UI 文案的中文风格与现有命令一致（简短、动词开头）。
- **不要擅自引入新依赖**：能用手写 SSE / 原生 `fetch` 解决的就不要加 SDK。
- 文件命名：命令入口 `kebab-case.tsx`；组件 `PascalCase` 导出但文件名 `kebab-case.tsx`。
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
  `feat(chat): ...` / `fix(stream): ...` / `docs: ...` / `refactor: ...` / `chore: ...`
- 分支：`feat/*`、`fix/*`、`docs/*`。
- **提交前必做**：`npx tsc --noEmit` 和 `npm run lint` 都通过。
- **绝不要提交**：API Key、`.raycast/`、`raycast-env.d.ts`、`node_modules/`、`dist/`、`/tmp` 日志。

## 改动自检清单

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run lint` 通过
- [ ] 在 Raycast 里手动跑过受影响的命令（`npm run dev`）
- [ ] 没有触碰上面 8 条硬性约束
- [ ] 没有把 Key / 生成文件带进提交（`git status` 确认）
- [ ] 新增命令时，文件名 = `package.json` 的 command name
