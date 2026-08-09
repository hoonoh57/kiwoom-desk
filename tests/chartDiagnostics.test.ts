import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ChartRuntimeProbe } from '../addons/chart-diagnostics/probe';

function makeSeries(paneIndex: number, type: string, title = '') {
  let data: any[] = [];
  return {
    setData(next: any[]) { data = next.slice(); },
    update(point: any) {
      if (data.length && data[data.length - 1]?.time === point.time) data[data.length - 1] = point;
      else data.push(point);
    },
    options() { return { title }; },
    seriesType() { return type; },
    getPane() { return { paneIndex: () => paneIndex }; },
    dump() { return data.slice(); },
  };
}

function makeChart() {
  const pane0 = [makeSeries(0, 'Candlestick')];
  const pane1 = [makeSeries(1, 'Histogram')];
  const panes = [
    { getSeries: () => pane0 },
    { getSeries: () => pane1 },
  ];

  const chart: any = {
    panes: () => panes,
    addSeries(_definition: unknown, options: any = {}, paneIndex = 0) {
      while (panes.length <= paneIndex) {
        const rows: any[] = [];
        panes.push({ getSeries: () => rows });
      }
      const row = makeSeries(paneIndex, 'Line', String(options?.title ?? ''));
      panes[paneIndex].getSeries().push(row);
      return row;
    },
  };

  return { chart, pane0, pane1 };
}

test('runtime probe counts live update without full setData', () => {
  const { chart, pane0, pane1 } = makeChart();
  const probe = new ChartRuntimeProbe(chart);
  probe.install();
  probe.start();

  pane0[0].update({ time: 1, open: 1, high: 2, low: 1, close: 2 });
  pane1[0].update({ time: 1, value: 100 });
  probe.recordBarChange('replace');

  const snapshot = probe.snapshot();
  assert.equal(snapshot.barReplace, 1);
  assert.equal(snapshot.barAppend, 0);
  assert.equal(snapshot.barsReset, 0);
  assert.equal(snapshot.update, 2);
  assert.equal(snapshot.setData, 0);
  assert.equal(snapshot.patchFailures, 0);
  assert.equal(snapshot.patchedSeries, 2);
});

test('runtime probe exposes reset and setData violations', () => {
  const { chart, pane0 } = makeChart();
  const probe = new ChartRuntimeProbe(chart);
  probe.install();
  probe.start();

  pane0[0].setData([{ time: 1, open: 1, high: 1, low: 1, close: 1 }]);
  probe.recordBarsReset();

  const snapshot = probe.snapshot();
  assert.equal(snapshot.barsReset, 1);
  assert.equal(snapshot.setData, 1);
});

test('runtime probe wraps series created after installation', () => {
  const { chart } = makeChart();
  const probe = new ChartRuntimeProbe(chart);
  probe.install();
  probe.start();

  const line = chart.addSeries({}, { title: 'RSI Signal' }, 2);
  line.update({ time: 1, value: 50 });
  probe.recordBarChange('append');

  const snapshot = probe.snapshot();
  assert.equal(snapshot.barAppend, 1);
  assert.equal(snapshot.update, 1);
  assert.equal(snapshot.setData, 0);
  assert.equal(snapshot.patchedSeries, 3);
  assert.ok(snapshot.series.some(row => row.label.includes('RSI Signal')));
});

test('runtime probe restores series and chart methods on dispose', () => {
  const { chart, pane0 } = makeChart();
  const originalAddSeries = chart.addSeries;
  const originalUpdate = pane0[0].update;
  const probe = new ChartRuntimeProbe(chart);
  probe.install();

  assert.notEqual(chart.addSeries, originalAddSeries);
  assert.notEqual(pane0[0].update, originalUpdate);

  probe.dispose();
  assert.equal(chart.addSeries, originalAddSeries);
  assert.equal(pane0[0].update, originalUpdate);
});

test('diagnostics addon remains physically optional', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const extensions = await readFile(new URL('../src/chart/extensions.ts', import.meta.url), 'utf8');

  assert.equal(main.includes("../addons/chart-diagnostics/register"), true);
  assert.equal(main.includes('import.meta.env.DEV'), true);
  assert.equal(main.includes("get('chartDiag') === '1'"), true);
  assert.equal(extensions.includes('runtimeDiagnostics'), false);
  assert.equal(extensions.includes('chart-diagnostics'), false);
});
