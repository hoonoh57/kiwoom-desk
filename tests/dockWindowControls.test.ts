import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('dock window controls are installed through Dockview header actions', () => {
  const dock = read('src/shell/DockHost.ts');

  assert.match(dock, /createRightHeaderActionComponent/);
  assert.match(dock, /class DockWindowHeaderActions/);
  assert.match(dock, /data-win="min"/);
  assert.match(dock, /data-win="max"/);
  assert.match(dock, /data-win="detach"/);
  assert.match(dock, /data-win="close"/);
});

test('floating child window uses Dockview 1.17 public floating API instead of native maximize', () => {
  const dock = read('src/shell/DockHost.ts');
  const chart = read('src/forms/ChartWorkspaceForm.ts');

  assert.match(dock, /this\.api\.addFloatingGroup\(panel\.group/);
  assert.match(dock, /this\.api\.addPopoutGroup\(panel\.group/);
  assert.match(dock, /locationOf\(panel/);
  assert.match(dock, /floatingGroupBounds:\s*'boundedWithinViewport'/);

  assert.equal(chart.includes('this.panelApi?.maximize?.()'), false);
  assert.equal(chart.includes('this.panelApi?.exitMaximized?.()'), false);
  assert.match(chart, /this\.ctx\.dock\?\.toggleMaximize\?\.\(key\)/);
});

test('chart workspace exposes minimize restore maximize and child-popout controls', () => {
  const chart = read('src/forms/ChartWorkspaceForm.ts');

  assert.match(chart, /id="cwMin"/);
  assert.match(chart, /id="cwMax"/);
  assert.match(chart, /id="cwPop"/);
  assert.match(chart, /toggleMinimize\(\)/);
  assert.match(chart, /toggleMaximize\(\)/);
  assert.match(chart, /togglePopout\(\)/);
  assert.match(chart, /windowState\?\.\(key\)/);
});

test('minimized floating child keeps a restore control in the Dockview header', () => {
  const dock = read('src/shell/DockHost.ts');
  const css = read('src/styles/dockWindowControls.css');

  assert.match(dock, /kw-window-minimized/);
  assert.match(dock, /MINIMIZED_HEIGHT/);
  assert.match(css, /\.dv-resize-container\.kw-window-minimized/);
  assert.match(css, /\.kw-window-actions/);
});
