import { appendFileSync } from "node:fs";

/**
 * 临时调试日志。排查完可以直接删掉这个文件以及各处的 dbg() 调用。
 */
export function dbg(message: string): void {
  try {
    appendFileSync("/tmp/dsq-debug.log", `${new Date().toISOString()} ${message}\n`);
  } catch {
    // ignore
  }
}
