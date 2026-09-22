/**
 * pack.mjs — 将 dist/ 构建产物打包为 release/yoz-<版本>-<时间戳>.tar.gz
 *
 * 跨平台、零依赖：用 Node 内置 zlib 与最小 POSIX tar 写入器实现，
 * 不依赖系统 tar/zip 命令（Windows 用户也可直接使用）。
 *
 * 用法：npm run pack   （= npm run build && node scripts/pack.mjs）
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '..');
const distDir = path.join(repoRoot, 'dist');
const releaseDir = path.join(repoRoot, 'release');

const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));

try {
  const stat = await fs.stat(distDir);
  if (!stat.isDirectory()) throw new Error('not a directory');
} catch {
  console.error('dist/ 不存在，请先运行 npm run build（或直接使用 npm run pack）');
  process.exit(1);
}

/** 递归收集 dist 下所有文件（返回相对 POSIX 路径与绝对路径） */
async function collect(dir, base = dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(abs, base, out);
    else if (entry.isFile()) {
      const rel = path.relative(base, abs).split(path.sep).join('/');
      out.push({ rel, abs });
    }
  }
  return out;
}

/** 最小 POSIX ustar 头部（仅普通文件，路径 ≤ 100 字节，产物路径均很短） */
function tarHeader(name, size, mtime) {
  const buf = Buffer.alloc(512, 0);
  const write = (off, len, str) => buf.write(str.padEnd(len, '\0'), off, len, 'latin1');
  const octal = (off, len, val) => buf.write(val.toString(8).padStart(len - 1, '0') + '\0', off, len, 'latin1');
  write(0, 100, name);
  octal(100, 8, 0o100644);      // mode
  octal(108, 8, 0);             // uid
  octal(116, 8, 0);             // gid
  octal(124, 12, size);         // size
  octal(136, 12, Math.floor(mtime / 1000)); // mtime
  buf.fill(0x20, 148, 156);     // chksum 先填空格
  buf.write('0', 156, 'latin1');            // typeflag: 普通文件
  buf.write('ustar\0', 257, 'latin1');
  buf.write('00', 263, 'latin1');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return buf;
}

const files = await collect(distDir);
if (files.length === 0) {
  console.error('dist/ 为空，打包中止。');
  process.exit(1);
}

const parts = [];
let totalBytes = 0;
for (const f of files) {
  const data = await fs.readFile(f.abs);
  if (Buffer.byteLength(f.rel, 'latin1') > 100) {
    console.error(`路径过长（>100），暂不支持：${f.rel}`);
    process.exit(1);
  }
  parts.push(tarHeader(f.rel, data.length, Date.now()));
  parts.push(data);
  const pad = (512 - (data.length % 512)) % 512;
  if (pad) parts.push(Buffer.alloc(pad));
  totalBytes += data.length;
}
parts.push(Buffer.alloc(1024)); // tar 结束块

const tar = Buffer.concat(parts);
const gz = gzipSync(tar, { level: 9 });

const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12); // YYYYMMDDHHmm
const name = `yoz-v${pkg.version}-${ts}.tar.gz`;
await fs.mkdir(releaseDir, { recursive: true });
const outPath = path.join(releaseDir, name);
await fs.writeFile(outPath, gz);

console.log(`✓ 打包完成：release/${name}`);
console.log(`  ${files.length} 个文件，原始 ${(totalBytes / 1024).toFixed(1)} KB → gzip ${(gz.length / 1024).toFixed(1)} KB`);
console.log('  部署：解压后把整个目录交给任意静态服务器（nginx / GitHub Pages / object storage）即可。');
