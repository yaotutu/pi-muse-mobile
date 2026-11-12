import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { COMPANION_STATES, MAX_COMPANION_ASSET_BYTES } from '../src/api/companion-contracts.ts';

const root = new URL('../assets/images/avatar/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const approvedB = '53182c9e203f7dfb5d6af30202862e851fabc2a565a276b62f79a79e96850245';

// 读取仓库内实际PNG的alpha，不依赖图片渲染桩，也不把RGBA文件头等同于真正透明。
function pngAlpha(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let width, height; const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset); const kind = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    assert.equal(data.length, length);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([data[8], data[9], data[10], data[11], data[12]], [8, 6, 0, 0, 0], '8-bit non-interlaced RGBA PNG');
    }
    if (kind === 'IDAT') compressed.push(data);
    offset += length + 12;
    if (kind === 'IEND') break;
  }
  assert.equal(width, 512); assert.equal(height, 512);
  const stride = width * 4; const raw = inflateSync(Buffer.concat(compressed));
  assert.equal(raw.length, (stride + 1) * height);
  const decoded = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter >= 0 && filter <= 4);
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x; const left = x >= 4 ? decoded[index - 4] : 0;
      const up = y ? decoded[index - stride] : 0; const corner = y && x >= 4 ? decoded[index - stride - 4] : 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, corner)][filter];
      decoded[index] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, at: (x, y) => decoded[(y * width + x) * 4 + 3] };
}

test('内置默认八态来自唯一B母版，保持原builtin key，不与旧C或自定义包混装', () => {
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.identity, 'brand-penguin-b');
  assert.equal(manifest.builtinKey, 'builtin:penguin'); assert.equal(manifest.artworkApproval, 'user-approved-static-poses');
  assert.equal(manifest.canonicalReference.sha256, approvedB);
  assert.deepEqual(manifest.states.map((entry) => entry.state), COMPANION_STATES);
  assert.equal(new Set(manifest.states.map((entry) => entry.sha256)).size, 8);
  const builtin = readFileSync(new URL('../src/companion/builtin-packs.ts', import.meta.url), 'utf8');
  assert.match(builtin, /key: 'builtin:penguin'/);
  // 八张 require 路径的打包接线由 workspace-ui.test 的既有断言负责，此处不重复维护一份。
});

test('真实B资源逐张校验哈希、512RGBA、透明角与抗锯齿边缘，纸张和人物内部不被抠空', () => {
  for (const entry of manifest.states) {
    assert.equal(entry.file, `${entry.state}.png`);
    const bytes = readFileSync(new URL(entry.file, root));
    assert.equal(bytes.length, entry.bytes, entry.state); assert.ok(bytes.length <= MAX_COMPANION_ASSET_BYTES, entry.state);
    assert.equal(sha256(bytes), entry.sha256, entry.state);
    const image = pngAlpha(bytes); let zero = 0, opaque = 0, edge = 0; let left = 512, top = 512, right = 0, bottom = 0;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const alpha = image.at(x, y);
      if (alpha === 0) zero++; else { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
      if (alpha === 255) opaque++; else if (alpha > 0) edge++;
    }
    assert.ok(zero > 10000 && opaque > 20000 && edge > 0, `${entry.state}: actual transparent/opaque/soft edge pixels`);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) assert.equal(image.at(x, y), 0, entry.state);
    assert.equal(image.at(256, 256), 255, `${entry.state}: solid character/paper center`);
    assert.deepEqual([left, top, right, bottom], entry.alphaBounds, entry.state);
    assert.ok(Math.min(left, top, 512 - right, 512 - bottom) >= 16, `${entry.state}: no clipping`);
  }
});
