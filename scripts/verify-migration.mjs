/**
 * 迁移模块的行为验证（一次性脚本，不入库）。
 *
 * 用 esbuild 把 src 编译成 CJS，并把 `@raycast/api` 替换成一个内存版 LocalStorage，
 * 然后跑「A 机器导出 → B 机器导入 → 撤销」全流程，检查真实状态。
 *
 * 运行：node scripts/verify-migration.mjs
 */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* ── 内存版 LocalStorage，模拟「一台机器」 ── */
function makeStore(name) {
  const map = new Map();
  return {
    name,
    map,
    LocalStorage: {
      async getItem(key) {
        return map.has(key) ? map.get(key) : undefined;
      },
      async setItem(key, value) {
        map.set(key, value);
      },
      async removeItem(key) {
        map.delete(key);
      },
      async allItems() {
        return Object.fromEntries(map);
      },
      async clear() {
        map.clear();
      },
      async containsKey(key) {
        return map.has(key);
      },
    },
  };
}

const K = {
  history: "deepseek-quick.conversations",
  corrupted: "deepseek-quick.conversations.corrupted",
  presets: "deepseek-quick.chat-presets",
  active: "deepseek-quick.chat-active-preset",
  presetOverrides: "deepseek-quick.chat-preset-overrides",
  promptOverrides: "deepseek-quick.prompt-overrides",
};

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

/* ── 编译被测模块（每次换一个 store 就重新构建，把 mock 注进去） ── */
const tmp = await mkdtemp(join(tmpdir(), "dsk-mig-"));
async function loadModule(store) {
  const outfile = join(tmp, `migration-${store.name}.cjs`);
  await build({
    entryPoints: ["src/lib/migration.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile,
    logLevel: "silent",
    plugins: [
      {
        name: "raycast-mock",
        setup(b) {
          b.onResolve({ filter: /^@raycast\/api$/ }, () => ({ path: "raycast-mock", namespace: "mock" }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: `
              export const LocalStorage = globalThis.__STORE__;
              export function getPreferenceValues() {
                return { apiEndpoint: "https://api.deepseek.com/v1", model: "deepseek-flash",
                         quickActionEffort: "none", reasoningEffort: "low",
                         translateBidirectional: true, translateTo: "中文",
                         showReasoning: false, outputBehavior: "replace" };
              }
            `,
            loader: "js",
          }));
        },
      },
    ],
  });
  globalThis.__STORE__ = store.LocalStorage;
  return import(pathToFileURL(outfile).href);
}

/* ─────────────────────── 场景 ─────────────────────── */

console.log("场景 1：A 机器导出 → B 机器导入");
const A = makeStore("A");
const a = await loadModule(A);

// A 机器上的数据
A.map.set(
  K.history,
  JSON.stringify([
    { id: "c1", title: "对话一", createdAt: 1, updatedAt: 10, messages: [{ role: "user", content: "hi" }] },
    { id: "c2", title: "对话二", createdAt: 2, updatedAt: 20, messages: [{ role: "user", content: "yo" }] },
  ]),
);
A.map.set(
  K.presets,
  JSON.stringify([
    {
      id: "p_a",
      name: "我的预设",
      systemPrompt: "你是我的助手",
      effort: "high",
      createdAt: 1,
      updatedAt: 5,
    },
  ]),
);
A.map.set(K.active, "p_a");
A.map.set(K.presetOverrides, JSON.stringify({ __senior__: { effort: "max" } }));
A.map.set(K.promptOverrides, JSON.stringify({ explain: "只讲重点", translate: "信达雅" }));

const exported = await a.buildMigrationBundle({ history: true });
check("导出清单项数", exported.items.length, 5);
check("导出 payload 段", Object.keys(exported.bundle.payload).sort(), [
  "activePreset",
  "history",
  "presetOverrides",
  "presets",
  "promptOverrides",
]);

// B 机器：已有一条历史 + 一个同名不同 id 的预设 + 一条会被覆盖的 prompt 覆盖
const B = makeStore("B");
const b = await loadModule(B);
B.map.set(
  K.history,
  JSON.stringify([
    { id: "c2", title: "对话二（B 上更旧）", createdAt: 2, updatedAt: 15, messages: [] },
    { id: "c9", title: "B 自己的对话", createdAt: 9, updatedAt: 90, messages: [] },
  ]),
);
B.map.set(
  K.presets,
  JSON.stringify([{ id: "p_b", name: "我的预设", systemPrompt: "B 的版本", effort: "low", updatedAt: 1 }]),
);
B.map.set(K.promptOverrides, JSON.stringify({ explain: "B 的旧覆盖", chat: "B 的 chat 覆盖" }));

const parsedForB = b.parseMigrationBundle(exported.json);
check("解析出的段", parsedForB.features.sort(), [
  "activePreset",
  "history",
  "presetOverrides",
  "presets",
  "promptOverrides",
]);
check("非旧格式", parsedForB.legacyHistoryOnly, false);
check("无未知段", parsedForB.unknownSections, []);

const plan = await b.planImport(parsedForB);
check("历史：新增 c1", plan.history.added, 1);
check("历史：更新 c2", plan.history.updated, 1);
check("预设：新增 1（id 不同，B 的同名不会被顶）", plan.presets.added, 1);
check("预设 id 冲突为空", plan.presetIdConflicts, []);
check("prompt 覆盖会覆盖 explain", plan.promptOverridesOverwriting, ["explain"]);
check("翻译覆盖是新增，不算覆盖", plan.promptOverrides.includes("translate"), true);
check("活动预设会被改", plan.activePreset, { from: undefined, to: "p_a" });

const applied = await b.applyMigrationBundle(parsedForB);
check("应用：历史 added", applied.history.added, 1);
check("应用：历史 updated", applied.history.updated, 1);
check("应用：presets added", applied.presets.added, 1);
check("应用：overwritten 计数", applied.overwritten, 1);

// B 导入后的真实状态
const bHistory = JSON.parse(B.map.get(K.history));
check("导入后历史条数", bHistory.length, 3);
check("c2 取 updatedAt 更新的那条（A 的 20）", bHistory.find((c) => c.id === "c2").updatedAt, 20);
ok("B 自己的对话 c9 还在", bHistory.some((c) => c.id === "c9"));

const bPresets = JSON.parse(B.map.get(K.presets));
check("导入后预设条数（B 的同名预设保留）", bPresets.length, 2);
ok("A 的预设进来了", bPresets.some((p) => p.id === "p_a"));
ok("B 的预设没被顶掉", bPresets.some((p) => p.id === "p_b"));

const bPrompts = JSON.parse(B.map.get(K.promptOverrides));
check("prompt: explain 被替换", bPrompts.explain, "只讲重点");
check("prompt: chat 保持 B 的", bPrompts.chat, "B 的 chat 覆盖");
check("prompt: translate 新增", bPrompts.translate, "信达雅");

check("活动预设已切换", B.map.get(K.active), "p_a");
check("内置预设覆盖已合并", JSON.parse(B.map.get(K.presetOverrides)), { __senior__: { effort: "max" } });

console.log("\n场景 2：撤销上一次导入");
const undone = await b.undoLastMigration();
ok("撤销返回恢复项数 > 0", undone.restored > 0);
const afterUndo = JSON.parse(B.map.get(K.history));
check("撤销后历史条数回到 2", afterUndo.length, 2);
check("撤销后 c2 回到 B 的版本", afterUndo.find((c) => c.id === "c2").updatedAt, 15);
check("撤销后预设只剩 B 的", JSON.parse(B.map.get(K.presets)).map((p) => p.id), ["p_b"]);
check("撤销后 prompt 回到 B 的", JSON.parse(B.map.get(K.promptOverrides)), {
  explain: "B 的旧覆盖",
  chat: "B 的 chat 覆盖",
});
check("撤销后活动预设被删除（导入前不存在）", B.map.has(K.active), false);
check("撤销后内置覆盖被删除（导入前不存在）", B.map.has(K.presetOverrides), false);

let secondUndoFailed = false;
try {
  await b.undoLastMigration();
} catch {
  secondUndoFailed = true;
}
check("撤销点用掉后不能撤销两次", secondUndoFailed, true);

console.log("\n场景 3：旧格式 / 裸数组 / 坏文件");
const legacy = JSON.stringify({
  format: "deepseek-quick.history",
  version: 1,
  exportedAt: 1,
  conversations: [{ id: "c1", title: "x", createdAt: 1, updatedAt: 1, messages: [] }],
});
const pLegacy = b.parseMigrationBundle(legacy);
check("旧格式被识别", pLegacy.legacyHistoryOnly, true);
check("旧格式只有历史", pLegacy.features, ["history"]);

const pBare = b.parseMigrationBundle(JSON.stringify([{ id: "z", title: "z", createdAt: 1, updatedAt: 1, messages: [] }]));
check("裸数组被识别为旧格式", pBare.legacyHistoryOnly, true);

let badThrew = "";
try {
  b.parseMigrationBundle("{ not json");
} catch (e) {
  badThrew = e.message;
}
ok("坏 JSON 抛错", badThrew.includes("合法"));

let emptyThrew = "";
try {
  b.parseMigrationBundle(JSON.stringify({ format: "unknown", foo: 1 }));
} catch (e) {
  emptyThrew = e.message;
}
ok("认不出的格式抛错", emptyThrew.includes("认不出"));

console.log("\n场景 4：向前兼容（包里多出不认识的段）");
const newer = JSON.stringify({
  format: "deepseek-quick.migration",
  version: 99,
  exportedAt: 1,
  extension: "deepseek-quick",
  features: ["presets", "prompts"],
  payload: { presets: [{ id: "p_n", name: "新", systemPrompt: "s" }], futureThing: { a: 1 } },
  futureTopLevel: true,
});
const pNewer = b.parseMigrationBundle(newer);
check("不认识的 payload 段被记录", pNewer.unknownSections, ["futureThing", "futureTopLevel"]);
check("认识的段照常解析", pNewer.features, ["presets"]);
check("版本号读到 99", pNewer.bundle.version, 99);

console.log("\n场景 5：presetIdConflicts 检测");
const C = makeStore("C");
const c = await loadModule(C);
C.map.set(
  K.presets,
  JSON.stringify([{ id: "dup", name: "本机旧", systemPrompt: "old", updatedAt: 1 }]),
);
const dupBundle = JSON.stringify({
  format: "deepseek-quick.migration",
  version: 1,
  exportedAt: 1,
  extension: "deepseek-quick",
  features: ["presets"],
  payload: {
    presets: [
      { id: "dup", name: "包里的A", systemPrompt: "a", updatedAt: 5 },
      { id: "dup", name: "包里的B", systemPrompt: "b", updatedAt: 9 },
    ],
  },
});
const pDup = c.parseMigrationBundle(dupBundle);
const planDup = await c.planImport(pDup);
check("检测到重复 id 冲突", planDup.presetIdConflicts, ["dup"]);
await c.applyMigrationBundle(pDup);
const cPresets = JSON.parse(C.map.get(K.presets));
check("同 id 冲突时时间戳新的胜出", cPresets.length, 1);
check("胜出的是 updatedAt=9 的那条", cPresets[0].name, "包里的B");

console.log("\n场景 6：损坏数据不覆盖本机已有备份");
const D = makeStore("D");
const d = await loadModule(D);
D.map.set(K.corrupted, "本机的抢救数据");
const dBundle = JSON.stringify({
  format: "deepseek-quick.migration",
  version: 1,
  exportedAt: 1,
  extension: "deepseek-quick",
  features: ["corruptedBackup"],
  payload: { corruptedBackup: "包里的抢救数据" },
});
await d.applyMigrationBundle(d.parseMigrationBundle(dBundle));
check("本机已有的损坏备份不被覆盖", D.map.get(K.corrupted), "本机的抢救数据");

console.log("\n场景 7：空机器导出的包被判为空（防止写出导不回来的文件）");
const E = makeStore("E");
const e = await loadModule(E);
const emptyExport = await e.buildMigrationBundle({ history: true });
check("空机器导出：没有段", emptyExport.bundle.features, []);
check("空机器导出：清单为空", emptyExport.items, []);
check("空包被识别", e.isEmptyBundle(emptyExport), true);

// 只有空历史、没有其它配置时同样是空包
E.map.set(K.history, JSON.stringify([]));
const emptyHistoryExport = await e.buildMigrationBundle({ history: true });
check("空历史不算内容", e.isEmptyBundle(emptyHistoryExport), true);

// 有内容就不是空包
E.map.set(K.history, JSON.stringify([{ id: "c1", title: "t", createdAt: 1, updatedAt: 1, messages: [] }]));
const oneExport = await e.buildMigrationBundle({ history: true });
check("有对话就不是空包", e.isEmptyBundle(oneExport), false);
check("清单只列有内容的段", oneExport.items.map((i) => i.feature), ["history"]);

let emptyBundleThrew = "";
try {
  e.parseMigrationBundle(JSON.stringify({ format: "deepseek-quick.migration", version: 1, payload: {} }));
} catch (err) {
  emptyBundleThrew = err.message;
}
ok("空迁移包导入时抛错", emptyBundleThrew.includes("没有可导入"));

await rm(tmp, { recursive: true, force: true });

console.log(failures === 0 ? "\n✅ 全部通过" : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
