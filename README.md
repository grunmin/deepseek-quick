# DeepSeek Quick

> 在 Raycast 里选中一段文本，按一下热键，秒级拿到**解释 / 翻译 / 改写**；
> 选中写好的 prompt 还能**直接执行**，也可以就选中的文字或 Finder 里的图片**开一段多轮对话**。
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
  - [执行选中的 prompt](#执行选中的-prompt)
  - [换模型 / 思考强度 / Preset 重新生成](#换模型--思考强度--preset-重新生成)
  - [用量与缓存](#用量与缓存)
  - [看图问答](#看图问答)
  - [多轮对话](#多轮对话)
  - [Chat 预设（Preset）](#chat-预设preset)
  - [带着选区开聊](#带着选区开聊)
  - [Agent（ACP）：把任务交给真正的 agent](#agentacp把任务交给真正的-agent)
  - [历史记录与继续对话](#历史记录与继续对话)
  - [数据安全与备份](#数据安全与备份)
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
- 手里有写好的 prompt → 选中它 → 按热键 **直接执行**，不用复制粘贴进对话；
- 想追问就按 `⌘N` **继续讨论**，对话自动保存到**历史**里，随时能接着聊；
- 在 Finder 里选中图片 → 也能直接提问（vision）；
- 想要的不只是「回答」而是「干活」→ 按热键唤起 **`Agent`**：对面是 dsh / codex 这类**真正的
  agent**，会读文件、跑命令、改代码，工具调用按时间线渲染（走 [ACP](#agentacp把任务交给真正的-agent)，不用开浏览器和编辑器）。

它和 Raycast 商店里的 ChatGPT 扩展最大的区别：**每个 prompt 都是 manifest 里的顶级命令**，
所以每一条都能绑**原生全局热键**，不需要 Quicklink + deeplink（deeplink 会弹确认框，而且拿不到选中文本）。

## 特性

| 特性 | 说明 |
|---|---|
| ⚡ 秒级快捷动作 | 解释 / 翻译 / 改写，默认**关闭思考**（`thinking.disabled`），首字最快 |
| ▶️ 执行选中的 prompt | 把选中的文本**当作 prompt** 直接发给模型执行，不用先复制再粘贴 |
| 🔁 换配置重跑 | 结果页直接换模型 / 思考强度 / Preset 重新生成，**只影响这一次**，不动设置 |
| 🌐 中英互译 | 翻译默认自动判向：中文→英文、英文→中文；也可切回指定目标语言 |
| 🎭 Chat 预设 | 建多套「prompt + 模型 + 思考强度」，Chat 里 `⌘K` 一键切换 |
| 🎛 模型 / 强度按命令可配 | 全局默认之外，6 条 AI 命令各自可覆盖 Model 与思考强度 |
| 📝 Prompt 可自定义 | `Configure Prompts` 命令多行编辑 system prompt，可一键恢复内置默认 |
| 💬 多轮对话 | 搜索栏就是输入框，右侧 Markdown 对话区（最新一轮置顶，发完就能看到回答在长） |
| 🛠 Agent（ACP） | 热键唤起，把任务交给**真正的 agent**（默认 dsh）：读文件、跑命令、改代码，工具调用按时间线渲染，审批弹原生对话框。走 ACP，换 agent 只改一条启动命令 |
| 🖼 读图 | `Ask About Image` 或对话里附加图片 |
| 📋 替换或复制 | 结果页主操作可直接替换选中的文本，或只复制 |
| 🕘 历史记录 | 自动保存，可搜索、可续聊、可删除，本地存储不上云；另有一个分区实时列出 **agent 侧会话**，`↵` 接回去继续 |
| 🔑 多种 Key 来源 | 扩展设置 / 环境变量 / `~/.dsh/.credentials.yaml` 三级回退 |

## 环境要求

- **macOS**（Raycast v1 只有 macOS 版；v2 另有 Windows 版，但本扩展未在 Windows 上验证过）
- **[Raycast](https://www.raycast.com/)** 已安装并登录 —— **v1 / v2 都能用**，只是要选对分支（见[安装](#安装)）
- **Node.js 22.22.2+**（只用于构建扩展。Raycast CLI 要求 ≥ 22.22.2；本项目在 Node 26 上验证通过）
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

### 如果你的 Raycast 还是 v1

Raycast 在安装扩展时会比对「扩展依赖的 API 版本」和「你的应用版本」，对不上会提示升级应用、
根本装不上（[官方版本机制](https://developers.raycast.com/information/versioning)）。
所以本仓库用两条分支分别服务两个版本：

| 你的 Raycast | 用哪条分支 | 依赖的 `@raycast/api` |
|---|---|---|
| **2.x**（当前正式版） | `main` | 2.3.1 |
| **1.x**（旧版） | `raycast-v1` | 1.104.25（v1 线的最后一版，2026-08-18 发布） |

`raycast-v1` 只钉了依赖，**源码一行没动** —— 这个扩展用到的 API 全都是 v1 就有的。
反过来，1.x 构建的扩展在 v2 应用上同样受支持，所以**拿不准自己用的是哪个版本时，直接装 `raycast-v1` 即可**。

```bash
# 只需要把上面第 1 步的克隆换成这条（其余完全一样）
git clone -b raycast-v1 https://github.com/grunmin/deepseek-quick.git

# 如果那台机器上已经克隆过（现在停在 main），切分支即可，依赖要重装
git fetch origin && git checkout raycast-v1 && npm install && npm run dev
```

> 不想用 git：在 [GitHub 仓库页](https://github.com/grunmin/deepseek-quick)把分支切到 `raycast-v1`
> → `Code` → `Download ZIP`，解压后同样 `npm install && npm run dev`。
>
> 两条分支的功能完全一样（`src/` 一字不差），差别只在 `package.json` 的依赖 ——
> 因为 v1 应用里没有 2.x 的 API runtime。日常开发在 `main`，改动再同步到 `raycast-v1`。

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

> ⚠️ **卸载会连同对话历史一起删掉** —— 历史存在 Raycast 分配给这个扩展的私有加密存储里，
> 卸载即清除，且不可恢复。动手前先跑 **`Backup History`** 导出成 JSON。
> 详见[数据安全与备份](#数据安全与备份)。

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
| **Quick Action Reasoning** | `none` | 解释 / 翻译 / 改写 / 执行 prompt / 看图的**全局默认**思考强度。默认不思考，最快 |
| **Chat Reasoning** | `low` | Chat / 继续讨论的**全局默认**思考强度 |
| **Translate Direction** | 开 | 「中英互译」：自动判断中文→英文 / 英文→中文。开启时忽略下面的 Translate To |
| **Translate To** | `中文` | 关闭「中英互译」后才生效，用来指定单一目标语言 |
| **Reasoning** | 关 | 是否在结果里显示模型的思考链 |
| **Output Behavior** | `replace` | 结果页主操作（`↵`）：替换选中文本 / 复制 |
| **Agent Command** | `/bin/bash` | `Agent` 命令要启动的可执行文件 |
| **Agent Arguments** | dsh 的 ACP 桥脚本 | 上面那个命令的参数。支持 `~` 与引号；指向任何**会说 ACP** 的 agent 都行 |
| **Agent Working Directory** | 空（家目录） | agent 的工作目录，它的相对路径都基于这里。建议填你常改的项目目录 |
| **Agent Process Display** | `只看结果` | `Agent` 面板里过程（工具调用 / 中间说明）显示到什么程度：只看结果 / 精简 / 详细 |

> 最后四项**只影响 `Agent` 命令**，跟前面那些「直连 DeepSeek API」的命令完全无关 ——
> 那几条命令不需要、也不使用任何 agent。

## 按命令自定义（模型 / 思考强度 / Prompt）

6 条 AI 命令（`Explain` / `Translate` / `Rewrite` / `Run Prompt` / `Ask About Image` / `Chat`）都能
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
只想**临时**试一个配置、不想改任何设置：结果页 `⌘K` → **换模型 / 换思考强度 / 换 Preset 重新生成**
（只影响这一次，见[下一节](#换模型--思考强度--preset-重新生成)）。

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
| `Run Prompt` | 把选中的文本当作 prompt 直接执行 | `⌥P` |
| `Ask About Image` | 对 Finder 里选中的图片提问 | `⌥G` |
| `Chat` | 多轮对话，可附加图片 | `⌥C` |
| `Chat with Selection` | 选中文字 / Finder 选中的图片 → 直接开聊（作为参考内容） | `⌥V` |
| `Agent` | 唤起一个真正的 agent（默认 dsh），跑工具 / 改代码 / 执行任务 | `⌥X` |
| `History` | 浏览历史对话并从任意一条继续 | — |
| `Configure Prompts` | 按命令自定义 system prompt（多行） | — |
| `Backup History` | 导出 / 导入对话历史，**设备迁移包**，并可抢救损坏数据 | — |
| `Chat Presets` | 管理 Chat 预设（prompt / 模型 / 思考强度） | — |

**设置热键**：Raycast 根搜索里输入命令名 → `⌘K` → **Configure Command** → **Record Hotkey**。

## 使用指南

### 解释 / 翻译 / 改写

1. 在**任意 App** 里选中一段文字（浏览器、编辑器、PDF 都行）。
2. 按对应热键（如 `⌥A` 解释）。
3. 结果流式显示。默认 `Output Behavior = replace` 时，按 `↵` 会把结果**直接替换**你刚选中的文本；
   想只复制就用 `⌘K` 里的「复制结果」（或在设置里把输出行为改成 `copy`）。
4. 想追问：`⌘N` → **继续讨论**，会带着「你的原文 + 模型回复」进入对话视图。

> 结果页底部会**始终**标出这次用的组合与 token 用量（如 `deepseek-flash · 不思考 · 12 in / 45 out`）；
> `reasoning` 和 `cache hit` 两项**只在非零时才出现** —— 看不到它们通常是正常的，
> 原因见下面的[用量与缓存](#用量与缓存)。
> 如果打开了 **Reasoning** 设置，思考链会以引用块形式显示在结果上方。

### 执行选中的 prompt

手里已经有一段写好的 prompt（笔记里收藏的、从网页复制的、模板里的）时，不用先开 Chat 再粘贴：

1. 在**任意 App** 里选中那段 prompt 文本。
2. 运行 `Run Prompt`（建议 `⌥P`）。
3. 选中的文本会**原样**作为 user 消息发给模型，结果流式显示。

和「解释 / 翻译 / 改写」的区别：那三条是「选中内容 + 固定指令」，做什么由内置 system prompt 决定；
`Run Prompt` 是「**选中内容就是指令**」，system prompt 只约束回答风格（直接执行、不复述指令、
有歧义时说明假设）。想换风格 → `Configure Prompts` 里的 **Run Prompt**，或结果页 `⌘K` → 自定义 Prompt。

- `⌘N` **继续讨论**：带着这条 prompt 和回复进入对话视图，方便追问。
- `↵` 的默认动作仍跟随全局 **Output Behavior**：`replace` 会把**你选中的 prompt 本身**替换成答案。
  如果那段 prompt 还要留着，把 Output Behavior 改成 `copy`，或在结果页 `⌘K` →「复制结果」。

### 换模型 / 思考强度 / Preset 重新生成

解释 / 翻译 / 改写 / 执行 prompt 这四条的结果页**没有输入框**（「问题」就是你的选区），
所以「换个配置再问一次」直接做成了结果页的动作，`⌘K` 打开：

| 动作 | 说明 |
|---|---|
| **重新生成（同配置）** `⌘⇧R` | 同样的输入、同样的配置再跑一次（模型有随机性，重跑常能拿到不同答案） |
| **换模型重新生成** ▸ | `deepseek-flash` / `deepseek-v4-pro` / 各 Preset 用到的模型；不在列表里的走「自定义模型…」手填 |
| **换思考强度重新生成** ▸ | None / Low / High / Max |
| **换 Preset 重新生成** ▸ | 内置（默认 / 资深模式 / 深度研究）+ 你自己建的预设 |

- **每次只动一个维度**，另外两个保持当前值。刻意**不做**「预设 × 模型 × 强度」的组合清单 ——
  那是 20+ 项，菜单没法用。要**整套**换就用 Preset：它本身就是「prompt + 模型 + 强度」的组合。
- 选 Preset 会连它的 **system prompt 一起换上**（和 Chat 里切换 Preset 的语义一致）。
  所以「用资深模式重新解释一遍」是预期用法；但拿「资深模式」去翻译可能就不翻译了 ——
  它的 prompt 会把翻译指令顶掉。内置的 **默认** 预设 = 回到这条命令自己的配置。
- 换完模型或强度后，这套配置就不再算某个预设了（底部标签里的预设名会消失）。
- 结果页底部**始终**标出这次用的组合，例如 `资深模式 · deepseek-v4-pro · reasoning high`。
- 这些切换**只影响这一次结果**：不改命令设置、不改预设、也不写历史（快捷命令本来就不存历史）。
- `Ask About Image` **没有**这个菜单 —— 换到不带 vision 的模型会直接失败。

> 为什么不是「在结果页给个输入框」：`Detail` 没有输入能力，`List` 的搜索栏又只能承载一个输入位
> （见 [AGENTS.md](./AGENTS.md) 约束 12）。所以这里走的是「预设好的几套配置 + 重跑」，
> 而不是自由输入。

### 用量与缓存

**为什么 `reasoning` / `cache hit` 常常是 0？** 这两个的原因完全不同，但都不是 bug。

**`reasoning` 为 0 —— 设计如此。**
快捷命令（解释 / 翻译 / 改写 / 执行 prompt / 看图）默认 `Quick Action Reasoning = none`，
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
│  🆕 最新一轮                                       │  ← 刚发的消息 + 正在流的回答永远在顶部
│  你                                               │
│  > 问题…                                          │
│  DeepSeek                                         │
│  回答…（Markdown，占满整宽、可滚动）                │
│  ────────────────────────────────────────────    │
│  📜 更早的对话（越往下越早）                        │
│  你 / DeepSeek …                                  │
└──────────────────────────────────────────────────┘
│ 发送 ↵   Actions ⌘K                               │
└──────────────────────────────────────────────────┘
```

- **输入**：直接在搜索栏打字，`↵` 发送。**没有弹窗、没有二次跳转**
- **回答永远看得见**：按 `↵` 之后详情面板会归位到顶部，顶部就是最新一轮（你刚发的那条 +
  正在逐字返回的回答），更早的对话按「越往下越早」接在后面。
  这是 Raycast 逼出来的做法：`List.Item.Detail` 没有滚动 API、滚动位置也不会跟随新内容，
  只能把新内容放在视口所在的位置（细节见 [AGENTS.md](./AGENTS.md) 约束 18）。
  生成过程中**不会再动滚动位置**，你往上翻历史时不会被拽回来。
- **切换会话**：`⌘P` 打开搜索栏右侧的**会话下拉**，选中即切换
- **切换预设**：`⌘K` → **切换 Preset** → 选一个（当前预设名会显示在输入框提示里）
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

### Chat 预设（Preset）

一套**可复用的「system prompt + 模型 + 思考强度」**。适合在几种固定角色之间切换。

**开箱即用的内置预设**（**可直接编辑** —— 改动以「覆盖」形式叠加，随时能恢复内置默认）：

| 预设 | 模型 | 思考强度 | 用途 |
|---|---|---|---|
| **默认** | 跟随命令 / 全局 | 跟随命令 / 全局 | 轻量快捷的日常问答 |
| **资深模式** | `deepseek-flash` | `high` | 资深专家口吻：结论先行、讲取舍、点风险、给可执行建议 |
| **深度研究** | `deepseek-flash` | `high` | 严谨拆解：显式假设、多方案对比、区分事实与推测、标注边界 |

根搜索运行 **`Chat Presets`**（或 Chat 里 `⌘K` → **切换 Preset** → **管理 Presets…**）：

- **内置预设**：`⌘K` → **编辑（覆盖内置）**，改 prompt / 模型 / 思考强度；改完会标记
  「已自定义」，随时可 **恢复内置默认**，也能「复制为新的」变成独立预设
  - 改回与内置**完全一致**时，覆盖会自动清除（不会把内置值固化成一份副本）
  - 「默认」是例外：它代表"让 Chat 用它原本的配置"，prompt 去 **Configure Prompts** 改、
    模型与强度去命令设置改
- **自定义预设**：新建 / 编辑 / 复制 / 删除；删除正在用的会自动回落到内置「默认」
- **设为当前 Preset**：Chat 里立刻生效

在 Chat 里切换走 `⌘K` → **切换 Preset**（搜索栏那个位置只能放一个下拉，已经被会话占用），
当前预设名会显示在输入框提示里。

**回落规则** —— 留空、或选「跟随」，就往下掉一级：

```
预设自己的 prompt / model / effort
   ↓ 留空 或 选「跟随」
Chat 命令的 Model / Reasoning（Raycast 设置里选中 Chat 那条命令时的两项）
   ↓ 没设
扩展全局 Model / Chat Reasoning
```

「默认」预设 = 「让 Chat 用它原本的配置」：prompt 归 **Configure Prompts** 管，
模型与强度归 Chat 命令的设置管。其它内置预设出厂值写在代码里，但你可以覆盖。
一句话区分：**想临时换一种聊法 → 切预设；想改"默认长什么样" → Configure Prompts + 命令设置。**

> ⚠️ 预设是**全局当前项**，不是每条会话各记一个。切换后对**所有会话**的下一条消息生效 ——
> 好处是可以把一段聊到一半的对话随时切到另一个角色继续；切换时当前对话的 system 也会同步更新。

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

### Agent（ACP）：把任务交给真正的 agent

前面所有命令都是「选中文本 → 调一次对话补全 API」。`Agent` 不一样：它对面的
**是一个 agent**（默认 dsh），会真的读文件、跑命令、改代码 —— 工具调用按时间线渲染出来，
而不是藏在转圈的 loading 后面。展示上默认走「**过程简明、结论完整**」：几十次工具调用收成
一行行摘要，你要的那段结论始终是面板上最完整的内容（详见下面的「用起来是什么样」）。

```
按热键  →  搜索栏输入任务  →  ↵
         →  agent 开始干活：读文件 / 跑命令 / 写代码（过程收成一行行摘要）
         → 需要危险操作时弹原生审批对话框
         →  最终结论完整铺在面板上
```

**为什么是 ACP，不是再写一套 API 调用**：[ACP（Agent Client Protocol）](https://agentclientprotocol.com)
是编辑器（Zed 等）和 agent 之间的标准线格式，dsh / codex 都已经会说。所以这里做的是一个
**ACP 客户端**，换 agent 只要改扩展设置里的 **Agent Command / Agent Arguments** ——
不用为一个新 agent 写适配层。

#### 先决条件（dsh）

默认配置指向 dsh 官方给 Zed 用的那条 ACP 启动脚本：

```
~/.dsh/profiles/acp-enhanced/node_modules/dsh-acp-enhanced/scripts/dsh-acp-zed.sh
```

装了 dsh 并且创建过 `acp-enhanced` profile 就有它（Zed 的 `agent_servers` 里通常已经配过一次）。
用别的 agent，就把 **Agent Command** 指到它的 ACP 入口（例如 `codex-acp`），
**Agent Arguments** 留空或填它的参数。

> `Agent` 命令和 API Key 无关：它把活交给外部 agent，凭据由那个 agent 自己管。
> 反过来，前面那些直连 API 的命令也用不到这三项 Agent 设置。

#### 用起来是什么样

| 操作 | 说明 |
|---|---|
| 搜索栏输入 → `↵` | 发送这一轮任务；跑着的时候同一个 `↵` 变成**打断**（agent 的会话状态经不起并发追发） |
| 过程显示 | 默认**只看结果**：面板上只有你的话 + 最终结论，过程收成一行统计（`🛠 12 步工具调用`）。切「精简」则是每个工具一行（`✅ bash · date`、`📝 /tmp/a.txt +3 −1`）；**失败的工具与审批提示**在任何档位都留着 |
| 最终结论 | 本轮**最后一段正文**永远完整显示，过程性说明不会跟它抢位置（流式期间正在写的那段就是结论，边写边读） |
| `⌘K` → 过程显示 | 临时切 `只看结果`（默认）/ `精简` / `详细`（工具卡片 + 完整输出 / diff）。**只影响本次窗口**；改默认值去扩展设置的 **Agent Process Display**（面板里 ⌘K →「配置 Agent 启动命令 / 工作目录」也能跳过去） |
| 审批 | agent 要危险操作时弹 Raycast 原生对话框，**允许 / 拒绝**，结果写回 agent；弹窗期间 agent 会等你的答复 |
| 会话下拉（`⌘P`） | 切换会话 / 开新会话。列表来自 agent 自己的会话存储 —— **dsh web / TUI 建的会话也在这里** |
| `History` → Agent 会话 | 同一个会话库的另一入口：按时间倒序、显示项目与时间、可按项目筛选、`↵` 用 `session/load` 接回来继续（内容不复制到 Raycast，见[历史记录](#历史记录与继续对话)） |
| `⌘K` → 会话配置 | 模型 / 推理强度 / 权限模式 / agent 预设。候选是 agent **实时报上来的**，不用在扩展里维护一份目录 |
| `⌘K` → 斜杠命令 / 技能 | agent 声明的 `/命令`（dsh 的 skills 也在里面），选中即填进输入框 |
| `⌘⇧C` / `⌘⌥C` | 复制本次回复 / 复制完整对话（含工具输出全文）—— 折叠掉的过程在这里能拿回来 |

热键建议 `⌥X`。**只开一个窗口、不拉浏览器和编辑器** —— 这就是当初想要的那个东西。

#### 默认的权限模式

模式由 agent 那边决定（dsh 的默认是 `danger-full-access`，会直接动手不问你）。
想更保守，就在 `⌘K` → 会话配置 → **权限模式** 里切 `read-only` / `workspace-write`；
`read-only` 下写文件会触发审批请求，正好用来验证审批链路。

#### 排在后面的事

- 图片/截图作为上下文（`Agent` 目前只发文本；ACP 的 `promptCapabilities.image` 已经就绪）
- 与快捷命令联动（比如「解释选中文本」的结果直接丢给 agent 继续做）
- 常驻 daemon：现在一条命令 = 一个 agent 进程，冷启动 ~1s；常驻的话可以做到零等待

### 历史记录与继续对话

- `Chat`（含从快捷命令转进来的对话）会自动写历史，存在 Raycast 的 `LocalStorage` 里；
  最多保留 **200** 条会话，超出后丢弃最旧的。
- `History` 命令（或 Chat 里 `⌘⇧H`）打开两栏浏览器：左侧列表 + 右侧内容预览。
  `⌘K` → **继续这条对话** 从任意一条历史接着聊；`⌘X` 删除。
- History 里还有第二个分区 **「Agent 会话」**，但它和上面的「对话」**来源完全不同**：

| | 对话（Chat） | Agent 会话 |
|---|---|---|
| 正本在哪 | Raycast 的 `LocalStorage` | **agent 自己的会话存储**（dsh web / TUI 共用同一份） |
| History 怎么来的 | 本地读取 | 每次打开 History 用 `session/list` **实时列台账** |
| 有没有副本 | 有（就是正本） | **没有副本** —— 所以永远不会和 agent 侧不一致 |
| 怎么继续 | `↵` 直接在 Chat 里续聊 | `↵` 用 `session/load` 在 Agent 面板里接回去 |
| 进迁移包吗 | 进（`Backup History`） | 不进（内容不归 Raycast 管） |
| 列表内容 | 全文可搜索、可预览 | 只有标题 / 项目 / 时间；全文进 Agent 面板看 |

> Agent 会话刻意**不镜像一份到本地**：镜像会和 agent 侧漂移（在 dsh web / TUI 继续过的会话，
> 副本不会知道），还要多一个要迁移的存储 key。代价是打开 History 要**冷启动一次 agent**
> 去查台账（实测 459 条会话时约 **3.3s**：握手 ~1s + agent 扫会话库 ~2s；15s 内重开走缓存，瞬时），
> 且列表只有标题 —— agent 那边可能有几百条会话，所以列表按时间倒序、
> 默认折叠「没跑过内容、没有标题的空会话」，并可按**项目**筛选、一次最多铺 60 条。

### 数据安全与备份

历史存在 **Raycast 分配给扩展的私有加密存储**里（底层 `main.db` 是加密的，外部工具读不了），
并且**不跨设备同步**（Cloud Sync 是 Raycast Pro 功能）。所以下面这些必须知道：

| 场景 | 会不会丢 | 说明 |
|---|---|---|
| 关掉 `npm run dev` / 重启 Raycast | ❌ 不会 | 扩展仍留在 Raycast 里，数据也在 |
| **卸载扩展** | ⚠️ **会丢** | 扩展私有数据一并清除，不可恢复 |
| **改 `package.json` 的 `name`** | ⚠️ **等于清空** | 扩展标识变了，存储命名空间跟着变，历史"凭空消失" |
| 对话超过 **200 条** | ⚠️ 丢最旧的 | 上限写死在代码里，超出静默丢弃 |
| 继续一条**带图**的旧对话 | ⚠️ 图丢了 | 历史里图片只存 `[图片]` 占位，模型看不到原图 |
| 换机 / 重装系统 / 换 Raycast 账号 | ⚠️ 会丢，但**可迁移** | 没有同步，数据只在这台机器上 → 用 **设备迁移包**搬过去 |
| 存储数据损坏 | ✅ **不会静默丢** | 进入**保护模式**：拒绝写入 + 自动备份原始数据 |

**所以：定期跑 `Backup History` 导出。换机就导「设备迁移包」。**

```
根搜索 → Backup History
├── 📊 状态                  对话数 / 占用体积 / 是否损坏
├── 📦 导出设备迁移包…        历史 + Preset + Prompt 覆盖，换机用这个
├── 📥 导入设备迁移包…        先预览改动，确认后写入（带撤销点）
├── ↩️ 撤销上一次导入          仅在刚导入过时出现
├── 📤 导出到文件…            只导对话历史（旧格式，仍然兼容）
├── 📋 复制为 JSON            直接进剪贴板
├── 📥 从文件导入（合并）      按 id 合并，不会覆盖现有历史
├── 📂 在 Finder 中显示数据目录
└── 🚑 抢救损坏数据（仅在检测到损坏时出现）
    ├── 导出损坏的原始数据
    └── 清除全部历史数据并重新开始
```

导出文件格式（导入时按对话 `id` 去重，以 `updatedAt` 更新的为准）：

```json
{
  "format": "deepseek-quick.history",
  "version": 1,
  "exportedAt": "2026-09-13T13:00:00.000Z",
  "conversations": [ { "id": "c_...", "title": "...", "createdAt": 0, "updatedAt": 0, "messages": [] } ]
}
```

> **关于"保护模式"**：如果历史数据解析失败，扩展**不会**把它当成"空历史" ——
> 那样下一次保存就会把原始数据**永久覆盖**。取而代之的是：拒绝所有写入、把原始字符串
> 原样备份一份，并在 Chat 顶部和 `History` 里明确提示。
> 这是刻意设计，不是 bug，别把它"优化"掉。

### 换机迁移

新机器上 `git clone` + `npm install` + `npm run dev` 之后，**代码有了，但数据没有** ——
历史、Chat 预设、每条命令的 prompt 覆盖都存在 Raycast 的加密本地库里，不跟着代码走。

用 **设备迁移包**（`Backup History → 📦 导出设备迁移包…`）把不可重建的部分一次搬过去：

| 会带走 | 不会带走 |
|---|---|
| 对话历史 | **API Key** —— 密钥不该跟着文件走，新机器上重填更安全 |
| 自定义 Chat Preset | Raycast 偏好设置（模型 / 思考强度 / 翻译方向…）—— 存在 Raycast 偏好库，没有导入接口，只能在设置里手填一次 |
| 当前选中的 Preset | |
| 内置 Preset 覆盖（资深模式 / 深度研究上改过的） | |
| 各命令的 system prompt 覆盖 | |

完整流程：

```bash
# ① 旧机器：确认代码已推上去
git push

# ② 新机器：装好代码
git clone https://github.com/grunmin/deepseek-quick.git
cd deepseek-quick && npm install && npm run dev

# ③ 新机器：填一次 API Key（或用 DEEPSEEK_API_KEY / ~/.dsh/.credentials.yaml）

# ④ 旧机器：Backup History → 📦 导出设备迁移包…（文件丢进 iCloud / U 盘 / 网盘）
# ⑤ 新机器：Backup History → 📥 导入设备迁移包… → 选文件 → 看预览 → 确认
```

**导入是"合并 + 定向替换"，不是全量覆盖**，因为有些数据不能丢、有些必须能改：

| 内容 | 规则 |
|---|---|
| 对话历史 | 按 `id` 合并，`updatedAt` 更新的胜出 —— **不会清空**本机现有历史 |
| 自定义 Preset | 按 `id` 合并，同上 |
| 命令 prompt 覆盖 | 包里有哪个命令就替换哪个，本机其余命令**保持原样** |
| 内置 Preset 覆盖 | 同上，按预设 id 替换 |
| 当前选中的 Preset | 包里指定了才改 |
| 损坏历史的原始数据 | 仅在本机没有时恢复，**绝不覆盖**本机已有的抢救数据 |

确认页会把这些改动逐条列出来，会覆盖本机配置的项标 ⚠️。写入前自动存一个**撤销点**，
回到 `Backup History` 就能「撤销上一次导入」（只保留最近一次）。

迁移包格式（普通 JSON，可读可手改；导入端同时兼容旧的「只有历史」文件）：

```json
{
  "format": "deepseek-quick.migration",
  "version": 1,
  "exportedAt": 1757769600000,
  "extension": "deepseek-quick",
  "features": ["history", "presets", "activePreset", "presetOverrides", "promptOverrides"],
  "payload": {
    "history": { "format": "deepseek-quick.history", "version": 1, "exportedAt": 0, "conversations": [] },
    "presets": [ { "id": "p_...", "name": "我的预设", "systemPrompt": "...", "effort": "high" } ],
    "activePreset": "p_...",
    "presetOverrides": { "__senior__": { "effort": "max" } },
    "promptOverrides": { "explain": "只讲重点" }
  }
}
```

> 空的部分不会写进文件；`features` 只列出实际带上的段。导入端遇到不认识的段会**跳过并提示**，
> 所以新版本导出的包拿到旧版本上不会静默丢数据冒充成功。
> 实现见 `src/lib/migration.ts`，行为验证见 `npm run verify`。

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
- **为什么对话是「最新一轮置顶」**：`List.Item.Detail` 没有滚动 API，滚动位置既不跟随新内容、
  也无法用代码挪到底部。想让「你刚发的内容 + 正在返回的回答」出现在视口里，就只能把它放在内容开头；
  按 `↵` 时还会做一次"归零"短渲染，保证哪怕你已经翻到别处也会跳回顶部（见 AGENTS.md 约束 18）。
- **流式节流**：每 80ms 才 `setState` 一次并做去重，否则 Raycast 会警告
  「rendering a lot without any changes」，严重时会直接终止扩展。

### Agent 命令（ACP 链路）

```
按热键 → AgentView
        ├─ agentLaunch()：扩展偏好 → { command, args, cwd }（展开 ~、校验目录）
        ├─ AcpClient.spawn()：一条命令 = 一个 agent 子进程
        │     stdio 上跑 NDJSON + JSON-RPC 2.0
        ├─ initialize → session/new（或 session/list → session/load 接回旧会话）
        ├─ session/prompt ──┬─ session/update（流式文本 / 思考 / 工具卡片 / 用量）
        │                   └─ session/request_permission（→ 原生确认框 → 回执）
        └─ TranscriptModel.apply() → transcriptMarkdown() → Detail 面板
```

几个关键设计点：

- **协议自己手写，不引 SDK**：ACP 的传输就是「一行一个 JSON」，没有 Content-Length 分帧。
  `src/lib/acp/client.ts` 只依赖 node 内置模块 —— 这带来一个很实际的好处：
  它能被 `npm run verify:acp` 直接编译执行，对着**真的 agent** 跑端到端回归，不用开 Raycast 手工点。
- **客户端能力声明为「什么都不会」**：`fs` / `terminal` 都声明 `false`。这不是偷懒 ——
  声明 `true` 意味着 agent 会把读写文件、跑命令**代理给客户端**（Zed 就是这么把编辑塞进自己的
  diff 视图的）。面板不提供这些，让 agent 用它自己的工具闭环反而更简单，审批语义也更清楚。
- **会话存在 agent 那边**：命令窗口关掉、子进程退出都不影响会话。下拉列表直接来自
  `session/list`，`session/load` 接回来时 agent 会把历史用 `session/update` **重放**一遍
  （实测重放 `user_message_chunk` + `agent_message_chunk`，不含工具调用）。
- **审批请求只带 `toolCallId`**：线上不带工具详情，客户端必须自己按 id 回查刚才那条
  `tool_call` —— 否则对话框上只有一串 uuid，用户不知道自己在批准什么。
- **未知的 `sessionUpdate` 一律忽略**：ACP 在持续加新类型，写死联合会让「多一个字段就编译不过」，
  忽略未知类型本身就是规范要求的行为。

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
| `Agent` 一直转圈 / 提示「agent 启动失败」 | 启动链是 `Raycast → bash → node → dsh → profile`，任何一环缺了都长这样。面板会带上子进程的 **stderr 尾巴**（`⌘K` → 重启 agent 可重看）；也看 `/tmp/dsq-debug.log` 里的 `agent/acp:` 与 `agent/stderr:` 行 |
| `Agent` 提示工作目录不存在 | 扩展设置里的 **Agent Working Directory** 填了不存在的路径，或留空以外的相对路径 |
| `Agent` 里读不到 dsh 的旧会话 | 会话列表来自 agent 的 `session/list`；只列同一次配置（同一 profile / 同一 DSH_HOME）下的会话 |
| 想看清楚发生了什么 | 看 `/tmp/dsq-debug.log`（见下方「调试日志」） |

### 调试日志

请求和响应会以追加方式写入 **`/tmp/dsq-debug.log`**：

```bash
tail -f /tmp/dsq-debug.log
```

日志里能看到：请求的 endpoint / model / effort、消息条数、HTTP 状态、返回内容长度和 token 用量。
实现见 `src/lib/debug.ts`。**不需要的话**删掉 `debug.ts` 以及各文件里的 `dbg()` 调用即可，不影响功能。

## 已知限制

- 历史存在 Raycast 本地加密库，**不跨设备同步**（Cloud Sync 是 Raycast Pro 功能）；
  定期用 `Backup History` 导出；换机用**设备迁移包**（见[换机迁移](#换机迁移)）
- API Key 和 Raycast 偏好**不进迁移包**：前者是密钥不该跟着文件走，后者存在 Raycast 偏好库里、没有导入接口
- 历史最多保留 **200** 条，超出后丢弃最旧的
- 改 `package.json` 的 `name` 等于换了一个扩展，已有历史会读不到（不是删了，是命名空间变了）
- 历史里图片只存 `[图片]` 占位，继续带图旧对话时模型看不到原图
- 图片只在 `Ask About Image` 和 `Chat` 的附件里支持，纯文本快捷命令不处理图片
- `Ask About Image` 的结果页没有「换模型 / 强度重新生成」：换到不带 vision 的模型会直接失败
- 长对话不做自动摘要，靠 DeepSeek 自己的上下文窗口
- Raycast 扩展 API **没有真正的 sidebar**，会话列表只能用「左侧列表 + 右侧预览」（`List.isShowingDetail`）替代
- `Agent` 命令一条命令 = 一个 agent 子进程：**关掉命令窗口就会把它杀掉**（会话本身存在 agent 那边，
  下次用下拉接回来不会丢）；冷启动约 1 秒（握手 0.4s + 建会话 0.5s）
- `Agent` 目前只发**纯文本**：图片、截图、当前选区都还没接（ACP 那边 `promptCapabilities.image`
  已经可用，是这边没做）
- 工具卡片是**渲染出来的 Markdown**：不是可点击的控件（Raycast 的详情面板本来就没有交互能力），
  路径要去编辑器里打开得自己复制
- `Agent` 的历史**不复制**到 Raycast 里：正本是 **agent 自己的会话存储**（dsh web / TUI 的会话
  和它是同一份）。`History` 命令会用 `session/list` 把它**列出来**（可按项目筛选、`↵` 接回去继续），
  但内容仍归 agent 管，因此也不走 `Backup History` 的迁移包
- 只有会说 ACP 的 agent 能用：`codex-acp` 之类的桥没问题，纯 CLI（只会 `codex exec`）不行
- 无法从 Raycast 商店安装（这是个人私有扩展）

## 开发

```bash
npm install      # 安装依赖
npm run dev      # ray develop：导入 Raycast + 热更新监听
npm run build    # ray build -e dist：构建产物到 dist/
npm run lint     # ray lint
npm run fix-lint # ray lint --fix
npm run verify   # 迁移模块的行为验证（Node 直接跑，不依赖 Raycast）
npm run verify:acp  # ACP 客户端 / 渲染层 / 启动参数的行为验证
npx tsc --noEmit # 类型检查（无副作用，CI 友好）
```

> `npm run verify` 用 esbuild 把 `src/lib/migration.ts` 编成 CJS、把 `@raycast/api` 换成
> 内存版 `LocalStorage`，然后真跑「A 机器导出 → B 机器导入 → 撤销」全流程（含旧格式兼容、
> 未知字段、id 冲突、损坏数据不覆盖等边界）。改迁移逻辑后请先跑它。

> `npm run verify:acp` 分两段：先是渲染规则 / 回显与重放 / 参数切分的纯逻辑断言，
> 然后**真的启动一个 agent** 跑完「握手 → 开会话 → 一问一答 → 工具调用 → 审批回执 →
> 列会话 → 载入会话 → 取消」。`src/lib/acp/*` 刻意不引 `@raycast/api` 就是为了这个 ——
> 协议层的回归不用开 Raycast 手工点。**这一段会消耗 token。**
> 换 agent：`DSQ_ACP_LAUNCH=/path/to/agent node scripts/verify-acp.mjs`。

改代码前请先读 **[AGENTS.md](./AGENTS.md)**，里面记录了 19 条**已修复、不要改回去**的硬性约束。

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
│   │   ├── history.ts          LocalStorage 历史存储（损坏保护、剥图片、限 200 条）
│   │   ├── agent-sessions.ts   History 里实时列举 agent 侧会话（不镜像内容，用完即收进程）
│   │   ├── images.ts           图片文件 → data URI
│   │   ├── selection.ts        「当前选区」统一读取（文字 / Finder 图片）
│   │   ├── prompt-config.ts    每命令 system prompt 覆盖（LocalStorage）
│   │   ├── presets.ts          Chat 预设 + 快捷命令的 Preset 回落解析（逐级回落）
│   │   ├── migration.ts        设备迁移包：打包 / 解析 / 预览 / 撤销点
│   │   ├── use-stream.ts       流式状态 hook（80ms 节流 + 去重）
│   │   ├── acp/
│   │   │   ├── client.ts        ACP 客户端：stdio 上手写 NDJSON + JSON-RPC（不引 SDK）
│   │   │   ├── render.ts        session/update → 对话模型 → Markdown（三档过程显示 / diff / 用量）
│   │   │   ├── launch.ts        偏好 → spawn 三元组（展开 ~、切参数、校验 cwd）
│   │   │   └── types.ts         用到的 ACP 线上类型的最小闭包
│   │   └── debug.ts            追加写 /tmp/dsq-debug.log
│   ├── components/
│   │   ├── quick-action.tsx    读选中文本的通用外壳（解析本命令的 prompt）
│   │   ├── result-view.tsx     快捷命令结果页（流式 + 替换/复制 + 继续讨论 + 换配置重新生成）
│   │   ├── chat-view.tsx       多轮对话主界面
│   │   ├── agent-view.tsx      Agent 面板（agent 进程 + 工具时间线 + 审批 + 会话切换）
│   │   ├── history-view.tsx    两栏历史（对话 + Agent 会话两分区，后者实时列举）
│   │   ├── prompt-config-view.tsx   Configure Prompts 界面
│   │   ├── chat-presets-view.tsx    Chat Presets 管理界面
│   │   └── history-backup-view.tsx  Backup History：导出 / 导入 / 抢救
│   ├── explain.tsx             ┐
│   ├── translate.tsx           │
│   ├── rewrite.tsx             │
│   ├── run-prompt.tsx          │
│   ├── ask-image.tsx           │ 12 个命令入口，
│   ├── chat.tsx                │ 每个对应 package.json 里的一条 command
│   ├── agent.tsx               │
│   ├── chat-selection.tsx      │
│   ├── history.tsx             │
│   ├── configure.tsx           │
│   ├── backup.tsx              │
│   └── presets.tsx             ┘
├── scripts/
│   ├── verify-migration.mjs    迁移包的行为验证
│   └── verify-acp.mjs          ACP 协议层的行为验证（含真实 agent 端到端）
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
