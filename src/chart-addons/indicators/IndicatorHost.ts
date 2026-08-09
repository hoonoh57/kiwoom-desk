import type {
  ChartBar,
  ChartBarChange,
  ChartExtension,
  ChartExtensionContext,
} from '../../chart/extensions';
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

const STORAGE_KEY = 'kiwoom-desk.chart.indicators.v1';
const STATE_EVENT = 'kiwoom-desk:indicator-state';
let hostSeq = 0;

interface IndicatorRuntime {
  config: IndicatorInstanceConfig;
  plugin: IndicatorPlugin;
  calculator: ReturnType<IndicatorPlugin['create']>;
  series: Map<string, any>;
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

    this.button.removeEventListener('click', this.onToggle);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.panel.removeEventListener('change', this.onPanelChange);
    window.removeEventListener(STATE_EVENT, this.onExternalState as EventListener);
    this.clearRuntimes();
    this.root.remove();
  }

  private readonly onToggle = (): void => {
    this.opened = !this.opened;
    this.renderPanel();
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

    if (action === 'remove') {
      const instanceId = target.closest<HTMLElement>('[data-instance]')?.dataset.instance;
      if (instanceId) this.removeIndicator(instanceId);
      return;
    }

    if (action === 'json-export') {
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      area.value = JSON.stringify(this.state, null, 2);
      area.focus();
      area.select();
      this.setPanelMessage('현재 지표 구성을 JSON으로 만들었습니다.');
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
        this.setPanelMessage('JSON 구성을 적용했습니다.');
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
    this.rebuild(false);
    this.setPanelMessage('다른 차트에서 변경한 지표 구성을 동기화했습니다.');
  };

  private addIndicator(indicatorId: string): void {
    const plugin = getIndicatorPlugin(indicatorId);
    if (!plugin) return;

    const instanceId = `${plugin.id}-${Date.now().toString(36)}-${++this.instanceSeq}`;
    this.state.indicators.push({
      instanceId,
      indicatorId: plugin.id,
      pluginVersion: plugin.version,
      enabled: true,
      params: defaultParams(plugin),
    });
    this.commitConfigChange();
  }

  private removeIndicator(instanceId: string): void {
    this.state.indicators = this.state.indicators.filter(x => x.instanceId !== instanceId);
    this.commitConfigChange();
  }

  private commitConfigChange(): void {
    this.state = normalizeIndicatorState(this.state);
    this.persistState();
    this.rebuild();
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

      try {
        const calculator = plugin.create(config.params);
        const runtime: IndicatorRuntime = {
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
        }

        this.runtimes.push(runtime);
        if (this.currentBars.length) {
          this.setRuntimeData(runtime, calculator.reset(this.currentBars));
        }

        if (usesOwnPane) {
          try {
            this.context.chart.panes()[paneIndex]?.setHeight(120);
          } catch {
            // lightweight-charts pane 높이 API 차이는 무시한다.
          }
        }
      } catch (e: any) {
        this.context.reportError(
          `지표 ${config.indicatorId}/${config.instanceId} 로드 실패: ${e?.message ?? e}`,
        );
      }
    }

    this.refreshCount();
    if (render) this.renderPanel();
  }

  private clearRuntimes(): void {
    for (const runtime of this.runtimes.splice(0)) {
      for (const series of runtime.series.values()) {
        try {
          this.context.chart.removeSeries(series);
        } catch {
          // 이미 제거된 series는 무시한다.
        }
      }
    }
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
    for (const series of runtime.series.values()) {
      try {
        this.context.chart.removeSeries(series);
      } catch {
        // ignore
      }
    }
    runtime.series.clear();
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
      if (!saved) return createDefaultIndicatorState();
      return normalizeIndicatorState(JSON.parse(saved));
    } catch {
      return createDefaultIndicatorState();
    }
  }

  private persistState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // 저장소가 막혀 있어도 현재 차트 기능은 유지한다.
    }

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
    const rows = this.state.indicators.map(config => this.instanceHtml(config)).join('');

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

  private instanceHtml(config: IndicatorInstanceConfig): string {
    const plugin = getIndicatorPlugin(config.indicatorId);
    if (!plugin) {
      return `
        <div class="indicator-instance missing" data-instance="${this.esc(config.instanceId)}">
          <div class="indicator-instance-head">
            <label class="chk"><input type="checkbox" data-role="enabled" data-instance="${this.esc(config.instanceId)}" ${config.enabled ? 'checked' : ''}> ${this.esc(config.indicatorId)} [플러그인 없음]</label>
            <button type="button" class="lnk" data-action="remove">삭제</button>
          </div>
        </div>`;
    }

    const params = plugin.parameters.map(def => this.paramHtml(config, def)).join('');
    return `
      <div class="indicator-instance" data-instance="${this.esc(config.instanceId)}">
        <div class="indicator-instance-head">
          <label class="chk"><input type="checkbox" data-role="enabled" data-instance="${this.esc(config.instanceId)}" ${config.enabled ? 'checked' : ''}> ${this.esc(plugin.label)}</label>
          <span class="indicator-instance-id">${this.esc(config.instanceId)}</span>
          <button type="button" class="lnk" data-action="remove">삭제</button>
        </div>
        <div class="indicator-params">${params}</div>
      </div>`;
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
    if (this.opened) this.renderPanel();
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
