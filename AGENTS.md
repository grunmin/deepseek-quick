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
    config.ts        偏好解析 prefs()（扩展级 + 命令级覆盖）+ API Key 三级回退（apiKey()）
    deepseek.ts      SSE 流式客户端 streamChat()、ContentPart/imagePart/textPart/messageText
    prompts.ts       各命令的**内置** system prompt（纯字符串常量，无逻辑）
    history.ts       LocalStorage 历史存储：read/save/delete/import + **损坏保护**、剥图片、限 200 条
    images.ts        图片文件路径 → data URI（isImagePath / toDataUri）
    selection.ts     seekSelection()：统一读取「当前选区」（文字优先，否则 Finder 图片）
    prompt-config.ts 每命令 system prompt 覆盖（LocalStorage）+ resolveSystemPrompt()
    use-stream.ts    useStream()：单次流式请求的 React hook（80ms 节流 + 去重）
    debug.ts         dbg()：追加写 /tmp/dsq-debug.log（临时调试用，可整体删除）
  components/
    quick-action.tsx 快捷命令通用外壳：读选区 + 解析本命令 prompt → 组装 messages → ResultView
    result-view.tsx  结果页：流式渲染 + 主操作（替换/复制）+ ⌘N 继续讨论
    chat-view.tsx    对话主界面（搜索栏当输入框）+ 会话切换/删除 + 附件表单
    history-view.tsx 两栏历史浏览器（List.isShowingDetail）
    prompt-config-view.tsx  Configure Prompts 界面（List + 多行 Form.TextArea）
    history-backup-view.tsx Backup History：导出 / 导入 / 损坏抢救
  explain.tsx / translate.tsx / rewrite.tsx / ask-image.tsx / chat.tsx /
  chat-selection.tsx / history.tsx / configure.tsx / backup.tsx   ← 9 个命令入口，文件名 = command name
```

**入口约定**：`package.json` → `commands[].name` 必须与 `src/<name>.tsx` 的**文件名**一致。
`mode: "view"` 的命令 default export 一个 **同步** React 组件；`mode: "no-view"` 的命令
default export 一个 async 函数（参考 `chat-selection.tsx`）。

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
  - 列表里只有**一个锚点条目**（id="__transcript"），它的 List.Item.Detail = 整个对话 Markdown
  - 会话列表搬进 searchBarAccessory 的 `List.Dropdown`（⌘P 打开），选中即 switchTo
  - ↵ 主操作 → send(draft) → streamChat → saveConversation → 刷新下拉 → setCurrentId
```

> **为什么不做成「每个会话一个 List.Item」**（见约束 7）：`List` 行高固定且现在是
> `white-space: nowrap`，一行放不下对话内容；而 `List + Detail` 的分栏比例由 Raycast 内部固定，
> 扩展无法调整。所以把整个对话放进详情区（占满宽度），列表退化成锚点。

**带选区进来**（`chat-selection`，`mode: "no-view"`）：

```
Chat with Selection（热键）
  → chat-selection.tsx: await closeMainWindow()   ← 必须，否则读不到（见约束 10）
  → seekSelection(): getSelectedText() → 否则 getSelectedFinderItems()
  → launchCommand({ name: "chat", context: { reference, referenceImages } })
  → chat.tsx 从 props.launchContext 取出 → <ChatView reference referenceImages />
  → ChatView: 选区作为 📎 参考内容显示在详情面板，搜索栏保持空白
  → 用户输入问题 → send() 把参考内容包成 user 消息、拼在问题前面一起提交
```

> **参考内容 ≠ prompt**（见约束 11）。选区**不能**塞进搜索栏当草稿 —— 搜索栏是 `List`
> 唯一的输入位，被参考内容占住后用户就没地方输入自己的问题了。
> 参考内容只显示在右侧详情面板，由 `send()` 在提交时拼进消息。
>
> 为什么不做成「Chat 界面里按个键读选区」：Chat 是 view 命令，窗口一起就已经是前台，
> `getSelectedText()` 必然返回空。读文字只能在「窗口已关、UI 还没渲染」的窗口期完成，
> 也就是 no-view 命令。**不要**试图在 ChatView 里加读文字的动作，那条路走不通。

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

**用量字段别当 bug 看**（都是实测结论）：

- `prompt_tokens_details.cached_tokens` = 缓存命中数，与 DeepSeek 原生的
  `prompt_cache_hit_tokens` 同值（两个字段都会返回）。缓存要求**前缀从第 0 个 token 起完整相同**、
  已落盘、且能作为独立单元完整匹配，存储单位 64 tokens，但实际门槛远高于此：
  实测 136 tokens 连试 3 次全 0，2937 tokens 第 2 次才命中 2688。
  **所以短选中文本恒为 0 是正常的**，不要试图"修"。
- `completion_tokens_details.reasoning_tokens`：快捷命令默认 `thinking: disabled`，
  DeepSeek 响应里**根本没有这个字段**，显示 0 是对的；只有 `reasoning_effort` 档位才会有
  （实测 `low` → 446）。
- `result-view.tsx` 的 `formatUsage()` **只在非零时**才追加这两项，避免"看着像坏了"。

### 6. 配置解析（模型 / 思考强度 / Prompt）

三个维度的来源不同，改代码时别混：

| 维度 | 存放位置 | 读取方式 |
|---|---|---|
| model、思考强度 | `package.json` → `commands[].preferences`（Raycast **原生命令级偏好**） | `prefs()` |
| system prompt | LocalStorage（`prompt-config.ts`，键 `deepseek-quick.prompt-overrides`） | `resolveSystemPrompt(command, builtin)` |
| apiKey / endpoint / translateTo / 输出行为 | 扩展级 `preferences` | `prefs()` |

**model / 强度**：`getPreferenceValues()` 返回的是**当前命令作用域**的合并结果 ——
Raycast 让命令级偏好自动继承扩展级。所以 `prefs()` **不需要知道现在跑的是哪条命令**，
它只做三级回落：

```ts
p.modelOverride?.trim() || p.model?.trim() || "deepseek-flash"
asOptionalEffort(p.effortOverride) ?? asEffort(p.quickActionEffort /* 或 reasoningEffort */, ...)
```

**prompt**：每个入口把 `command` 传给 `QuickAction`，由它调
`resolveSystemPrompt(command, BUILTIN)` 拿生效值。`ask-image.tsx` 和 `chat-view.tsx`
不经过 `QuickAction`，各自解析。解析失败一律**静默回落到内置 prompt**（配置读不出来不该让命令挂掉）。

> ⚠️ `translate` 比较特殊：它有**两个**内置 prompt（中英互译 / 指定目标语言），由偏好
> `translateBidirectional` 决定用哪个。`prompt-config-view.tsx` 的 `builtinPrompt("translate")`
> 和 `translate.tsx` 必须用**同一套判断**，否则「Configure Prompts」里预览到的「内置」
> 会和实际发给模型的不一致。

## 硬性约束（Invariants）—— 改代码前必读

以下每一条都是**实测踩坑后修好的**，改动时不要改回去。

### 1. `useStream` 的 effect cleanup 里**绝对不能** `abort()`

React（StrictMode / dev）会跑 `effect → cleanup → effect`。若在 cleanup 里 abort，
第一次请求会被立刻掐断，而 `startedRef` 又挡住了第二次 —— **界面永远空白**。
取消只能由用户显式触发的 `stop()` 负责。（`src/lib/use-stream.ts:96-101`）

### 2. `⌘↵`、`⌘C`、`⌘,` 是 Raycast **保留键**

给 `Action` 显式设保留键会被 Raycast 丢掉并报错：

> The `shortcut` prop provided to the Action `...` is reserved by Raycast and has been removed.
> Please use another shortcut instead of `{"modifiers":["cmd"],"key":","}`.

后果有**两层**，第二层尤其烦人：

1. 抛错会触发 React 重挂载 → 走到约束 1 的 cleanup → 请求被 abort。
2. 只要命令报过错，Raycast 会给这个扩展挂上**错误图标** —— 窗口左下角那个
   **红色三角感叹号**。它不会自己消失，要改完代码重启 `ray develop` 才消。

- **已知保留**：`⌘↵`（主操作）、`⌘C`（复制）、`⌘,`（Raycast 偏好设置）
- **实测可用**：`⌘N` / `⌘Z` / `⌘X` / `⌘⇧R` / `⌘⇧⌫` / `⌘⇧I` / `⌘⇧H` / `⌘⇧C` / `⌘⌥C`

> **正确做法**：把主操作放在 `ActionPanel` 的**第一位**，Raycast 会自动给它绑 `↵`；
> 其余动作如果可能撞上保留键，就干脆不设 shortcut，靠 `⌘K` 面板触发。
> 拿不准时先跑一遍命令，看 `~/.config/raycast/extensions/<name>/dev.log` 有没有
> `reserved by Raycast` 的报错。

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

### 7. 聊天界面必须是「单锚点 + 满宽详情」，不能每个会话一行

两个硬约束叠在一起：

- `List` 的行**高度固定**，且 `standard-list-item__root` 是 `white-space: nowrap`、
  `__subtitle` 是 `text-overflow: ellipsis` —— **一行放不下对话内容**，长回复会被截断。
- `List + Detail` 的分栏比例由 Raycast 原生 UI 固定，**没有 API 可调**
  （`List` 只有 `isShowingDetail?: boolean`，社区请求 SplitView 未实现：
  [raycast/extensions#83](https://github.com/raycast/extensions/issues/83)）。

所以 ChatView 只渲染**一个锚点 `List.Item`**，整个对话放在它的 `List.Item.Detail` 里；
会话切换走 `searchBarAccessory` 的 `List.Dropdown`。
另外 `loaded` 之后才渲染条目 —— 否则下拉和锚点会先落到空数据上，视觉上跳一下。

### 8. 切换会话 / 开新对话时必须作废在途请求

`switchTo()` 与 `startNewChat()` 都要经过 `resetTransient()` 做 `runTokenRef.current += 1`
并 `abort()`，否则旧请求的结果会覆盖新会话的内容（`stale()` 守卫）。
删除会话已不在 Chat 内（改由 `history-view.tsx` 负责），所以这里不再涉及 `removeConversation()`。

### 9. `mode: "view"` 的命令**绝不能**用 `async` 主函数

Raycast 会直接拒绝：

> Async main functions for 'view' or 'menu-bar' commands are unspecified behavior -
> use a function that returns a view component or declare the command with mode "no-view".

实测后果不是「报错退出」，而是命令被反复重挂载：一秒内 `seekSelection()` 被调用 **2860 次**，
日志刷爆、界面异常。需要「渲染前先异步拿数据」的场景，正确做法是
**声明成 `mode: "no-view"`**（见约束 10 的链路），而不是把组件写成 async。

### 10. `getSelectedText()` 读的是**最前台 App**，Raycast 在前台时必然拿到空串

官方文档原文：*Gets the selected text of the **frontmost application***。
所以只要 Raycast 窗口在前台（命令一启动就是），读出来就是 `""` 或被 reject ——
参见 [raycast/extensions#11793](https://github.com/raycast/extensions/issues/11793)、
[#23132](https://github.com/raycast/extensions/issues/23132)。

**正确姿势**：先 `await closeMainWindow()`，把焦点还给用户原来的 App，再读。
`chat-selection.tsx` 就是这么做的；`QuickAction`（explain/translate/rewrite）能工作，
是因为它们在命令启动的**早期**读，此时窗口还没抢走焦点。

> 这条和约束 4（deeplink 拿不到选区）是**两个不同的坑**，别混。
> `getSelectedFinderItems()` 不受此限制 —— Finder 选区与焦点无关，任何时候都能读。

### 11. 参考内容（reference）不能占用输入框

`Chat with Selection` 带进来的选区是**背景资料**，不是 prompt。搜索栏是 `List` 唯一的输入位，
一旦把参考内容写进 `draft`，用户就没地方输入自己的问题了。

正确做法（`chat-view.tsx`）：

- 参考内容存在独立的 `referenceBlock` state，只渲染在详情面板（`referenceMarkdown()`，超 14 行截断预览）。
- 用户的问题留在搜索栏。发送时由 `send()` 用 `wrapReference()` 把参考内容包成
  「背景资料 + 问题」的 user 消息，**只在首条**带上；发送后清空 `referenceBlock`（已进历史）。
- 需要移除时走 `⌘⇧R` / `⌘K` → 移除参考内容。

### 12. Raycast UI 的硬限制（别浪费时间找开关）

- `List` 行：固定行高 + `nowrap`，**无法显示多行长文本**。
- `List.isShowingDetail` 的分栏比例：**固定，不可调**。
- `Detail`：可以满宽 + Markdown + 滚动，但**没有任何输入能力**（搜索栏是 `List` 独有的）。
- 「满宽 / 可读长文本 / 有输入框」三者只能同时满足两个，ChatView 选的是
  「满宽 + 可读」，输入靠 `List` 的搜索栏，导航靠下拉。

### 13. 命令级偏好**不能**与扩展级同名

Raycast 的规则是「命令级偏好继承扩展级，并覆盖**同名**项」。但覆盖是连同该字段的
`default` 一起生效的：如果在每条命令里都声明 `model` 且带 `default: "deepseek-flash"`，
用户在扩展设置里把全局 Model 改成 `deepseek-v4-pro` 后，**每条命令仍会用自己的默认值** ——
全局设置直接失效。

正确做法：命令级一律用 `modelOverride` / `effortOverride` 这类**不同名**字段（不带 default，
或 default 用 `"inherit"` 这类哨兵值），再由 `prefs()` 显式做「空则回落」。
新增命令级偏好时必须遵守。

### 14. 历史解析失败**绝不能**当成「空历史」

历史是 **read-modify-write**：`saveConversation` 先 `readAll()` 再整体写回。所以一旦在解析
失败时返回 `[]`，下一次保存就会把原始数据**永久覆盖** —— 旧版 `catch { return []; }` 正是
这么静默丢数据的。

现在的做法（`lib/history.ts`）：

- `readHistory()` 返回 `{ conversations, corrupted, bytes }`；解析失败置 `corrupted: true`，
  并把**原始字符串原样**备份到 `deepseek-quick.conversations.corrupted`。
- 所有写操作（`saveConversation` / `deleteConversation` / `importConversations`）统一走
  `writable()`，`corrupted` 时抛 `HistoryCorruptedError`，**拒绝写入**。
- UI 在 Chat 顶部和 `History` 里显示保护模式提示，并提供 `Backup History` 抢救导出。

配套的一条：`chat-view.tsx` 里保存历史用的是**独立的** try/catch。写盘失败只提示
「回答已生成，但没能存进历史」，**绝不能**被外层 catch 当成「请求失败」而把已生成的回答回退掉。

## 常见任务

### 新增一条快捷命令（例：Summarize）

1. **加内置 prompt** — `src/lib/prompts.ts`：

   ```ts
   export const SUMMARIZE_SYSTEM = ["你是一个总结助手。", "", "要求：", "- 用 3 条以内的要点概括。"].join("\n");
   ```

2. **加入口** — 新建 `src/summarize.tsx`（文件名必须 = command name）。
   注意 `command` 是**必填** prop，它决定「Configure Prompts」里能改到哪条：

   ```tsx
   import { SUMMARIZE_SYSTEM } from "./lib/prompts";
   import { QuickAction } from "./components/quick-action";

   export default function Command() {
     return (
       <QuickAction
         command="summarize"
         title="总结选中文本"
         system={SUMMARIZE_SYSTEM}
         buildUser={(selection) => `请总结下面这段文本：\n\n${selection}`}
       />
     );
   }
   ```

3. **注册 manifest** — `package.json` 的 `commands` 数组追加。想让它也能单独配模型 / 思考强度，
   就从别的命令**复制整个 `preferences` 数组**（只改 description 里的命令名，字段名不要动）：

   ```json
   {
     "name": "summarize",
     "title": "Summarize Selection",
     "subtitle": "DeepSeek",
     "description": "总结选中的文本",
     "mode": "view",
     "preferences": [ /* 复制 explain 的 modelOverride + effortOverride */ ]
   }
   ```

4. **登记到 Prompts 配置界面** — 漏了这步 `Configure Prompts` 里就看不到它：
   - `src/lib/prompt-config.ts` → `PROMPT_COMMANDS` 数组
   - `src/components/prompt-config-view.tsx` → `META` 映射 + `builtinPrompt()` 的 `switch`

   `PROMPT_COMMANDS` 是 `PromptCommand` 的唯一来源，漏了 `META` / `switch` 会被 TS 立刻报出来。

5. `npm run build`（或 `npm run dev`）重新生成 `raycast-env.d.ts` → 在 Raycast 里验收。
   热键由用户在 Raycast 设置里自己绑。

> 需要读图的命令参考 `ask-image.tsx`（它自己处理 `getSelectedFinderItems` + `Form` 提问、
> 自己解析 prompt，最后仍然复用 `ResultView`）。

### 修改某个命令的 prompt

**内置** prompt 在 `src/lib/prompts.ts`；**用户覆盖**由 `Configure Prompts` 命令写进 LocalStorage。
改内置常量**不会**影响已经存在的覆盖（覆盖优先），要清掉得用界面里的「恢复内置默认」。
注意 prompt 里已声明「用 Markdown」等约定，保持风格一致。

### 新增一个配置项

- **扩展级（全局默认）**：
  1. `package.json` → 顶层 `preferences` 加一项（必须有 `name` / `title` / `description` / `type`）。
  2. `src/lib/config.ts` → `ExtensionPreferences` 加字段，并在 `prefs()` 里给出默认值与规整逻辑
     （参考 `asEffort()` / endpoint 去尾斜杠的写法）。
  3. 使用处统一通过 `prefs()` 读取 —— **不要**散落调用 `getPreferenceValues()`。
- **命令级（单条命令覆盖）**：`package.json` → `commands[].preferences`，**字段名必须与扩展级不同**
  （见约束 13），再在 `prefs()` 里做「空则回落」。

### 换模型 / 接别的 OpenAI 兼容端点

改扩展设置里的 **Model** / **API Endpoint** 即可，代码无需改动。
`deepseek-v4-pro` 已验证可用。端点不要带 `/chat/completions`（代码会自动拼）。
只让某一条命令换模型 → 改那条命令自己的 **Model**（即 `modelOverride`）。

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

/** 允许自定义 prompt 的命令。PROMPT_COMMANDS 是唯一来源，新增命令必须登记 */
type PromptCommand = "explain" | "translate" | "rewrite" | "ask-image" | "chat";
/** LocalStorage 里的覆盖表；空字符串不落盘，全空时整个 key 被删除 */
type PromptOverrides = Partial<Record<PromptCommand, string>>;
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
- [ ] 没有触碰上面 14 条硬性约束
- [ ] 没有把 Key / 生成文件带进提交（`git status` 确认）
- [ ] 新增命令时，文件名 = `package.json` 的 command name
