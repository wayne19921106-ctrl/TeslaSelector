// 把 frontend/ 合併成單一 HTML（內嵌 JS、強制使用示範資料），方便分享預覽。
// 用法：node tools/build-preview.mjs [輸出路徑]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const front = join(root, 'frontend');
const out = process.argv[2] || join(root, 'dist', 'preview.html');

let html = readFileSync(join(front, 'index.html'), 'utf8');

// 本地 script 改為內嵌；config 改成不連 API
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, src) => {
  if (src === 'js/config.js') {
    return "<script>window.APP_CONFIG = { apiBase: '', market: 'TW' };</script>";
  }
  const code = readFileSync(join(front, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script>\n${code}\n</script>`;
});

// 預覽環境會自行包上 doctype / html / head / body
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset="utf-8">\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

import('node:fs').then(({ mkdirSync }) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`已輸出 ${out}（${(html.length / 1024).toFixed(0)} KB）`);
});
