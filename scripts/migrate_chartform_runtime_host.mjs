import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'forms', 'ChartForm.ts');

function replaceRequired(source, marker, replacement, label) {
  if (!source.includes(marker)) {
    throw new Error(`Native ChartRuntimeHost migration marker not found: ${label}`);
  }
  return source.replace(marker, replacement);
}

let source = await fs.readFile(file, 'utf8');
if (source.includes('CHART_RUNTIME_HOST_NATIVE_V1')) {
  console.log('ChartForm already uses native ChartRuntimeHost lifecycle.');
  process.exit(0);
}

source = replaceRequired(
  source,
  `import {
  createChartExtensions,
  type ChartBarChange,
  type ChartExtensionGroup,
} from '../chart/extensions';`,
  `import {
  ChartRuntimeServiceIds,
  createChartRuntimeHost,
  type ChartRuntimeBarChange,
  type ChartRuntimeHost,
} from '../chart/runtimeHost';`,
  'runtime host import',
);

source = replaceRequired(
  source,
  `  private volume: any;
  private extensions?: ChartExtensionGroup;
  private ro?: ResizeObserver;`,
  `  private volume: any;
  // CHART_RUNTIME_HOST_NATIVE_V1 — the one normal-chart integration seam.
  private runtimeHost?: ChartRuntimeHost;
  private ro?: ResizeObserver;`,
  'runtime host field',
);

source = replaceRequired(
  source,
  `    this.scope = this.period.id === 'min' ? '5' : (this.period.scopes?.[0]?.v ?? '1');
    this.resetSyntheticState();

    this.renderShell();`,
  `    this.scope = this.period.id === 'min' ? '5' : (this.period.scopes?.[0]?.v ?? '1');
    this.resetSyntheticState();

    this.runtimeHost = createChartRuntimeHost({
      getSymbol: () => this.code,
      initialServices: {
        [ChartRuntimeServiceIds.APP_API]: this.ctx.api,
        [ChartRuntimeServiceIds.APP_DOCK]: this.ctx.dock,
        [ChartRuntimeServiceIds.CHART_PARAMS]: this.params,
      },
      reportError: message => {
        this.ctx.log.warn(message);
        this.status(message);
      },
    });

    this.renderShell();`,
  'create one runtime host before shell',
);

source = replaceRequired(
  source,
  `        <div class="chart-status" id="cStatus">준비중…</div>
      </div>` + '`' + `);

    this.$('#cGo')?.addEventListener('click', () => {`,
  `        <div class="chart-status" id="cStatus">준비중…</div>
      </div>` + '`' + `);

    const runtimeCanvas = this.$<HTMLElement>('#cCanvas');
    const runtimeToolbar = this.$<HTMLElement>('#cExt');
    if (runtimeCanvas && runtimeToolbar) {
      this.runtimeHost?.shellReady({
        root: this.root,
        canvas: runtimeCanvas,
        toolbar: runtimeToolbar,
      });
    }

    this.$('#cGo')?.addEventListener('click', () => {`,
  'shell ready lifecycle',
);

source = replaceRequired(
  source,
  `    const extensionToolbar = this.$('#cExt');
    if (extensionToolbar) {
      this.extensions = createChartExtensions({
        chart: this.chart,
        lc: LC,
        toolbar: extensionToolbar,
        firstAddonPane: 2,
        reportError: message => {
          this.ctx.log.warn(message);
          this.status(message);
        },
      });
    }`,
  `    const extensionToolbar = this.$<HTMLElement>('#cExt');
    if (extensionToolbar) {
      this.runtimeHost?.attachSurface({
        chart: this.chart,
        lc: LC,
        toolbar: extensionToolbar,
        primarySeries: this.candles,
        firstAddonPane: 2,
      });
    }`,
  'chart surface lifecycle',
);

source = replaceRequired(
  source,
  `  private disposeChart(): void {
    this.ro?.disconnect();
    this.ro = undefined;
    this.extensions?.dispose();
    this.extensions = undefined;`,
  `  private disposeChart(): void {
    this.ro?.disconnect();
    this.ro = undefined;
    this.runtimeHost?.detachSurface();`,
  'surface detach lifecycle',
);

source = replaceRequired(
  source,
  `  private refreshSeries(fit: boolean): void {
    this.computeVolCap();
    this.candles.setData(this.bars.map(b => ({`,
  `  private refreshSeries(fit: boolean): void {
    this.computeVolCap();
    this.runtimeHost?.beforeBarsReset(this.bars);
    this.candles.setData(this.bars.map(b => ({`,
  'before bars reset lifecycle',
);

source = replaceRequired(
  source,
  `    this.volume.setData(this.bars.map(b => this.volumePoint(b)));
    this.extensions?.onBarsReset(this.bars);
    if (fit) this.chart.timeScale().fitContent();`,
  `    this.volume.setData(this.bars.map(b => this.volumePoint(b)));
    this.runtimeHost?.barsReset(this.bars);
    if (fit) this.chart.timeScale().fitContent();`,
  'bars reset lifecycle',
);

source = replaceRequired(
  source,
  `    const change: ChartBarChange = this.bars.length > beforeLength ? 'append' : 'replace';`,
  `    const change: ChartRuntimeBarChange = this.bars.length > beforeLength ? 'append' : 'replace';`,
  'runtime bar change type',
);

source = replaceRequired(
  source,
  `    this.volume.update(this.volumePoint(changed));
    this.extensions?.onBarChanged(changed, change, this.bars);
    this.paintLegend(null);`,
  `    this.volume.update(this.volumePoint(changed));
    this.runtimeHost?.barChanged(changed, change, this.bars);
    this.paintLegend(null);`,
  'bar changed lifecycle',
);

source = replaceRequired(
  source,
  `  protected onVisibility(visible: boolean): void {
    if (visible && this.chart) {
      requestAnimationFrame(() => this.chart?.timeScale().fitContent());
    }
  }
}`,
  `  protected onVisibility(visible: boolean): void {
    if (visible && this.chart) {
      requestAnimationFrame(() => this.chart?.timeScale().fitContent());
    }
  }

  protected onRelease(): void {
    this.runtimeHost?.dispose();
    this.runtimeHost = undefined;
  }
}`,
  'runtime host final dispose',
);

if (/\bextensions\b/.test(source) || /createChartExtensions|ChartExtensionGroup|ChartBarChange/.test(source)) {
  throw new Error('Legacy ChartForm extension ownership remains after native Host migration.');
}

await fs.writeFile(file, source, 'utf8');
console.log('ChartForm migrated to the canonical ChartRuntimeHost lifecycle.');
