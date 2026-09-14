/**
 * ACP 客户端 / 渲染层 / 启动参数解析的行为验证。
 *
 * 分两段：
 *   1. 纯逻辑断言（渲染规则、回显与重放、参数切分）—— 不碰网络，秒级跑完；
 *   2. **对着真的 agent 跑一遍端到端**：握手 → 开会话 → 一问一答 → 触发工具调用 →
 *      审批回执 → 列会话 → 载入会话 → 取消。这一段会真的启动 dsh 并消耗 token。
 *
 * 之所以值得这么写：UI 只能靠 Raycast 手工点，但整套协议交互都在
 * `src/lib/acp/*` 里，而且那几个文件**刻意不引 `@raycast/api`** —— 于是可以在这里直接
 * 编译执行。协议层回归（比如「审批请求只带 toolCallId」这种坑）就不必等手工点才发现。
 *
 * 运行：node scripts/verify-acp.mjs
 *      没装 dsh 的话，用 DSQ_ACP_LAUNCH=/path/to/<你的 ACP agent> node scripts/verify-acp.mjs
 */
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.log(`  ✗ ${label}\n      实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}
function ok(label, condition) {
  check(label, Boolean(condition), true);
}

/* ── 编译被测模块：三个文件都不依赖 @raycast/api，所以不需要 mock ── */
const tmp = await mkdtemp(join(tmpdir(), "dsq-acp-"));
const outfile = join(tmp, "acp.cjs");
await build({
  stdin: {
    contents: `export * from "./client";\nexport * from "./render";\nexport * from "./launch";\n`,
    resolveDir: join(process.cwd(), "src/lib/acp"),
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const acp = await import(pathToFileURL(outfile).href);

/* ══════════════════════ 1. 纯逻辑 ══════════════════════ */

console.log("场景 1：渲染层（工具卡片 / diff / 用量）");
{
  const model = new acp.TranscriptModel();
  model.startLocalTurn("跑一下 date");
  model.apply({ sessionUpdate: "agent_thought_chunk", content: { text: "先跑个命令看看。" } });
  model.apply({
    sessionUpdate: "tool_call",
    toolCallId: "c1",
    name: "bash",
    title: "date",
    kind: "execute",
    status: "in_progress",
    content: [{ type: "terminal", terminalId: "c1" }],
  });
  model.apply({
    sessionUpdate: "tool_call_update",
    toolCallId: "c1",
    status: "completed",
    rawOutput: { formatted_output: "Sun Sep 13 23:27:57 CST 2026\n", exit_code: 0 },
  });
  model.apply({ sessionUpdate: "agent_message_chunk", content: { text: "输出是 `Sun Sep 13`。" } });
  model.apply({
    sessionUpdate: "usage_update",
    used: 9587,
    size: 1000000,
    _meta: { inputTokens: 9587, outputTokens: 55, reasoningTokens: 0, cacheHitRate: 0, tps: 62.6 },
  });
  model.finishTurn("end_turn");

  const md = acp.transcriptMarkdown(model, { showReasoning: true });
  ok("工具卡片带状态图标与工具名", md.includes("✅ bash"));
  ok("工具标题在卡片上", md.includes("date"));
  ok("命令输出进 bash 代码块", md.includes("```bash") && md.includes("Sun Sep 13 23:27:57"));
  ok("回复正文在时间线上", md.includes("输出是 `Sun Sep 13`"));
  ok("思考链只在 showReasoning 时出现", md.includes("💭"));
  ok("用量只在非零项上出现（tps）", md.includes("63 tps") || md.includes("62 tps"));
  ok(
    "零值不显示（reasoning 0 / 缓存 0）",
    !md.includes("思考 0") && !md.includes("缓存 0%"),
  );
  const hidden = acp.transcriptMarkdown(model, { showReasoning: false });
  ok("关掉 showReasoning 后思考链消失", !hidden.includes("💭"));

  const withDiff = new acp.TranscriptModel();
  withDiff.startLocalTurn("改文件");
  withDiff.apply({
    sessionUpdate: "tool_call",
    toolCallId: "c2",
    name: "write",
    title: "Write /tmp/a.txt",
    kind: "edit",
    status: "in_progress",
    content: [{ type: "diff", path: "/tmp/a.txt", oldText: "a\nb\nc\n", newText: "a\nB\nc\n" }],
  });
  withDiff.finishTurn();
  const diffMd = acp.transcriptMarkdown(withDiff, { showReasoning: false });
  ok("diff 渲染成 diff 代码块", diffMd.includes("```diff"));
  ok("diff 含删除行与新增行", diffMd.includes("-b") && diffMd.includes("+B"));
  ok("diff 保留了上下文行", diffMd.includes(" a") && diffMd.includes(" c"));
}

console.log("\n场景 1b：过程展示的三档（精简 / 只看结果 / 详细）");
{
  // 一轮典型任务：中间说明 → 跑命令 → 改文件 → 结论
  const model = new acp.TranscriptModel();
  model.startLocalTurn("看看时间并改一行");
  model.apply({ sessionUpdate: "agent_message_chunk", content: { text: "我先看看现状。" } });
  model.apply({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    name: "bash",
    title: "date",
    kind: "execute",
    status: "in_progress",
  });
  model.apply({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    rawOutput: { formatted_output: "Sun Sep 13 23:27:57 CST 2026\n" },
  });
  model.apply({
    sessionUpdate: "tool_call",
    toolCallId: "t2",
    name: "edit",
    title: "Edit /tmp/a.txt",
    kind: "edit",
    status: "completed",
    content: [{ type: "diff", path: "/tmp/a.txt", oldText: "a\nb\nc\n", newText: "a\nB\nc\n" }],
  });
  model.apply({ sessionUpdate: "agent_message_chunk", content: { text: "结论：已经改好了。" } });
  model.finishTurn("end_turn");

  const detailed = acp.transcriptMarkdown(model, { showReasoning: false, detail: "detailed" });
  const concise = acp.transcriptMarkdown(model, { showReasoning: false, detail: "concise" });
  const minimal = acp.transcriptMarkdown(model, { showReasoning: false, detail: "minimal" });

  ok("详细档：命令输出进代码块", detailed.includes("```bash") && detailed.includes("Sun Sep 13"));
  ok("详细档：diff 正文进代码块", detailed.includes("```diff"));
  ok("详细档：中间说明原样显示", detailed.includes("我先看看现状。"));

  ok("精简档：工具收成一行", concise.includes("`✅ bash`") && !concise.includes("```bash"));
  ok("精简档：diff 只留统计", concise.includes("+1 −1") && !concise.includes("```diff"));
  ok("精简档：中间说明降级成引用", concise.includes("> 💬 我先看看现状"));
  ok("精简档：结论完整保留", concise.includes("结论：已经改好了。"));
  ok(
    "精简档：结论排在过程之后（时间线不乱）",
    concise.indexOf("结论：已经改好了。") > concise.indexOf("✅ bash"),
  );

  ok("只看结果档：过程收成一行统计", minimal.includes("2 步工具调用") && !minimal.includes("✅ bash"));
  ok("只看结果档：工具输出彻底不显示", !minimal.includes("Sun Sep 13") && !minimal.includes("```"));
  ok("只看结果档：中间说明也收掉", !minimal.includes("💬") && !minimal.includes("我先看看现状。"));
  ok("只看结果档：结论完整保留", minimal.includes("结论：已经改好了。"));

  // 失败的工具是「过程」里唯一不能省的信息：不然后面 500 字结论说「失败了」，
  // 用户还得去 ⌘⌥C 里翻原因
  const failing = new acp.TranscriptModel();
  failing.startLocalTurn("跑个不存在的命令");
  failing.apply({
    sessionUpdate: "tool_call",
    toolCallId: "f1",
    name: "bash",
    title: "definitely-not-a-command",
    kind: "execute",
    status: "failed",
    rawOutput: { formatted_output: "zsh: command not found: definitely-not-a-command\n", exit_code: 127 },
  });
  failing.apply({ sessionUpdate: "agent_message_chunk", content: { text: "这条命令不存在。" } });
  failing.finishTurn("end_turn");
  const failMd = acp.transcriptMarkdown(failing, { showReasoning: false, detail: "minimal" });
  ok("只看结果档也保留失败的工具", failMd.includes("`❌ bash`"));
  ok("失败原因即使折叠也留在面板上", failMd.includes("command not found"));

  // 不传 detail 时保持「全量」旧语义（端到端那一段就是这么调的）
  check(
    "detail 缺省 = 详细档",
    acp.transcriptMarkdown(model, { showReasoning: false }),
    detailed,
  );
}

console.log("\n场景 2：回显 vs 历史重放（同一种 user_message_chunk，两种语义）");
{
  // 实时：agent 会把我刚发的那条回显回来，不能因此多出一轮
  const live = new acp.TranscriptModel();
  live.startLocalTurn("你好");
  live.apply({ sessionUpdate: "user_message_chunk", content: { text: "你好" } });
  live.apply({ sessionUpdate: "agent_message_chunk", content: { text: "你好！" } });
  live.finishTurn("end_turn");
  check("回显不会多出一轮", live.turns.length, 1);
  check("回显不会污染提问文本", live.turns[0].user, "你好");

  // 重放：session/load 把旧对话原样推回来，这才是「新的一轮」
  const replay = new acp.TranscriptModel();
  replay.startReplay();
  replay.apply({ sessionUpdate: "user_message_chunk", content: { text: "早先的问题" } });
  replay.apply({ sessionUpdate: "agent_message_chunk", content: { text: "早先的回答" } });
  replay.endReplay();
  check("重放会重建轮次", replay.turns.length, 1);
  check("重放轮次标记为已结束（不会永远转圈）", replay.turns[0].finished, true);
  ok("重放内容在面板上", acp.transcriptMarkdown(replay, { showReasoning: false }).includes("早先的回答"));

  const unknown = new acp.TranscriptModel();
  unknown.startLocalTurn("x");
  unknown.apply({ sessionUpdate: "某天新增的类型", whatever: 1 });
  check("未知 sessionUpdate 被忽略而不是抛错", unknown.turns[0].steps.length, 0);
}

console.log("\n场景 3：启动参数解析");
{
  check("展开 ~", acp.expandHome("~/x/y", "/Users/me"), "/Users/me/x/y");
  check("单独的 ~", acp.expandHome("~", "/Users/me"), "/Users/me");
  check("展开 $HOME", acp.expandHome("$HOME/x", "/Users/me"), "/Users/me/x");
  check("参数按空白切分", acp.splitArgs("--foo bar"), ["--foo", "bar"]);
  check("双引号保留空格", acp.splitArgs(`-c "a b" c`), ["-c", "a b", "c"]);
  check("单引号保留空格", acp.splitArgs(`'a b' c`), ["a b", "c"]);
  check("空串得到空数组", acp.splitArgs("   "), []);

  let missingCwd = "";
  try {
    acp.resolveAcpLaunch({ command: "/bin/bash", args: "", cwd: "/definitely/not/here" }, homedir());
  } catch (err) {
    missingCwd = err.message;
  }
  ok("工作目录不存在时给出明确错误", missingCwd.includes("不存在"));

  const resolved = acp.resolveAcpLaunch(
    { command: "/bin/bash", args: "~/a.sh --x", cwd: "" },
    homedir(),
  );
  check("cwd 留空回落到家目录", resolved.cwd, homedir());
  check("args 里的 ~ 也展开", resolved.args[0], join(homedir(), "a.sh"));

  // 回归断言：默认 agentArgs 是 `~/...` 开头的，spawn 不做 shell 展开 ——
  // 漏掉这一步的表现是「默认配置一启动就没反应」，而且错误藏在子进程里
  const defaultLaunch = acp.resolveAcpLaunch(
    { command: "/bin/bash", args: acp.DEFAULT_AGENT_ARGS, cwd: "" },
    homedir(),
  );
  ok("默认 agentArgs 展开后指向真实存在的文件", existsSync(defaultLaunch.args[0]));
}

console.log(`\n（临时构建产物：${tmp}）`);

/* ══════════════════════ 2. 对着真 agent 跑 ══════════════════════ */

const launcher = process.env.DSQ_ACP_LAUNCH;
const defaultLauncher = join(
  homedir(),
  ".dsh/profiles/acp-enhanced/node_modules/dsh-acp-enhanced/scripts/dsh-acp-zed.sh",
);

if (!launcher && !existsSync(defaultLauncher)) {
  console.log("\n⚠️ 找不到 ACP agent 启动脚本，跳过端到端部分。");
  console.log(`   期望路径：${defaultLauncher}`);
  console.log("   可用 DSQ_ACP_LAUNCH=<你的 ACP agent> 指定别的。");
  await rm(tmp, { recursive: true, force: true });
  console.log(failures === 0 ? "\n✅ 纯逻辑部分全部通过" : `\n❌ ${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

const scriptPath = launcher ?? defaultLauncher;
const cwd = process.cwd();
console.log(`\n场景 4：端到端（agent = ${scriptPath}）`);
console.log("  会真的启动 agent 并消耗 token，请稍候…");

// 整段最坏情况兜底：宁可失败也不要挂着不退
const watchdog = setTimeout(() => {
  console.log("\n❌ 端到端验证超时（240s）");
  process.exit(1);
}, 240_000);

let sink = new acp.TranscriptModel();
const seenUpdates = [];
let permissionRequest = null;

const client = acp.AcpClient.spawn(
  { command: "/bin/bash", args: [scriptPath], cwd },
  {
    onUpdate: (update) => {
      seenUpdates.push(update.sessionUpdate);
      sink.apply(update);
    },
    onPermission: (request, respond) => {
      permissionRequest = request;
      // 验证的是「回执能不能被 agent 接受」，所以挑拒绝项，避免真去写文件
      const reject =
        request.options.find((option) => option.kind === "reject_once") ??
        request.options.find((option) => option.kind === "reject_always");
      respond(reject?.optionId ?? null);
    },
  },
);

try {
  const capabilities = await client.initialize();
  ok("握手返回 agentCapabilities", capabilities && typeof capabilities === "object");
  ok("agent 声明了 loadSession（会话可续）", capabilities.loadSession === true);

  const session = await client.newSession(cwd);
  const sid = session.sessionId;
  ok("session/new 返回 sessionId", typeof sid === "string" && sid.length > 0);
  ok("会话配置里带模型目录", (session.configOptions ?? []).some((option) => option.id === "model"));
  ok("会话带权限模式列表", (session.modes?.availableModes ?? []).length > 0);

  /* 一问一答 */
  sink = new acp.TranscriptModel();
  sink.startLocalTurn("只回答两个字：你好");
  const stop1 = await client.prompt(sid, "只回答两个字：你好。不要调用任何工具。");
  sink.finishTurn(stop1);
  check("一轮正常结束 stopReason=end_turn", stop1, "end_turn");
  ok("正文流到了模型里", seenUpdates.includes("agent_message_chunk"));
  ok("面板上能看到回答", acp.transcriptMarkdown(sink, { showReasoning: true }).includes("你好"));

  /* 工具调用 */
  sink = new acp.TranscriptModel();
  sink.startLocalTurn("跑 date");
  const stop2 = await client.prompt(sid, "用 shell 跑一下 `date -u`，把输出原样贴给我。不要做别的。");
  sink.finishTurn(stop2);
  const tools = [...sink.toolCalls.values()];
  ok("触发了工具调用", tools.length >= 1);
  ok("工具卡片跑到了 completed", tools.some((tool) => tool.status === "completed"));
  ok("工具输出被解析出来（不是原始 JSON）", tools.some((tool) => (tool.output ?? "").trim().length > 0));
  ok(
    "面板上有工具卡片",
    acp.transcriptMarkdown(sink, { showReasoning: false }).includes("✅"),
  );

  /* 审批：切到 read-only 后要求写文件，必然弹审批 */
  await client.setMode(sid, "read-only");
  sink = new acp.TranscriptModel();
  sink.startLocalTurn("写文件");
  const stop3 = await client.prompt(sid, "在 /tmp/dsq-acp-verify.txt 写入一行 hello。");
  sink.finishTurn(stop3);
  ok("收到了 session/request_permission", permissionRequest !== null);
  ok("审批请求带 options", (permissionRequest?.options ?? []).length > 0);
  ok("审批请求只带 toolCallId（客户端必须自己回查工具）", typeof permissionRequest?.toolCall?.toolCallId === "string");
  check("拒绝掉审批后这一轮仍然正常收尾", stop3, "end_turn");

  /* 会话管理 */
  const sessions = await client.listSessions();
  ok("session/list 里能找到这个会话", sessions.some((item) => item.sessionId === sid));

  // History 的「Agent 会话」分区就靠这几项做台账：标题当行标题、cwd 在 loadSession 时回落、
  // updatedAt 排序。字段一改名，那边不会报错、只会默默变空 —— 所以钉在这里
  {
    const mine = sessions.find((item) => item.sessionId === sid);
    ok("会话台账带 cwd（History 列表要显示，也要拿它回载）", mine?.cwd === cwd);
    ok("会话台账的 updatedAt 能解析成时间", Number.isFinite(Date.parse(mine?.updatedAt ?? "")));
    ok(
      "title 要么是字符串、要么缺席（空会话没标题是正常的）",
      sessions.every((item) => item.title === undefined || item.title === null || typeof item.title === "string"),
    );
    ok(
      "按 updatedAt 能排出一个非空的时间序",
      sessions.filter((item) => Number.isFinite(Date.parse(item.updatedAt ?? ""))).length > 0,
    );
  }

  sink = new acp.TranscriptModel();
  sink.startReplay();
  await client.loadSession(sid, cwd);
  sink.endReplay();
  ok("session/load 重放出了历史轮次", sink.turns.length >= 1);
  // 实测：session/load 会重放 user_message_chunk + agent_message_chunk（工具调用不在其中）
  const replayedMd = acp.transcriptMarkdown(sink, { showReasoning: false });
  ok("重放里有之前问过的内容", replayedMd.includes("date -u"));
  ok(
    "重放里有之前的回答",
    sink.turns.some((turn) => turn.steps.some((step) => step.kind === "message")),
  );

  /* 取消 */
  sink = new acp.TranscriptModel();
  sink.startLocalTurn("连跑几次 sleep");
  const pendingTurn = client.prompt(
    sid,
    "用 shell 依次执行 `sleep 1` 四次，每跑完一次向我汇报一次。",
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  client.cancel(sid);
  const stop4 = await pendingTurn;
  sink.finishTurn(stop4);
  check("取消后 stopReason=cancelled", stop4, "cancelled");
} catch (err) {
  failures += 1;
  console.log(`  ✗ 端到端流程抛错：${err?.message ?? err}`);
  const diagnostics = client.diagnostics;
  if (diagnostics) console.log(`      agent stderr 尾巴：\n${diagnostics.split("\n").slice(-10).join("\n")}`);
} finally {
  clearTimeout(watchdog);
  client.dispose();
  await rm(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
