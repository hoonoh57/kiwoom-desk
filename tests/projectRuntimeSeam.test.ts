import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Disposable PR probe: forces native project-runtime verification to remain directly observable.
test('generic project runtime seam is native and ordered before Workbench chart creation', async () => {
  const source = await fs.readFile(new URL('../src/main.ts', import.meta.url), 'utf8');

  assert.equal(source.includes('PROJECT_RUNTIME_NATIVE_V1'), true);
  assert.equal(source.includes("import.meta.glob('./project/register.ts')"), true);
  assert.equal(source.includes('const projectRuntime = await installOptionalProjectRuntime(ctx);'), true);
  assert.equal(source.includes('projectRuntime?.afterWorkbench?.();'), true);
  assert.equal(source.includes('projectRuntime?.dispose?.();'), true);

  const install = source.indexOf('const projectRuntime = await installOptionalProjectRuntime(ctx);');
  const workbench = source.indexOf('const wb = new Workbench(ctx);');
  const render = source.indexOf('wb.render(host);');
  const after = source.indexOf('projectRuntime?.afterWorkbench?.();');
  const dispose = source.indexOf('projectRuntime?.dispose?.();');

  assert.ok(install >= 0 && install < workbench, 'project runtime must install before Workbench construction');
  assert.ok(workbench < render && render < after, 'afterWorkbench must run only after Workbench render');
  assert.ok(after < dispose, 'project runtime must remain alive until unload disposal');
});

test('project runtime seam is generic application composition, not optional feature ownership', async () => {
  const source = await fs.readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const marker = source.indexOf('PROJECT_RUNTIME_NATIVE_V1');
  const start = source.lastIndexOf('/**', marker);
  const end = source.indexOf('async function bootstrap()', marker);
  assert.ok(marker >= 0 && start >= 0 && end > marker, 'native project-runtime seam boundaries must exist independent of EOL style');
  const seam = source.slice(start, end);

  for (const forbidden of [
    'Workspace',
    'VirtualDesktop',
    'Theme',
    'Research',
    'PropertyGrid',
    'SOX',
    'SuperTrend',
  ]) {
    assert.equal(seam.includes(forbidden), false, `project runtime seam owns optional feature: ${forbidden}`);
  }
});
