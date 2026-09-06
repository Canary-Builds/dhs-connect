import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'dsh-connect-package-'));
try {
  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: root, encoding: 'utf8' }))[0];
  for (const { path } of packed.files) {
    assert.match(path, /^(src\/[^/]+\.js|lib\/client\.js|package\.json|cordis\.patch\.yml|README\.md|CHANGELOG\.md|LICENSE)$/u, `Unexpected package file: ${path}`);
  }
  execFileSync('tar', ['-xzf', join(scratch, packed.filename), '-C', scratch]);
  const installed = join(scratch, 'package');
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.version, metadata.version);
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.publishConfig.access, 'public');
  const patch = JSON.parse(readFileSync(join(installed, pkg.dsh.bundle.patch), 'utf8'));
  assert.equal(patch[0].insert[0].name, pkg.name);
  const entry = await import(pathToFileURL(join(installed, pkg.main)));
  assert.equal(typeof entry.apply, 'function');
  const runtime = await import(pathToFileURL(join(installed, 'src/runtime.js')));
  assert.equal(runtime.VERSION, pkg.version);
  let registration;
  vm.runInNewContext(readFileSync(join(installed, pkg.exports['./client']), 'utf8'), { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
  assert.equal(registration.id, pkg.name);
  for (const file of Object.values(pkg.bin)) execFileSync(process.execPath, ['--check', join(installed, file)]);
  console.log(`Verified ${pkg.name}@${pkg.version}: ${packed.files.length} allowed files, host/client entries, bundle patch and CLI syntax.`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
