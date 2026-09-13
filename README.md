# DeepSeek Quick

> 在 Raycast 里选中一段文本，按一下热键，秒级拿到**解释 / 翻译 / 改写**；
> 还能就选中的文字或 Finder 里的图片**开一段多轮对话**。
> 直连 DeepSeek API —— **不经过 Raycast AI，不需要 Raycast Pro**。

---

## 目录

- [这是什么](#这是什么)
- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置 API Key](#配置-api-key)
- [配置项](#配置项)
- [命令与热键](#命令与热键)
- [使用指南](#使用指南)
  - [解释 / 翻译 / 改写](#解释--翻译--改写)
  - [看图问答](#看图问答)
  - [多轮对话](#多轮对话)
  - [带着选区开聊](#带着选区开聊)
  - [历史记录与继续对话](#历史记录与继续对话)
- [工作原理](#工作原理)
- [排错](#排错)
- [已知限制](#已知限制)
- [开发](#开发)
- [目录结构](#目录结构)
- [文档导航](#文档导航)
- [License](#license)

---

## 这是什么

一个 **本地 Raycast 扩展**，把 DeepSeek 接到 macOS 的任意 App 上：

- 在浏览器 / 编辑器 / PDF 里选中文字 → 按热键 → 直接看到结果，可以一键**替换原文**；
- 想追问就按 `⌘N` **继续讨论**，对话自动保存到**历史**里，随时能接着聊；
- 在 Finder 里选中图片 → 也能直接提问（vision）。

它和 Raycast 商店里的 ChatGPT 扩展最大的区别：**每个 prompt 都是 manifest 里的顶级命令**，
所以每一条都能绑**原生全局热键**，不需要 Quicklink + deeplink（deeplink 会弹确认框，而且拿不到选中文本）。

## 特性

| 特性 | 说明 |
|---|---|
| ⚡ 秒级快捷动作 | 解释 / 翻译 / 改写，默认**关闭思考**（`thinking.disabled`），首字最快 |
| 🎛 思考强度可配 | `none` / `low` / `high` / `max`，快捷命令与对话分别配置 |
| 💬 多轮对话 | 搜索栏就是输入框，右侧是可滚动的 Markdown 对话区 |
| 🖼 读图 | `Ask About Image` 或对话里附加图片 |
| 📋 替换或复制 | 结果页主操作可直接替换选中的文本，或只复制 |
| 🕘 历史记录 | 自动保存，可搜索、可续聊、可删除，本地存储不上云 |
| 🔑 多种 Key 来源 | 扩展设置 / 环境变量 / `~/.dsh/.credentials.yaml` 三级回退 |

## 环境要求

- **macOS**（Raycast 只有 macOS 版）
- **[Raycast](https://www.raycast.com/)** 已安装并登录
- **Node.js 20+**（推荐 LTS；构建扩展时使用。本项目在 Node 26 上验证通过）
- 一个 **DeepSeek API Key** —— 到 <https://platform.deepseek.com/api_keys> 申请
- 首次运行需要网络（`npm install` 拉依赖）

## 安装

### 从源码安装（唯一方式）

这是一个私有扩展，不在 Raycast 商店里，需要用 Raycast 官方的 `ray develop` 把它导入本地 Raycast。

```bash
# 1. 克隆（私有仓库，需要你有访问权限）
git clone https://github.com/grunmin/deepseek-quick.git
cd deepseek-quick

# 2. 安装依赖
npm install

# 3. 导入 Raycast 并进入开发监听模式
npm run dev
```

`npm run dev`（即 `ray develop`）会把扩展注册进 Raycast，并持续监听源码改动 ——
**改代码即时生效**，不需要重启。按 `⌃C` 退出监听（退出后扩展仍然可用，只是不再热更新）。

> **验证安装**：打开 Raycast（`⌥Space`）→ 输入 `Explain Selection` → 应该能看到
> 「DeepSeek Quick」分类下的这条命令。第一次运行会提示填 API Key。

### 更新

```bash
cd deepseek-quick
git pull
npm install   # 依赖有变化时
npm run dev   # 重新导入并监听
```

### 卸载

在 `Raycast → Settings → Extensions` 里找到 **DeepSeek Quick** → 右键 → **Uninstall**。
如果只是想停掉热更新监听，`⌃C` 结束 `npm run dev` 即可。

## 配置 API Key

到 <https://platform.deepseek.com/api_keys> 创建一个 Key（形如 `sk-...`），
然后**任选一种**方式提供给它。三者优先级从高到低：

| 优先级 | 方式 | 适合 |
|---|---|---|
| 1 | 扩展设置里的 **API Key** 字段 | 只想在这台机器上用，最直白 |
| 2 | 环境变量 `DEEPSEEK_API_KEY` | 已经用它管理其他 CLI 工具 |
| 3 | `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY` | 复用已有的凭据文件，省得重复粘贴 |

扩展设置入口：`Raycast → Settings → Extensions → DeepSeek Quick`。

第 3 种方式的文件格式：

```yaml
# ~/.dsh/.credentials.yaml
DEEPSEEK_API_KEY: sk-你的key
```

> Key 会缓存在进程内（`src/lib/config.ts` 的 `cachedKey`），改了以后重跑一次命令即可生效。
> **不要把 Key 写进代码或提交到仓库。**

## 配置项

`Raycast → Settings → Extensions → DeepSeek Quick`

| 项 | 默认 | 说明 |
|---|---|---|
| **API Key** | 空 | 留空则依次回退到环境变量 `DEEPSEEK_API_KEY`、`~/.dsh/.credentials.yaml` |
| **API Endpoint** | `https://api.deepseek.com/v1` | OpenAI 兼容端点，**不要**带 `/chat/completions` |
| **Model** | `deepseek-flash` | 换成 `deepseek-v4-pro` 也可以 |
| **Quick Action Reasoning** | `none` | 解释 / 翻译 / 改写 / 看图 的思考强度。默认**不思考，最快** |
| **Chat Reasoning** | `low` | Chat / 继续讨论 的思考强度 |
| **Translate To** | `中文` | `Translate Selection` 的目标语言 |
| **Reasoning** | 关 | 是否在结果里显示模型的思考链 |
| **Output Behavior** | `replace` | 结果页主操作（`↵`）：替换选中文本 / 复制 |

## 命令与热键

| 命令 | 用途 | 建议热键 |
|---|---|---|
| `Explain Selection` | 解释选中文本 | `⌥A` |
| `Translate Selection` | 翻译选中文本 | `⌥S` |
| `Rewrite Selection` | 改写 / 润色选中文本 | `⌥D` |
| `Ask About Image` | 对 Finder 里选中的图片提问 | `⌥G` |
| `Chat` | 多轮对话，可附加图片 | `⌥C` |
| `Chat with Selection` | 选中文字 / Finder 选中的图片 → 直接开聊（预填输入框） | `⌥V` |
| `History` | 浏览历史对话并从任意一条继续 | — |

**设置热键**：Raycast 根搜索里输入命令名 → `⌘K` → **Configure Command** → **Record Hotkey**。

## 使用指南

### 解释 / 翻译 / 改写

1. 在**任意 App** 里选中一段文字（浏览器、编辑器、PDF 都行）。
2. 按对应热键（如 `⌥A` 解释）。
3. 结果流式显示。默认 `Output Behavior = replace` 时，按 `↵` 会把结果**直接替换**你刚选中的文本；
   想只复制就用 `⌘K` 里的「复制结果」（或在设置里把输出行为改成 `copy`）。
4. 想追问：`⌘N` → **继续讨论**，会带着「你的原文 + 模型回复」进入对话视图。

> 结果页底部会显示 token 用量（`xx in / xx out · reasoning · cache hit`），方便判断成本和缓存命中。
> 如果打开了 **Reasoning** 设置，思考链会以引用块形式显示在结果上方。

### 看图问答

1. 在 **Finder** 里选中一张图片（`png` / `jpg` / `jpeg` / `webp` / `gif` / `bmp`）。
2. 运行 `Ask About Image`（建议 `⌥G`）。
3. 在弹出的表单里填问题（默认「描述这张图片」）→ `↵` 提问。

### 多轮对话

运行 `Chat`（建议 `⌥C`）。这个界面把 Raycast 的搜索栏**当成常驻输入框**：

```
┌──────────────────────────────────────────────────┐
│  输入消息，按 ↵ 发送…                             │  ← 搜索栏 = 输入框（一直聚焦）
├────────────────────┬─────────────────────────────┤
│ 新对话             │  你                          │
│ 历史会话           │  > 问题…                     │
│  · 会话 A          │  DeepSeek                    │
│  · 会话 B          │  回答…（Markdown，可滚动）    │  ← 右侧 = 完整对话
└────────────────────┴─────────────────────────────┘
│ 发送 ↵   Actions ⌘K                               │
└──────────────────────────────────────────────────┘
```

- **输入**：直接在搜索栏打字，`↵` 发送。**没有弹窗、没有二次跳转**
- **切换会话**：左侧列表选中即切换（当前对话在右侧实时预览）
- `⌘⇧I` **附加图片发送**（打开表单，搜索栏塞不进文件选择器）
- `⌘N` 新对话 · `⌘X` 删除当前会话 · `⌘⇧H` 打开两栏会话记录
- `⌘⇧C` 复制本次回复 · `⌘⌥C` 复制完整对话
- 生成过程中：`⌘K` → **停止生成**

### 带着选区开聊

不想「先解释再讨论」两步走时，直接把选区带进对话：

- **根搜索**里运行 `Chat with Selection`（建议 `⌥V`）：读取当前选中的文字 / Finder 里选中的图片，
  **预填**进输入框 —— 你可以补一句问题，也可以直接 `↵` 发出去。
- **已经在 Chat 里**时：
  - `⌘⇧U` 读当前选区**填入输入框**
  - `⌘⇧↩` 读当前选区**直接发送**

> 选区在 ChatView 渲染**之前**读取（见 `src/chat-selection.tsx`），避免和聊天窗口抢焦点。
> Finder 里选中图片且没选中文字时，图片会自动挂上；发送后历史里存 `[图片]` 占位。

### 历史记录与继续对话

- 只有 `Chat`（含从快捷命令转进来的对话）会写历史，存在 Raycast 的 `LocalStorage` 里。
- 最多保留 **200** 条会话，超出后丢弃最旧的。
- `History` 命令（或 Chat 里 `⌘⇧H`）打开两栏浏览器：左侧列表 + 右侧内容预览。
- `⌘K` → **继续这条对话** 从任意一条历史接着聊；`⌘X` 删除。

## 工作原理

```
        选中文本 / Finder 选中图片
                  │
                  ▼
        ┌───────────────────┐   getSelectedText()
        │   QuickAction     │ ◀──────────────────────  Raycast API
        │   （通用外壳）      │
        └─────────┬─────────┘
                  │ messages[]
                  ▼
        ┌───────────────────┐   SSE 流式               ┌───────────────┐
        │    ResultView     │ ───────────────────────▶ │  DeepSeek API │
        │   （Detail 结果页）  │ ◀─────────────────────── │  /chat/       │
        └─────────┬─────────┘   content +              │  completions  │
                  │             reasoning_content      └───────────────┘
                  │ ⌘N 继续讨论
                  ▼
        ┌───────────────────┐        ┌────────────────┐
        │     ChatView      │ ─────▶ │  LocalStorage  │
        │  （多轮对话 + 历史） │ ◀───── │  （历史会话）    │
        └───────────────────┘        └────────────────┘
```

几个关键设计点：

- **思考强度**：DeepSeek 的 `reasoning_effort` 只接受 `low` / `high` / `max`。
  **想彻底关掉思考，不能传 `reasoning_effort: "none"`**，而要传 `thinking: { type: "disabled" }` ——
  `none` 档走的就是后者。思考链在 `message.reasoning_content` 里，和正文分开流式返回。
- **为什么搜索栏当输入框**：Raycast 的 `Detail` 没有输入能力，`Form` 又不支持 Markdown。
  唯一能同时做到「常驻聚焦输入 + 可滚动 Markdown」的方式，就是用 `List` + `filtering={false}`，
  把搜索栏当输入框、右侧 detail 面板当对话区。
- **流式节流**：每 80ms 才 `setState` 一次并做去重，否则 Raycast 会警告
  「rendering a lot without any changes」，严重时会直接终止扩展。

更深入的架构说明、硬性约束和踩坑记录见 **[AGENTS.md](./AGENTS.md)**。

## 排错

| 症状 | 原因 / 解决 |
|---|---|
| `找不到 API Key` | 三种来源都没配。到扩展设置里填，或设置 `DEEPSEEK_API_KEY` |
| `读不到选中的文本` | 触发命令前**没有选中文字**。先选中再按热键 |
| `Unable to retrieve selected text via clipboard` | 命令是**通过 `raycast://` deeplink 启动**的，这种方式拿不到选区。改用原生热键 |
| 结果页一直空白 / 卡住 | React StrictMode 下 effect cleanup 把请求 abort 了。本项目已修（见 AGENTS.md 约束 1），若改动过此处请回退 |
| `HTTP 401` | Key 无效或过期，重新生成 |
| `HTTP 402` / 余额相关 | DeepSeek 账户余额不足 |
| `HTTP 429` | 触发限流，稍后重试 |
| 界面反复闪烁 / Raycast 警告重渲染 | 流式 `setState` 丢了去重，见 `src/lib/use-stream.ts` 的 `pushedContent` 逻辑 |
| 想看清楚发生了什么 | 看 `/tmp/dsq-debug.log`（见下方「调试日志」） |

### 调试日志

请求和响应会以追加方式写入 **`/tmp/dsq-debug.log`**：

```bash
tail -f /tmp/dsq-debug.log
```

日志里能看到：请求的 endpoint / model / effort、消息条数、HTTP 状态、返回内容长度和 token 用量。
实现见 `src/lib/debug.ts`。**不需要的话**删掉 `debug.ts` 以及各文件里的 `dbg()` 调用即可，不影响功能。

## 已知限制

- 历史存在 Raycast 本地加密库，**不跨设备同步**（Cloud Sync 是 Raycast Pro 功能）
- 图片只在 `Ask About Image` 和 `Chat` 的附件里支持，纯文本快捷命令不处理图片
- 长对话不做自动摘要，靠 DeepSeek 自己的上下文窗口
- Raycast 扩展 API **没有真正的 sidebar**，会话列表只能用「左侧列表 + 右侧预览」（`List.isShowingDetail`）替代
- 无法从 Raycast 商店安装（这是个人私有扩展）

## 开发

```bash
npm install      # 安装依赖
npm run dev      # ray develop：导入 Raycast + 热更新监听
npm run build    # ray build -e dist：构建产物到 dist/
npm run lint     # ray lint
npm run fix-lint # ray lint --fix
npx tsc --noEmit # 类型检查（无副作用，CI 友好）
```

改代码前请先读 **[AGENTS.md](./AGENTS.md)**，里面记录了 5 个**已修复、不要改回去**的坑。

## 目录结构

```
.
├── assets/
│   └── icon.png                扩展图标
├── src/
│   ├── lib/
│   │   ├── config.ts           偏好设置解析 + API Key 三级回退
│   │   ├── deepseek.ts         SSE 流式客户端、vision、reasoning_content
│   │   ├── prompts.ts          各命令的 system prompt
│   │   ├── history.ts          LocalStorage 对话存储（剥图片、限 200 条）
│   │   ├── images.ts           图片文件 → data URI
│   │   ├── selection.ts        「当前选区」统一读取（文字 / Finder 图片）
│   │   ├── use-stream.ts       流式状态 hook（80ms 节流 + 去重）
│   │   └── debug.ts            追加写 /tmp/dsq-debug.log
│   ├── components/
│   │   ├── quick-action.tsx    读选中文本的通用外壳
│   │   ├── result-view.tsx     快捷命令结果页（流式 + 替换/复制 + 继续讨论）
│   │   ├── chat-view.tsx       多轮对话主界面
│   │   └── history-view.tsx    两栏历史浏览器
│   ├── explain.tsx             ┐
│   ├── translate.tsx           │
│   ├── rewrite.tsx             │ 7 个命令入口，
│   ├── ask-image.tsx           │ 每个对应 package.json 里的一条 command
│   ├── chat.tsx                │
│   ├── chat-selection.tsx      │
│   └── history.tsx             ┘
├── package.json                扩展 manifest（命令、偏好、脚本）
├── tsconfig.json               TypeScript 配置
└── AGENTS.md                   面向 AI / 贡献者的工程说明
```

## 文档导航

| 文档 | 面向 | 内容 |
|---|---|---|
| **README.md**（本文） | 使用者 / 新手 | 安装、配置、命令、使用指南、排错 |
| **[AGENTS.md](./AGENTS.md)** | AI 编码助手 / 贡献者 | 架构、数据流、硬性约束、踩坑、常见任务 |

## License

[MIT](./LICENSE) © Runmin Guo
