import { getSelectedFinderItems } from "@raycast/api";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export function isImagePath(path: string): boolean {
  return extname(path).toLowerCase() in MIME_BY_EXT;
}

export async function toDataUri(path: string): Promise<string> {
  const ext = extname(path).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) throw new Error(`不支持的图片格式：${ext || path}`);
  const buffer = await readFile(path);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/** 读取 Finder 里当前选中的图片，转成 data URI */
export async function selectedImageDataUris(): Promise<string[]> {
  const items = await getSelectedFinderItems();
  const paths = items.map((item) => item.path).filter(isImagePath);
  return Promise.all(paths.map(toDataUri));
}
