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
- [按命令自定义（模型 / 思考强度 / Prompt）](#按命令自定义模型--思考强度--prompt)
- [命令与热键](#命令与热键)
- [使用指南](#使用指南)
  - [解释 / 翻译 / 改写](#解释--翻译--改写)
  - [用量与缓存](#用量与缓存)
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
| 🌐 中英互译 | 翻译默认自动判向：中文→英文、英文→中文；也可切回指定目标语言 |
| 🎛 模型 / 强度按命令可配 | 全局默认之外，5 条 AI 命令各自可覆盖 Model 与思考强度 |
| 📝 Prompt 可自定义 | `Configure Prompts` 命令多行编辑 system prompt，可一键恢复内置默认 |
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

下面这些是**扩展全局的默认值**。每条 AI 命令都能单独覆盖模型与思考强度，
prompt 也能整体替换 —— 见下一节。

| 项 | 默认 | 说明 |
|---|---|---|
| **API Key** | 空 | 留空则依次回退到环境变量 `DEEPSEEK_API_KEY`、`~/.dsh/.credentials.yaml` |
| **API Endpoint** | `https://api.deepseek.com/v1` | OpenAI 兼容端点，**不要**带 `/chat/completions` |
| **Model** | `deepseek-flash` | 全局默认模型。换成 `deepseek-v4-pro` 也可以；各命令可单独覆盖 |
| **Quick Action Reasoning** | `none` | 解释 / 翻译 / 改写 / 看图的**全局默认**思考强度。默认不思考，最快 |
| **Chat Reasoning** | `low` | Chat / 继续讨论的**全局默认**思考强度 |
| **Translate Direction** | 开 | 「中英互译」：自动判断中文→英文 / 英文→中文。开启时忽略下面的 Translate To |
| **Translate To** | `中文` | 关闭「中英互译」后才生效，用来指定单一目标语言 |
| **Reasoning** | 关 | 是否在结果里显示模型的思考链 |
| **Output Behavior** | `replace` | 结果页主操作（`↵`）：替换选中文本 / 复制 |

## 按命令自定义（模型 / 思考强度 / Prompt）

5 条 AI 命令（`Explain` / `Translate` / `Rewrite` / `Ask About Image` / `Chat`）都能
**各自**指定模型、思考强度和 system prompt。优先级统一是：

```
本命令的覆盖  →  扩展全局设置  →  内置默认
```

### 模型 / 思考强度（Raycast 原生命令级偏好）

`Raycast → Settings → Extensions → DeepSeek Quick` → **选中某条命令** → 右侧就是它的
`Model` 和 `Reasoning` 两项：

- **Model** 留空 = 跟随扩展全局 **Model**
- **Reasoning** 选 **跟随全局设置** = 用扩展全局的思考强度；选具体档位则**只对这一条命令生效**

也可以在运行时直接跳过去：结果页 / 对话页 `⌘K` → **配置本命令的模型 / 思考强度**。

> `Chat with Selection` 没有自己的设置项 —— 它最终是通过 `launchCommand` 拉起 `Chat` 的，
> 所以走 **Chat** 的配置。

### System Prompt（Configure Prompts）

根搜索里运行 **`Configure Prompts`**：列出每条 AI 命令，显示当前用的是「内置默认」还是
「已自定义」，并在右侧预览当前生效的完整 prompt。

| 操作 | 说明 |
|---|---|
| `↵` 编辑 Prompt | `Form.TextArea`，**支持多行** |
| `⌘⇧R` 恢复内置默认 | 删掉该命令的覆盖 |
| `⌘⇧⌫` 清空全部自定义 | 所有命令回到内置 |
| `⌘,` 打开扩展设置 | 全局 Model / 思考强度 / API Key |

**留空、或内容与内置完全相同，都会回落到内置默认** —— 所以「打开表单直接保存」不会把内置
prompt 固化成一份副本。想在内置基础上改，直接编辑预填好的内容即可。

> **为什么 prompt 不用 Raycast 偏好**：偏好的类型只有 `textfield` / `password` / `checkbox` /
> `dropdown` / `appPicker` / `file` / `directory`，**没有多行输入**，prompt 塞进 `textfield`
> 得手写 `\n`。所以分工是：prompt 走自建配置命令 + `LocalStorage`，模型和思考强度这类单值
> 才用原生偏好。

> 翻译命令有**两个内置 prompt**，用哪个取决于扩展设置里的 **Translate Direction**：
> 开启「中英互译」时是自动判向的版本，关闭时是「目标语言：xxx」的版本。
> `Configure Prompts` 里预览到的就是**当前生效**的那一个；一旦自定义，就完全以你写的为准。

## 命令与热键

| 命令 | 用途 | 建议热键 |
|---|---|---|
| `Explain Selection` | 解释选中文本 | `⌥A` |
| `Translate Selection` | 翻译选中文本（默认**中英互译**，自动判向） | `⌥S` |
| `Rewrite Selection` | 改写 / 润色选中文本 | `⌥D` |
| `Ask About Image` | 对 Finder 里选中的图片提问 | `⌥G` |
| `Chat` | 多轮对话，可附加图片 | `⌥C` |
| `Chat with Selection` | 选中文字 / Finder 选中的图片 → 直接开聊（作为参考内容） | `⌥V` |
| `History` | 浏览历史对话并从任意一条继续 | — |
| `Configure Prompts` | 按命令自定义 system prompt（多行） | — |

**设置热键**：Raycast 根搜索里输入命令名 → `⌘K` → **Configure Command** → **Record Hotkey**。

## 使用指南

### 解释 / 翻译 / 改写

1. 在**任意 App** 里选中一段文字（浏览器、编辑器、PDF 都行）。
2. 按对应热键（如 `⌥A` 解释）。
3. 结果流式显示。默认 `Output Behavior = replace` 时，按 `↵` 会把结果**直接替换**你刚选中的文本；
   想只复制就用 `⌘K` 里的「复制结果」（或在设置里把输出行为改成 `copy`）。
4. 想追问：`⌘N` → **继续讨论**，会带着「你的原文 + 模型回复」进入对话视图。

> 结果页底部会显示 token 用量（`xx in / xx out`）；`reasoning` 和 `cache hit` **只在非零时才出现** ——
> 看不到它们通常是正常的，原因见下面的[用量与缓存](#用量与缓存)。
> 如果打开了 **Reasoning** 设置，思考链会以引用块形式显示在结果上方。

### 用量与缓存

**为什么 `reasoning` / `cache hit` 常常是 0？** 这两个的原因完全不同，但都不是 bug。

**`reasoning` 为 0 —— 设计如此。**
快捷命令（解释 / 翻译 / 改写 / 看图）默认 `Quick Action Reasoning = none`，
发出的是 `thinking: { type: "disabled" }`，模型**根本不产生**思考 token。
想看到它，把该项调到 `low` / `high` / `max` 即可（实测 `low` 时一次请求就有 446 个 reasoning tokens）。

**`cache hit` 为 0 —— 选中文本太短，够不到 DeepSeek 的缓存门槛。**
DeepSeek 的上下文缓存要求：**前缀从第 0 个 token 起完整相同**、该前缀**已经落盘**、
并且能被当作**独立的完整单元**匹配；存储以 64 tokens 为单位
（[官方说明](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)）。
实际门槛远高于 64，所以几十到几百字的选中文本基本不可能命中 —— 实测：

| 输入 | 连续请求的结果 |
|---|---|
| **136 tokens** | 第 1 / 2 / 3 次全是 `cached_tokens: 0` |
| **2937 tokens** | 第 1 次 `0`（首次请求顺便构建缓存），第 2、3 次 `cached_tokens: 2688` ✅ |

所以「**用同一段文本重试，cache hit 还是 0**」是完全符合预期的，不是扩展读错了字段 ——
代码读的是 `prompt_tokens_details.cached_tokens`，与 DeepSeek 原生返回的
`prompt_cache_hit_tokens` 同值（上面两类字段实测都会返回，且数值一致）。

> 想让缓存真正生效，得有**长且稳定**的前缀。这也是为什么本扩展把 prompt 做成可配置的 ——
> 你可以在 `Configure Prompts` 里加一段很长的 system prompt 来跨请求复用。

### 看图问答

1. 在 **Finder** 里选中一张图片（`png` / `jpg` / `jpeg` / `webp` / `gif` / `bmp`）。
2. 运行 `Ask About Image`（建议 `⌥G`）。
3. 在弹出的表单里填问题（默认「描述这张图片」）→ `↵` 提问。

### 多轮对话

运行 `Chat`（建议 `⌥C`）。这个界面把 Raycast 的搜索栏**当成常驻输入框**：

```
┌──────────────────────────────────────────────────┐
│  输入消息，按 ↵ 发送…                  [ 会话 ▾ ] │  ← 搜索栏 = 输入框（一直聚焦）
├──────────────────────────────────────────────────┤
│  你                                               │
│  > 问题…                                          │
│  DeepSeek                                         │
│  回答…（Markdown，可滚动、占满整宽）                │  ← 整个对话在主区域，不跟列表挤
└──────────────────────────────────────────────────┘
│ 发送 ↵   Actions ⌘K                               │
└──────────────────────────────────────────────────┘
```

- **输入**：直接在搜索栏打字，`↵` 发送。**没有弹窗、没有二次跳转**
- **切换会话**：`⌘P` 打开搜索栏右侧的**会话下拉**，选中即切换
- `⌘⇧I` **附加图片发送**（打开表单，搜索栏塞不进文件选择器）
- `⌘N` 新对话 · `⌘⇧H` 打开两栏会话记录（删除也在那里，`⌘X`）
- `⌘⇧C` 复制本次回复 · `⌘⌥C` 复制完整对话
- 生成过程中：`⌘K` → **停止生成**

> **为什么是「一个锚点 + 满宽详情」而不是列表？**
> Raycast 的 `List` 行高固定且 `white-space: nowrap`（见 `standard-list-item` 的
> `.standard-list-item__root` / `__subtitle` 样式），**一行放不下对话内容**；
> 而 `List + Detail` 的分栏比例由 Raycast 内部固定，扩展既没有 API 也没有设置项可调
> （`List` 只有 `isShowingDetail?: boolean`，社区从 2021 年就在要 SplitView：
> [raycast/extensions#83](https://github.com/raycast/extensions/issues/83)）。
> 三者「满宽 / 可读长文本 / 有输入框」只能取二，所以选择：让详情区占满宽度承载整个对话，
> 会话列表搬进搜索栏下拉，左侧只留一个锚点条目。

### 带着选区开聊

不想「先解释再讨论」两步走时，直接把选区带进对话：

- 在**任意 App**里选中文字（或在 Finder 里选中图片）→ 按 `Chat with Selection` 的热键（建议 `⌥V`）
  → 打开一段新对话，选区作为 **📎 参考内容**显示在右侧面板，**不占用输入框** ——
  你直接在搜索栏里打字问关于它的问题，`↵` 发送。

> **参考内容 ≠ prompt**。它会被包成「背景资料 + 你的问题」提交给模型，
> 所以可以围绕同一段内容连续追问；发送后参考块消失（内容已经进了对话历史）。
> 只想让模型看看 / 分析这段内容、不想自己提问：`⌘K` → **只发参考内容（不提问）**，或按 `⌘⇧↩`。
> 不想要了：`⌘K` → **移除参考内容**（或 `⌘⇧R`）。
>
> ⚠️ 这个命令是 **no-view**，而且实现上必须先 `closeMainWindow()` 再读选区。
> 因为 `getSelectedText()` 读的是**最前台 App** 的选中文本，Raycast 自己在前台时只会拿到空串
> （官方文档 + [raycast/extensions#11793](https://github.com/raycast/extensions/issues/11793)）。
> 所以**不要**指望在 Chat 界面里加个快捷键就能读外部选区 —— 窗口在前台就读不到，
> 这也是这个功能单独做成一个命令而不是 Chat 内动作的原因。
>
> Finder 里选中图片且没选中文字时，图片会随参考内容一起挂上；发送后历史里存 `[图片]` 占位。

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

改代码前请先读 **[AGENTS.md](./AGENTS.md)**，里面记录了 13 条**已修复、不要改回去**的硬性约束。

## 目录结构

```
.
├── assets/
│   └── icon.png                扩展图标
├── src/
│   ├── lib/
│   │   ├── config.ts           偏好解析（全局 + 命令级覆盖）+ API Key 三级回退
│   │   ├── deepseek.ts         SSE 流式客户端、vision、reasoning_content
│   │   ├── prompts.ts          各命令的内置 system prompt
│   │   ├── history.ts          LocalStorage 对话存储（剥图片、限 200 条）
│   │   ├── images.ts           图片文件 → data URI
│   │   ├── selection.ts        「当前选区」统一读取（文字 / Finder 图片）
│   │   ├── prompt-config.ts    每命令 system prompt 覆盖（LocalStorage）
│   │   ├── use-stream.ts       流式状态 hook（80ms 节流 + 去重）
│   │   └── debug.ts            追加写 /tmp/dsq-debug.log
│   ├── components/
│   │   ├── quick-action.tsx    读选中文本的通用外壳（解析本命令的 prompt）
│   │   ├── result-view.tsx     快捷命令结果页（流式 + 替换/复制 + 继续讨论）
│   │   ├── chat-view.tsx       多轮对话主界面
│   │   ├── history-view.tsx    两栏历史浏览器
│   │   └── prompt-config-view.tsx   Configure Prompts 界面
│   ├── explain.tsx             ┐
│   ├── translate.tsx           │
│   ├── rewrite.tsx             │ 8 个命令入口，
│   ├── ask-image.tsx           │ 每个对应 package.json 里的一条 command
│   ├── chat.tsx                │
│   ├── chat-selection.tsx      │
│   ├── history.tsx             │
│   └── configure.tsx           ┘
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
