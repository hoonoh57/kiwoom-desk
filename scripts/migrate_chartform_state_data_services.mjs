import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src', 'forms', 'ChartForm.ts');

function canonicalize(source) {
  return String(source ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function replaceRequired(source, marker, replacement, label) {
  if (!source.includes(marker)) throw new Error(`Chart state/data migration marker not found: ${label}`);
  return source.replace(marker, replacement);
}

let source = canonicalize(await fs.readFile(file, 'utf8'));
if (source.includes('CHART_RUNTIME_STATE_DATA_SERVICES_V1')) {
  console.log('ChartForm already exposes generic state/data services.');
  process.exit(0);
}

source = replaceRequired(
  source,
  `  createChartRuntimeHost,\n  type ChartRuntimeBarChange,\n  type ChartRuntimeHost,`,
  `  createChartRuntimeHost,\n  type ChartRuntimeBarChange,\n  type ChartRuntimeCoreState,\n  type ChartRuntimeDataService,\n  type ChartRuntimeHost,\n  type ChartRuntimeStateService,`,
  'generic service type imports',
);

source = replaceRequired(
  source,
  `  // CHART_RUNTIME_HOST_NATIVE_V1 — the one normal-chart integration seam.\n  private runtimeHost?: ChartRuntimeHost;\n  private ro?: ResizeObserver;`,
  `  // CHART_RUNTIME_HOST_NATIVE_V1 — the one normal-chart integration seam.\n  private runtimeHost?: ChartRuntimeHost;\n  // CHART_RUNTIME_STATE_DATA_SERVICES_V1 — generic base capabilities only.\n  private runtimeBootstrapOpen = true;\n  private runtimeDataRestored = false;\n  private readonly runtimeStateSubscribers = new Set<(state: ChartRuntimeCoreState) => void>();\n  private ro?: ResizeObserver;`,
  'generic service fields',
);

source = replaceRequired(
  source,
  `        [ChartRuntimeServiceIds.APP_API]: this.ctx.api,\n        [ChartRuntimeServiceIds.APP_DOCK]: this.ctx.dock,\n        [ChartRuntimeServiceIds.CHART_PARAMS]: this.params,`,
  `        [ChartRuntimeServiceIds.APP_API]: this.ctx.api,\n        [ChartRuntimeServiceIds.APP_DOCK]: this.ctx.dock,\n        [ChartRuntimeServiceIds.CHART_PARAMS]: this.params,\n        [ChartRuntimeServiceIds.CHART_STATE]: this.runtimeStateService(),\n        [ChartRuntimeServiceIds.CHART_DATA]: this.runtimeDataService(),`,
  'provide generic state/data services',
);

source = replaceRequired(
  source,
  `    });\n\n    this.renderShell();\n    void this.boot();`,
  `    });\n    // Plugins may apply bootstrap state/data only while the Host is being created.\n    this.runtimeBootstrapOpen = false;\n\n    this.renderShell();\n    void this.boot();`,
  'close generic bootstrap boundary',
);

const helperMarker = `  private renderShell(): void {`;
const helpers = `  private runtimeCoreState(): ChartRuntimeCoreState {\n    return {\n      code: this.code,\n      period: this.period.id,\n      scope: this.scope,\n      adjusted: this.upd === '1',\n      volumeRaw: this.volRaw,\n    };\n  }\n\n  private runtimeDataIdentity(): string {\n    const state = this.runtimeCoreState();\n    return [state.code, state.period, state.scope, state.adjusted ? '1' : '0'].join('|');\n  }\n\n  private applyRuntimeCoreState(state: Partial<ChartRuntimeCoreState>): void {\n    if (!this.runtimeBootstrapOpen) {\n      throw new Error('Chart runtime core state may only be applied during bootstrap.');\n    }\n\n    if (typeof state.code === 'string') {\n      const code = this.plainCode(state.code);\n      if (code) this.code = code;\n    }\n\n    let periodChanged = false;\n    if (typeof state.period === 'string') {\n      const hit = PERIODS.find(item => item.id === state.period);\n      if (hit && hit !== this.period) {\n        this.period = hit;\n        periodChanged = true;\n      }\n    }\n\n    const defaultScope = this.period.id === 'min' ? '5' : (this.period.scopes?.[0]?.v ?? '1');\n    if (typeof state.scope === 'string') {\n      const requested = state.scope.trim();\n      this.scope = this.period.scopes?.some(item => item.v === requested) ? requested : defaultScope;\n    } else if (periodChanged) {\n      this.scope = defaultScope;\n    }\n\n    if (typeof state.adjusted === 'boolean') this.upd = state.adjusted ? '1' : '0';\n    if (typeof state.volumeRaw === 'boolean') this.volRaw = state.volumeRaw;\n    this.notifyRuntimeCoreState();\n  }\n\n  private notifyRuntimeCoreState(): void {\n    const state = this.runtimeCoreState();\n    for (const handler of [...this.runtimeStateSubscribers]) {\n      try { handler(structuredClone(state)); } catch { /* adapter failure cannot break Chart Core */ }\n    }\n  }\n\n  private runtimeStateService(): ChartRuntimeStateService {\n    return {\n      read: () => structuredClone(this.runtimeCoreState()),\n      apply: state => this.applyRuntimeCoreState(state),\n      subscribe: handler => {\n        this.runtimeStateSubscribers.add(handler);\n        return () => this.runtimeStateSubscribers.delete(handler);\n      },\n    };\n  }\n\n  private captureRuntimeDataSnapshot(): unknown {\n    if (!this.bars.length) return undefined;\n    return {\n      schemaVersion: 1,\n      identity: this.runtimeDataIdentity(),\n      name: this.name,\n      bars: structuredClone(this.bars),\n      sourceTickBars: structuredClone(this.sourceTickBars),\n      syntheticLiveBars: structuredClone(this.syntheticLiveBars),\n      contYn: this.contYn,\n      nextKey: this.nextKey,\n      liveTickCount: this.liveTickCount,\n      liveTickSynced: this.liveTickSynced,\n    };\n  }\n\n  private restoreRuntimeDataSnapshot(value: unknown): boolean {\n    if (!this.runtimeBootstrapOpen || !value || typeof value !== 'object') return false;\n    const raw = value as Record<string, any>;\n    if (raw.schemaVersion !== 1 || raw.identity !== this.runtimeDataIdentity()) return false;\n    if (!Array.isArray(raw.bars) || raw.bars.length === 0) return false;\n\n    this.name = typeof raw.name === 'string' ? raw.name : '';\n    this.bars = structuredClone(raw.bars as Bar[]);\n    this.sourceTickBars = Array.isArray(raw.sourceTickBars)\n      ? structuredClone(raw.sourceTickBars as Bar[])\n      : [];\n    this.syntheticLiveBars = Array.isArray(raw.syntheticLiveBars)\n      ? structuredClone(raw.syntheticLiveBars as Bar[])\n      : [];\n    this.contYn = raw.contYn === 'Y' ? 'Y' : '';\n    this.nextKey = typeof raw.nextKey === 'string' ? raw.nextKey : '';\n    this.liveTickCount = Number.isFinite(Number(raw.liveTickCount)) ? Number(raw.liveTickCount) : 0;\n    this.liveTickSynced = raw.liveTickSynced === true;\n    this.runtimeDataRestored = true;\n    return true;\n  }\n\n  private runtimeDataService(): ChartRuntimeDataService {\n    return {\n      capture: () => this.captureRuntimeDataSnapshot(),\n      restore: snapshot => this.restoreRuntimeDataSnapshot(snapshot),\n      wasRestored: () => this.runtimeDataRestored,\n    };\n  }\n\n  private presentRestoredRuntimeData(): boolean {\n    if (!this.runtimeDataRestored || !this.bars.length || !this.candles) return false;\n    this.refreshSeries(true);\n    const nameEl = this.$('#cName');\n    if (nameEl) nameEl.textContent = this.name;\n    const syntheticTicks = this.period.id === 'tick' && isSyntheticTickScope(this.scope);\n    this.setTitle(\`차트 \${this.code}\${this.name ? ' ' + this.name : ''} · \${this.periodCaption(this.period, this.scope)}\`);\n    this.status(\`\${this.loadedStatus(this.period, this.scope, syntheticTicks)} · 세션 복원 · REST 재조회 없음\`);\n    this.paintLegend(null);\n    this.syncRealtimeRegistration();\n    this.ctx.bus.emit(Topics.SymbolSelected, { source: this.formKey, code: this.code, name: this.name });\n    return true;\n  }\n\n`;
source = replaceRequired(source, helperMarker, `${helpers}${helperMarker}`, 'generic service methods');

source = replaceRequired(
  source,
  `      this.name = msg.name ?? '';\n      const inp = this.$<HTMLInputElement>('#cCode');`,
  `      this.name = msg.name ?? '';\n      this.notifyRuntimeCoreState();\n      const inp = this.$<HTMLInputElement>('#cCode');`,
  'linked symbol state notification',
);
source = replaceRequired(
  source,
  `      this.code = next;\n      void this.load(false);`,
  `      this.code = next;\n      this.notifyRuntimeCoreState();\n      void this.load(false);`,
  'code control state notification',
);
source = replaceRequired(
  source,
  `      this.scope = def.id === 'min' ? '5' : (def.scopes?.[0]?.v ?? '1');\n      this.bars = [];`,
  `      this.scope = def.id === 'min' ? '5' : (def.scopes?.[0]?.v ?? '1');\n      this.notifyRuntimeCoreState();\n      this.bars = [];`,
  'period control state notification',
);
source = replaceRequired(
  source,
  `      this.scope = (e.target as HTMLSelectElement).value;\n      void this.load(false);`,
  `      this.scope = (e.target as HTMLSelectElement).value;\n      this.notifyRuntimeCoreState();\n      void this.load(false);`,
  'scope control state notification',
);
source = replaceRequired(
  source,
  `      this.upd = (e.target as HTMLInputElement).checked ? '1' : '0';\n      void this.load(false);`,
  `      this.upd = (e.target as HTMLInputElement).checked ? '1' : '0';\n      this.notifyRuntimeCoreState();\n      void this.load(false);`,
  'adjusted control state notification',
);
source = replaceRequired(
  source,
  `      this.volRaw = (e.target as HTMLInputElement).checked;\n      this.computeVolCap();`,
  `      this.volRaw = (e.target as HTMLInputElement).checked;\n      this.notifyRuntimeCoreState();\n      this.computeVolCap();`,
  'volume mode state notification',
);

source = replaceRequired(
  source,
  `  private async boot(): Promise<void> {\n    if (!this.chart) await this.initChart();\n    await this.load(false);\n  }`,
  `  private async boot(): Promise<void> {\n    if (!this.chart) await this.initChart();\n    if (this.presentRestoredRuntimeData()) return;\n    await this.load(false);\n  }`,
  'opaque restored-data boot path',
);

source = replaceRequired(
  source,
  `    if (!more) {\n      this.clearRealtimeRegistration();`,
  `    if (!more) {\n      this.runtimeDataRestored = false;\n      this.clearRealtimeRegistration();`,
  'explicit acquisition leaves restored-data state',
);

source = replaceRequired(
  source,
  `  protected onRelease(): void {\n    this.runtimeHost?.dispose();\n    this.runtimeHost = undefined;\n  }`,
  `  protected onRelease(): void {\n    this.runtimeHost?.dispose();\n    this.runtimeHost = undefined;\n    this.runtimeStateSubscribers.clear();\n  }`,
  'generic service cleanup',
);

await fs.writeFile(file, source, 'utf8');
console.log('ChartForm migrated to generic CHART_STATE / CHART_DATA base services.');
