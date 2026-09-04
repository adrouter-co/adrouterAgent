import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { crc32 } from 'node:zlib';

// Resolve through Packager, exercising its CommonJS-to-ESM dependency boundary.
const packagerRequire = createRequire(import.meta.resolve('@electron/packager'));
const module = packagerRequire('extract-zip');
const extract = module.__esModule ? module.default : module;
function archive(name, contents, mode) {
  const filename = Buffer.from(name);
  const data = Buffer.from(contents);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE((mode << 16) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
test('Packager extracts ordinary files and rejects escaping symlink targets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'adrouter-extract-regression-'));
  try {
    const output = join(root, 'output');
    mkdirSync(output);
    const normal = join(root, 'normal.zip');
    writeFileSync(normal, archive('nested/file.txt', 'safe extraction', 0o100644));
    await extract(normal, { dir: output });
    assert.equal(readFileSync(join(output, 'nested/file.txt'), 'utf8'), 'safe extraction');
    const malicious = join(root, 'escape.zip');
    writeFileSync(malicious, archive('escape', '../../outside', 0o120777));
    await assert.rejects(extract(malicious, { dir: output }));
    assert.equal(existsSync(join(output, 'escape')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
