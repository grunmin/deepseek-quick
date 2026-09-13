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
 * 读「当前选区」：优先拿选中的文字，拿不到再看 Finder 里是不是选了图片。
 *
 * 两个来源互斥：Finder 里选中图片时，系统「拷贝」出来的通常是一堆文件路径，
 * 所以 text 要忽略掉看起来像图片路径的内容，避免把路径当正文发出去。
 */
export async function seekSelection(): Promise<Selection> {
  let text = "";
  try {
    text = (await getSelectedText()).trim();
  } catch (err) {
    dbg(`seekSelection: getSelectedText 失败 ${String(err).slice(0, 200)}`);
  }

  if (text && !looksLikeImagePaths(text)) {
    dbg(`seekSelection: 拿到文本 ${text.length} 字符`);
    return { text, images: [] };
  }

  const images = await finderImages();
  dbg(`seekSelection: 文本被忽略(${text.length} 字符) 图片 ${images.length} 张`);
  return { text: images.length > 0 ? "" : text, images };
}

/** 从文案判断选中的是不是「一堆文件路径」（Finder 选中文件时会这样） */
function looksLikeImagePaths(text: string): boolean {
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
