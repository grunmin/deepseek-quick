import { getSelectedFinderItems, getSelectedText } from "@raycast/api";
import { dbg } from "./debug";
import { isImagePath, toDataUri } from "./images";

export interface Selection {
  /** 当前选中的文本（可能为空） */
  text: string;
  /** Finder 里选中的图片，已转成 data URI */
  images: string[];
}

/**
 * 读「当前选区」：优先拿选中的文字，没有再看 Finder 里是不是选了图片。
 *
 * ⚠️ 调用方负责先把 Raycast 窗口关掉：`getSelectedText()` 读的是**最前台 App**
 * 的选中文本，Raycast 自己在前台时只会拿到空字符串（见 README「踩过的坑」）。
 */
export async function seekSelection(): Promise<Selection> {
  let text = "";
  try {
    text = (await getSelectedText()).trim();
  } catch (err) {
    dbg(`seekSelection: getSelectedText 失败 ${String(err).slice(0, 200)}`);
  }

  if (text) {
    if (looksLikeFilePaths(text)) {
      // Finder 里选中图片时，系统「拷贝」出来的是文件路径列表，
      // 当正文发出去没意义 —— 忽略它，转去读图片本身。
      dbg("seekSelection: 文本是文件路径，忽略，转读图片");
    } else {
      dbg(`seekSelection: 拿到文本 ${text.length} 字符`);
      return { text, images: [] };
    }
  }

  const images = await finderImages();
  dbg(`seekSelection: 文本不可用，图片 ${images.length} 张`);
  return { text: "", images };
}

/** 判断选中的是不是「一堆图片文件路径」（Finder 选中文件时会这样） */
function looksLikeFilePaths(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((line) => isImagePath(line));
}

async function finderImages(): Promise<string[]> {
  try {
    const items = await getSelectedFinderItems();
    const paths = items.map((item) => item.path).filter(isImagePath);
    return await Promise.all(paths.map(toDataUri));
  } catch (err) {
    dbg(`seekSelection: getSelectedFinderItems 失败 ${String(err).slice(0, 200)}`);
    return [];
  }
}
