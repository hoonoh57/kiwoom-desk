import type {
  ChartBar,
  ChartBarChange,
  ChartExtension,
  ChartExtensionContext,
} from '../../src/chart/extensions';
import {
  createDefaultIndicatorState,
  defaultParams,
  getIndicatorPlugin,
  listIndicatorPlugins,
  normalizeIndicatorState,
  normalizeParams,
} from './catalog';
import type {
  IndicatorChartState,
  IndicatorInstanceConfig,
  IndicatorOutputData,
  IndicatorOutputUpdate,
  IndicatorParameterDef,
  IndicatorPlugin,
} from './types';

const STORAGE_KEY = 'kiwoom-desk.chart.indicators.v2';
const LEGACY_STORAGE_KEY = 'kiwoom-desk.chart.indicators.v1';
const STATE_EVENT = 'kiwoom-desk:indicator-state';
let hostSeq = 0;

interface IndicatorRuntime {
  config: IndicatorInstanceConfig;
  plugin: IndicatorPlugin;
  calculator: ReturnType<IndicatorPlugin['create']>;
  series: Map<string, any>;
  pane?: any;
  failed: boolean;
}

interface StateEventDetail {
  source: string;
  state: IndicatorChartState;
}

export class IndicatorHost implements ChartExtension {
  private readonly hostId = `indicator-host-${++hostSeq}`;
  private readonly root = document.createElement('span');
  private readonly button = document.createElement('button');
  private readonly count = document.createElement('span');
  private readonly panel = document.createElement('div');
  private readonly runtimes: IndicatorRuntime[] = [];
  private currentBars: readonly ChartBar[] = [];
  private state: IndicatorChartState;
  private opened = false;
  private instanceSeq = 0;
  private disposed = false;
  private panelMessage = '';
  private paneCaptureFrame?: number;

  constructor(private readonly context: ChartExtensionContext) {
    this.state = this.loadState();

    this.root.className = 'chart-indicator-addon';
    this.button.type = 'button';
    this.button.className = 'lnk chart-indicator-button';
    this.button.textContent = '지표';
    this.count.className = 'chart-indicator-count';
    this.panel.className = 'chart-indicator-panel';

    this.root.append(this.button, this.count, this.panel);
    context.toolbar.appendChild(this.root);

    this.button.addEventListener('click', this.onToggle);
    this.panel.addEventListener('click', this.onPanelClick);
    this.panel.addEventListener('change', this.onPanelChange);
    window.addEventListener(STATE_EVENT, this.onExternalState as EventListener);
    window.addEventListener('pointerup', this.onPaneInteractionEnd);

    this.rebuild();
    this.renderPanel();
  }

  onBarsReset(bars: readonly ChartBar[]): void {
    this.currentBars = bars;
    for (const runtime of this.runtimes) {
      if (runtime.failed) continue;
      try {
        const data = runtime.calculator.reset(bars);
        this.setRuntimeData(runtime, data);
      } catch (e: any) {
        this.failRuntime(runtime, e);
      }
    }
  }

  onBarChanged(
    _bar: ChartBar,
    change: ChartBarChange,
    bars: readonly ChartBar[],
  ): void {
    this.currentBars = bars;
    for (const runtime of this.runtimes) {
      if (runtime.failed) continue;
      try {
        const update = runtime.calculator.update(bars, change);
        this.updateRuntime(runtime, update);
      } catch (e: any) {
        this.failRuntime(runtime, e);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.paneCaptureFrame !== undefined) cancelAnimationFrame(this.paneCaptureFrame);

    this.button.removeEventListener('click', this.onToggle);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.panel.removeEventListener('change', this.onPanelChange);
    window.removeEventListener(STATE_EVENT, this.onExternalState as EventListener);
    window.removeEventListener('pointerup', this.onPaneInteractionEnd);
    this.clearRuntimes();
    this.root.remove();
  }

  private readonly onToggle = (): void => {
    this.opened = !this.opened;
    this.renderPanel();
  };

  private readonly onPaneInteractionEnd = (event: PointerEvent): void => {
    if (this.disposed || this.paneCaptureFrame !== undefined) return;
    const chartElement = this.context.chart.chartElement?.();
    const target = event.target;
    if (!chartElement || !(target instanceof Node) || !chartElement.contains(target)) return;

    this.paneCaptureFrame = requestAnimationFrame(() => {
      this.paneCaptureFrame = undefined;
      if (!this.capturePaneHeights()) return;
      this.persistState();
      if (this.opened) this.renderPanel();
    });
  };

  private readonly onPanelClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add') {
      const select = this.panel.querySelector<HTMLSelectElement>('[data-role="add-select"]');
      if (select?.value) this.addIndicator(select.value);
      return;
    }

    const instanceId = target.closest<HTMLElement>('[data-instance]')?.dataset.instance;

    if (action === 'remove') {
      if (instanceId) this.removeIndicator(instanceId);
      return;
    }

    if (action === 'move-up' || action === 'move-down') {
      if (instanceId) this.moveIndicator(instanceId, action === 'move-up' ? -1 : 1);
      return;
    }

    if (action === 'json-export') {
      this.capturePaneHeights();
      this.persistState(false);
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      area.value = JSON.stringify(this.state, null, 2);
      this.setPanelMessage('현재 지표 구성과 pane 순서/높이를 JSON으로 만들었습니다.');
      area.focus();
      area.select();
      return;
    }

    if (action === 'json-import') {
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      try {
        const parsed = JSON.parse(area.value);
        this.state = normalizeIndicatorState(parsed);
        this.persistState();
        this.rebuild();
        this.setPanelMessage('JSON 구성과 pane 레이아웃을 적용했습니다.');
      } catch (e: any) {
        this.setPanelMessage(`JSON 오류: ${e?.message ?? e}`);
      }
      return;
    }

    if (action === 'defaults') {
      this.state = createDefaultIndicatorState();
      this.persistState();
      this.rebuild();
      this.setPanelMessage('기본 지표 구성을 복원했습니다.');
    }
  };

  private readonly onPanelChange = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const instanceId = target.dataset.instance;
    if (!instanceId) return;

    const config = this.state.indicators.find(x => x.instanceId === instanceId);
    if (!config) return;

    if (target.dataset.role === 'enabled') {
      config.enabled = (target as HTMLInputElement).checked;
      this.commitConfigChange();
      return;
    }

    const paramKey = target.dataset.param;
    if (!paramKey) return;

    const plugin = getIndicatorPlugin(config.indicatorId);
    const def = plugin?.parameters.find(x => x.key === paramKey);
    if (!plugin || !def) return;

    if (def.type === 'boolean') {
      config.params[paramKey] = (target as HTMLInputElement).checked;
    } else if (def.type === 'number' || def.type === 'integer') {
      config.params[paramKey] = Number(target.value);
    } else {
      config.params[paramKey] = target.value;
    }

    config.params = normalizeParams(plugin, config.params);
    config.pluginVersion = plugin.version;
    this.commitConfigChange();
  };

  private readonly onExternalState = (event: CustomEvent<StateEventDetail>): void => {
    const detail = event.detail;
    if (!detail || detail.source === this.hostId || this.disposed) return;
    this.state = normalizeIndicatorState(detail.state);
    this.rebuild();
    this.setPanelMessage('다른 차트에서 변경한 지표 구성과 pane 레이아웃을 동기화했습니다.');
  };

  private addIndicator(indicatorId: string): void {
    const plugin = getIndicatorPlugin(indicatorId);
    if (!plugin) return;

    this.capturePaneHeights();
    const instanceId = `${plugin.id}-${Date.now().toString(36)}-${++this.instanceSeq}`;
    this.state.indicators.push({
      instanceId,
      indicatorId: plugin.id,
      pluginVersion: plugin.version,
      enabled: true,
      params: defaultParams(plugin),
      order: this.state.indicators.length,
      paneHeight: plugin.outputs.some(x => x.pane === 'own') ? 120 : undefined,
    });
    this.commitConfigChange(false);
  }

  private removeIndicator(instanceId: string): void {
    this.capturePaneHeights();
    this.state.indicators = this.state.indicators.filter(x => x.instanceId !== instanceId);
    this.reindexState();
    this.persistState();
    this.rebuild();
  }

  private moveIndicator(instanceId: string, delta: number): void {
    this.capturePaneHeights();
    const current = this.state.indicators.findIndex(x => x.instanceId === instanceId);
    const next = current + delta;
    if (current < 0 || next < 0 || next >= this.state.indicators.length) return;

    const rows = this.state.indicators;
    [rows[current], rows[next]] = [rows[next], rows[current]];
    this.reindexState();
    this.persistState();
    this.rebuild();
  }

  private commitConfigChange(capture = true): void {
    if (capture) this.capturePaneHeights();
    this.reindexState();
    this.state = normalizeIndicatorState(this.state);
    this.persistState();
    this.rebuild();
  }

  private reindexState(): void {
    this.state.indicators.forEach((config, index) => {
      config.order = index;
    });
  }

  private rebuild(render = true): void {
    this.clearRuntimes();

    let ownPane = this.context.firstAddonPane;
    for (const config of this.state.indicators) {
      if (!config.enabled) continue;
      const plugin = getIndicatorPlugin(config.indicatorId);
      if (!plugin) continue;

      const usesOwnPane = plugin.outputs.some(output =>
        (config.pane ?? output.pane) === 'own',
      );
      const paneIndex = usesOwnPane ? ownPane++ : 0;
      let runtime: IndicatorRuntime | undefined;

      try {
        const calculator = plugin.create(config.params);
        runtime = {
          config,
          plugin,
          calculator,
          series: new Map<string, any>(),
          failed: false,
        };

        for (const output of plugin.outputs) {
          const resolvedPane = (config.pane ?? output.pane) === 'own' ? paneIndex : 0;
          const seriesType = output.type === 'histogram'
            ? this.context.lc.HistogramSeries
            : this.context.lc.LineSeries;
          const options = {
            ...(output.options ?? {}),
            ...(config.style?.[output.id] ?? {}),
          };
          const series = this.context.chart.addSeries(seriesType, options, resolvedPane);
          runtime.series.set(output.id, series);
          if (usesOwnPane && !runtime.pane) runtime.pane = series.getPane?.();
        }

        if (this.currentBars.length) {
          this.setRuntimeData(runtime, calculator.reset(this.currentBars));
        }

        this.runtimes.push(runtime);

        if (usesOwnPane) {
          try {
            runtime.pane?.setHeight(Math.max(30, config.paneHeight ?? 120));
          } catch {
            // pane API 차이 또는 제거 직후 상태는 무시한다.
          }
        }
      } catch (e: any) {
        if (runtime) this.removeSeries(runtime.series);
        this.context.reportError(
          `지표 ${config.indicatorId}/${config.instanceId} 로드 실패: ${e?.message ?? e}`,
        );
      }
    }

    this.refreshCount();
    if (render) this.renderPanel();
  }

  private capturePaneHeights(): boolean {
    let changed = false;
    for (const runtime of this.runtimes) {
      if (!runtime.pane || runtime.failed) continue;
      try {
        const raw = Number(runtime.pane.getHeight?.());
        if (!Number.isFinite(raw) || raw < 30) continue;
        const height = Math.round(raw);
        if (runtime.config.paneHeight === height) continue;
        runtime.config.paneHeight = height;
        changed = true;
      } catch {
        // 제거 중인 pane은 무시한다.
      }
    }
    return changed;
  }

  private clearRuntimes(): void {
    for (const runtime of this.runtimes.splice(0)) {
      this.removeSeries(runtime.series);
    }
  }

  private removeSeries(seriesMap: Map<string, any>): void {
    for (const series of seriesMap.values()) {
      try {
        this.context.chart.removeSeries(series);
      } catch {
        // 이미 제거된 series는 무시한다.
      }
    }
    seriesMap.clear();
  }

  private setRuntimeData(
    runtime: IndicatorRuntime,
    data: IndicatorOutputData,
  ): void {
    for (const output of runtime.plugin.outputs) {
      runtime.series.get(output.id)?.setData(data[output.id] ?? []);
    }
  }

  private updateRuntime(
    runtime: IndicatorRuntime,
    update: IndicatorOutputUpdate,
  ): void {
    for (const output of runtime.plugin.outputs) {
      const point = update[output.id];
      if (point) runtime.series.get(output.id)?.update(point);
    }
  }

  private failRuntime(runtime: IndicatorRuntime, error: any): void {
    runtime.failed = true;
    this.removeSeries(runtime.series);
    this.context.reportError(
      `지표 ${runtime.config.indicatorId}/${runtime.config.instanceId} 비활성화: ${error?.message ?? error}`,
    );
    this.setPanelMessage(
      `${runtime.plugin.label} 계산 실패. 기본 차트와 다른 지표는 계속 동작합니다.`,
    );
  }

  private loadState(): IndicatorChartState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeIndicatorState(JSON.parse(saved));

      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const migrated = normalizeIndicatorState(JSON.parse(legacy));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch {
      // 손상된 저장값은 기본값으로 복구한다.
    }
    return createDefaultIndicatorState();
  }

  private persistState(broadcast = true): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // 저장소가 막혀 있어도 현재 세션 차트 동작은 유지한다.
    }

    if (!broadcast) return;
    window.dispatchEvent(new CustomEvent<StateEventDetail>(STATE_EVENT, {
      detail: {
        source: this.hostId,
        state: this.state,
      },
    }));
  }

  private refreshCount(): void {
    const enabled = this.state.indicators.filter(x => x.enabled).length;
    this.count.textContent = enabled ? String(enabled) : '';
    this.count.hidden = enabled === 0;
  }

  private renderPanel(): void {
    this.panel.hidden = !this.opened;
    this.button.classList.toggle('on', this.opened);
    this.refreshCount();
    if (!this.opened) return;

    const plugins = listIndicatorPlugins();
    const rows = this.state.indicators.map((config, index) =>
      this.instanceHtml(config, index),
    ).join('');

    this.panel.innerHTML = `
      <div class="indicator-add-row">
        <select data-role="add-select">
          ${plugins.map(p => `<option value="${this.esc(p.id)}">${this.esc(p.label)}</option>`).join('')}
        </select>
        <button type="button" class="btn" data-action="add">추가</button>
      </div>
      <div class="indicator-instance-list">
        ${rows || '<div class="indicator-empty">표시 중인 지표가 없습니다.</div>'}
      </div>
      <details class="indicator-json">
        <summary>JSON 저장 / 복원</summary>
        <textarea data-role="json" spellcheck="false" placeholder="현재 JSON 버튼을 누르거나 저장한 JSON을 붙여 넣으세요."></textarea>
        <div class="indicator-json-actions">
          <button type="button" class="btn" data-action="json-export">현재 JSON</button>
          <button type="button" class="btn" data-action="json-import">JSON 적용</button>
          <button type="button" class="lnk" data-action="defaults">기본값</button>
        </div>
      </details>
      <div class="indicator-message">${this.esc(this.panelMessage)}</div>`;
  }

  private instanceHtml(config: IndicatorInstanceConfig, index: number): string {
    const plugin = getIndicatorPlugin(config.indicatorId);
    if (!plugin) {
      return `
        <div class="indicator-instance missing" data-instance="${this.esc(config.instanceId)}">
          <div class="indicator-instance-head">
            <label class="chk"><input type="checkbox" data-role="enabled" data-instance="${this.esc(config.instanceId)}" ${config.enabled ? 'checked' : ''}> ${this.esc(config.indicatorId)} [플러그인 없음]</label>
            ${this.orderButtons(index)}
            <button type="button" class="lnk" data-action="remove">삭제</button>
          </div>
        </div>`;
    }

    const params = plugin.parameters.map(def => this.paramHtml(config, def)).join('');
    const ownPane = plugin.outputs.some(output => (config.pane ?? output.pane) === 'own');
    const paneText = ownPane ? ` · pane ${Math.round(config.paneHeight ?? 120)}px` : '';
    return `
      <div class="indicator-instance" data-instance="${this.esc(config.instanceId)}">
        <div class="indicator-instance-head">
          <label class="chk"><input type="checkbox" data-role="enabled" data-instance="${this.esc(config.instanceId)}" ${config.enabled ? 'checked' : ''}> ${this.esc(plugin.label)}</label>
          <span class="indicator-instance-id">${this.esc(config.instanceId)}${this.esc(paneText)}</span>
          ${this.orderButtons(index)}
          <button type="button" class="lnk" data-action="remove">삭제</button>
        </div>
        <div class="indicator-params">${params}</div>
      </div>`;
  }

  private orderButtons(index: number): string {
    const last = this.state.indicators.length - 1;
    return `<span class="indicator-order">
      <button type="button" class="lnk" data-action="move-up" title="위로" ${index <= 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="lnk" data-action="move-down" title="아래로" ${index >= last ? 'disabled' : ''}>↓</button>
    </span>`;
  }

  private paramHtml(
    config: IndicatorInstanceConfig,
    def: IndicatorParameterDef,
  ): string {
    const value = config.params[def.key] ?? def.default;
    const common = `data-instance="${this.esc(config.instanceId)}" data-param="${this.esc(def.key)}"`;

    if (def.type === 'select') {
      return `
        <label>${this.esc(def.label)}
          <select ${common}>
            ${(def.options ?? []).map(option =>
              `<option value="${this.esc(option.value)}" ${String(value) === option.value ? 'selected' : ''}>${this.esc(option.label)}</option>`,
            ).join('')}
          </select>
        </label>`;
    }

    if (def.type === 'boolean') {
      return `
        <label class="chk"><input type="checkbox" ${common} ${value ? 'checked' : ''}> ${this.esc(def.label)}</label>`;
    }

    const step = def.step ?? (def.type === 'integer' ? 1 : 'any');
    return `
      <label>${this.esc(def.label)}
        <input type="number" value="${this.esc(value)}" ${common}
          ${def.min !== undefined ? `min="${def.min}"` : ''}
          ${def.max !== undefined ? `max="${def.max}"` : ''}
          step="${step}">
      </label>`;
  }

  private setPanelMessage(message: string): void {
    this.panelMessage = message;
    const el = this.panel.querySelector<HTMLElement>('.indicator-message');
    if (el) el.textContent = message;
  }

  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    })[char] ?? char);
  }
}
