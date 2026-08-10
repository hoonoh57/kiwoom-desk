import type { AppContext } from '../../src/core/context';
import { Topics, type StrategyTradeIntentPayload } from '../../src/core/events';
import type {
  ChartBar,
  ChartBarChange,
  ChartExtension,
  ChartExtensionContext,
} from '../../src/chart/extensions';
import {
  createDefaultStrategyState,
  defaultStrategyParams,
  getStrategyPlugin,
  listStrategyPlugins,
  normalizeStrategyParams,
  normalizeStrategyState,
} from './catalog';
import type {
  StrategyChartState,
  StrategyEvaluation,
  StrategyInstanceConfig,
  StrategyParameterDef,
  StrategyPlugin,
  StrategySignal,
} from './types';

const STORAGE_KEY = 'kiwoom-desk.chart.strategies.v1';
const STATE_EVENT = 'kiwoom-desk:strategy-state';
let hostSeq = 0;

interface StrategyRuntime {
  config: StrategyInstanceConfig;
  plugin: StrategyPlugin;
  calculator: ReturnType<StrategyPlugin['create']>;
  signals: readonly StrategySignal[];
  failed: boolean;
}

interface StateEventDetail {
  source: string;
  state: StrategyChartState;
}

interface BrokerStatePayload { armed?: boolean; mode?: string; }

export class StrategyHost implements ChartExtension {
  private readonly hostId = `strategy-host-${++hostSeq}`;
  private readonly root = document.createElement('span');
  private readonly button = document.createElement('button');
  private readonly count = document.createElement('span');
  private readonly panel = document.createElement('div');
  private readonly runtimes: StrategyRuntime[] = [];
  private readonly dispatched = new Set<string>();
  private currentBars: readonly ChartBar[] = [];
  private state: StrategyChartState;
  private markerApi: any;
  private markerHash = '';
  private opened = false;
  private disposed = false;
  private instanceSeq = 0;
  private panelMessage = '';
  private brokerArmed = false;

  constructor(
    private readonly context: ChartExtensionContext,
    private readonly app: AppContext,
  ) {
    this.state = this.loadState();

    const primarySeries = context.chart.panes?.()[0]?.getSeries?.()[0];
    if (!primarySeries || typeof context.lc.createSeriesMarkers !== 'function') {
      throw new Error('전략 marker를 붙일 기본 candlestick series를 찾지 못했습니다.');
    }
    this.markerApi = context.lc.createSeriesMarkers(primarySeries, []);

    this.root.className = 'chart-strategy-addon';
    this.button.type = 'button';
    this.button.className = 'lnk chart-strategy-button';
    this.button.textContent = '전략';
    this.count.className = 'chart-strategy-count';
    this.panel.className = 'chart-strategy-panel';
    this.root.append(this.button, this.count, this.panel);
    context.toolbar.appendChild(this.root);

    this.button.addEventListener('click', this.onToggle);
    this.panel.addEventListener('click', this.onPanelClick);
    this.panel.addEventListener('change', this.onPanelChange);
    window.addEventListener(STATE_EVENT, this.onExternalState as EventListener);
    this.app.bus.on<BrokerStatePayload>(Topics.StrategyBrokerState, this.onBrokerState);

    this.rebuild();
    this.renderPanel();
    this.app.bus.emit(Topics.StrategyPortfolioRequest, { source: this.hostId });
  }

  onBarsReset(bars: readonly ChartBar[]): void {
    this.currentBars = bars;
    for (const runtime of this.runtimes) {
      if (runtime.failed) continue;
      try {
        runtime.signals = runtime.calculator.reset(bars).signals;
      } catch (e: any) {
        this.failRuntime(runtime, e);
      }
    }
    this.paintMarkers();
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
        const before = new Set(runtime.signals.map(signalKey));
        const evaluation = runtime.calculator.update(bars, change);
        runtime.signals = evaluation.signals;
        this.emitNewLiveSignals(runtime, before, evaluation);
      } catch (e: any) {
        this.failRuntime(runtime, e);
      }
    }
    this.paintMarkers();

    // 새 봉의 첫 체결이 들어온 순간 직전 봉은 확정된다. 실제 주문은 확정봉 신호만 사용한다.
    if (change === 'append' && bars.length >= 2) {
      const finalizedTime = bars[bars.length - 2].time;
      for (const runtime of this.runtimes) this.dispatchFinalizedTrades(runtime, finalizedTime);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.button.removeEventListener('click', this.onToggle);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.panel.removeEventListener('change', this.onPanelChange);
    window.removeEventListener(STATE_EVENT, this.onExternalState as EventListener);
    try { this.markerApi?.detach?.(); } catch { /* ignore */ }
    this.markerApi = undefined;
    this.runtimes.length = 0;
    this.root.remove();
  }

  private readonly onToggle = (): void => {
    this.opened = !this.opened;
    this.renderPanel();
  };

  private readonly onBrokerState = (payload: BrokerStatePayload): void => {
    this.brokerArmed = payload?.armed === true;
    if (this.opened) this.renderPanel();
  };

  private readonly onPanelClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'add') {
      const select = this.panel.querySelector<HTMLSelectElement>('[data-role="add-select"]');
      if (select?.value) this.addStrategy(select.value);
      return;
    }

    if (action === 'broker-arm') {
      if (this.brokerArmed) {
        this.app.bus.emit(Topics.StrategyBrokerArm, { source: this.hostId, armed: false, confirmed: true });
        return;
      }
      const mode = this.app.state.mode;
      const ok = confirm(
        `전략 브로커 주문 잠금 해제\n\n현재 API 모드: ${mode}\n\n` +
        'broker 실행모드 전략의 BUY/SELL 신호가 실제 연결된 주문 API로 전송됩니다.\n' +
        '이 잠금은 앱을 다시 시작하면 자동으로 잠깁니다.\n\n계속할까요?',
      );
      if (ok) this.app.bus.emit(Topics.StrategyBrokerArm, { source: this.hostId, armed: true, confirmed: true });
      return;
    }

    if (action === 'json-export') {
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      area.value = JSON.stringify(this.state, null, 2);
      this.setPanelMessage('현재 전략 구성을 JSON으로 만들었습니다. broker ARM 상태는 저장하지 않습니다.');
      area.focus();
      area.select();
      return;
    }

    if (action === 'json-import') {
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      try {
        this.state = normalizeStrategyState(JSON.parse(area.value));
        this.persistState();
        this.rebuild();
        this.setPanelMessage('전략 JSON을 적용했습니다. broker 주문은 여전히 LOCK 상태입니다.');
      } catch (e: any) {
        this.setPanelMessage(`JSON 오류: ${e?.message ?? e}`);
      }
      return;
    }

    if (action === 'defaults') {
      this.state = createDefaultStrategyState();
      this.persistState();
      this.rebuild();
      this.setPanelMessage('전략 구성을 비웠습니다.');
      return;
    }

    const instanceId = target.closest<HTMLElement>('[data-instance]')?.dataset.instance;
    if (action === 'remove' && instanceId) this.removeStrategy(instanceId);
  };

  private readonly onPanelChange = (event: Event): void => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const instanceId = target.dataset.instance;
    if (!instanceId) return;
    const config = this.state.strategies.find(x => x.instanceId === instanceId);
    if (!config) return;

    const role = target.dataset.role;
    if (role === 'enabled') config.enabled = (target as HTMLInputElement).checked;
    else if (role === 'markers') config.showMarkers = (target as HTMLInputElement).checked;
    else if (role === 'exec-mode') config.execution.mode = target.value as any;
    else if (role === 'exec-qty') config.execution.qty = Math.max(1, Math.trunc(Number(target.value) || 1));
    else if (role === 'exec-exchange') config.execution.exchange = target.value as any;
    else {
      const paramKey = target.dataset.param;
      if (!paramKey) return;
      const plugin = getStrategyPlugin(config.strategyId);
      const def = plugin?.parameters.find(x => x.key === paramKey);
      if (!plugin || !def) return;
      if (def.type === 'boolean') config.params[paramKey] = (target as HTMLInputElement).checked;
      else if (def.type === 'number' || def.type === 'integer') config.params[paramKey] = Number(target.value);
      else config.params[paramKey] = target.value;
      config.params = normalizeStrategyParams(plugin, config.params);
      config.pluginVersion = plugin.version;
    }

    this.commitConfigChange();
  };

  private readonly onExternalState = (event: CustomEvent<StateEventDetail>): void => {
    const detail = event.detail;
    if (!detail || detail.source === this.hostId || this.disposed) return;
    this.state = normalizeStrategyState(detail.state);
    this.rebuild();
    this.setPanelMessage('다른 차트에서 변경한 전략 구성을 동기화했습니다.');
  };

  private addStrategy(strategyId: string): void {
    const plugin = getStrategyPlugin(strategyId);
    if (!plugin) return;
    const instanceId = `${plugin.id}-${Date.now().toString(36)}-${++this.instanceSeq}`;
    this.state.strategies.push({
      instanceId,
      strategyId: plugin.id,
      pluginVersion: plugin.version,
      enabled: true,
      params: defaultStrategyParams(plugin),
      execution: { mode: 'signal', qty: 1, exchange: 'SOR', orderType: '3' },
      showMarkers: true,
      order: this.state.strategies.length,
    });
    this.commitConfigChange();
  }

  private removeStrategy(instanceId: string): void {
    this.state.strategies = this.state.strategies.filter(x => x.instanceId !== instanceId);
    this.reindex();
    this.persistState();
    this.rebuild();
  }

  private commitConfigChange(): void {
    this.reindex();
    this.state = normalizeStrategyState(this.state);
    this.persistState();
    this.rebuild();
  }

  private reindex(): void {
    this.state.strategies.forEach((config, index) => { config.order = index; });
  }

  private rebuild(): void {
    this.runtimes.length = 0;
    for (const config of this.state.strategies) {
      if (!config.enabled) continue;
      const plugin = getStrategyPlugin(config.strategyId);
      if (!plugin) continue;
      try {
        const calculator = plugin.create(config.params);
        const runtime: StrategyRuntime = {
          config,
          plugin,
          calculator,
          signals: [],
          failed: false,
        };
        if (this.currentBars.length) runtime.signals = calculator.reset(this.currentBars).signals;
        this.runtimes.push(runtime);
      } catch (e: any) {
        this.context.reportError(`전략 ${config.strategyId}/${config.instanceId} 로드 실패: ${e?.message ?? e}`);
      }
    }
    this.paintMarkers();
    this.refreshCount();
    this.renderPanel();
  }

  private emitNewLiveSignals(
    runtime: StrategyRuntime,
    before: Set<string>,
    evaluation: StrategyEvaluation,
  ): void {
    const latest = this.currentBars[this.currentBars.length - 1];
    if (!latest) return;
    for (const signal of evaluation.signals) {
      if (String(signal.time) !== String(latest.time) || before.has(signalKey(signal))) continue;
      this.app.bus.emit(Topics.StrategySignal, {
        source: this.hostId,
        strategyId: runtime.plugin.id,
        strategyInstanceId: runtime.config.instanceId,
        code: this.identity().code,
        signal,
      });
    }
  }

  private dispatchFinalizedTrades(runtime: StrategyRuntime, finalizedTime: any): void {
    if (runtime.failed || runtime.config.execution.mode === 'signal') return;
    const identity = this.identity();
    if (!identity.code) return;

    for (const signal of runtime.signals) {
      if (String(signal.time) !== String(finalizedTime)) continue;
      if (signal.type !== 'buy' && signal.type !== 'sell') continue;
      const dispatchKey = `${runtime.config.instanceId}|${identity.code}|${String(signal.time)}|${signal.type}`;
      if (this.dispatched.has(dispatchKey)) continue;
      this.dispatched.add(dispatchKey);

      const intent: StrategyTradeIntentPayload = {
        source: this.hostId,
        strategyId: runtime.plugin.id,
        strategyInstanceId: runtime.config.instanceId,
        strategyLabel: runtime.plugin.label,
        code: identity.code,
        name: identity.name,
        side: signal.type,
        executionMode: runtime.config.execution.mode,
        qty: runtime.config.execution.qty,
        exchange: runtime.config.execution.exchange,
        orderType: runtime.config.execution.orderType,
        referencePrice: signal.price,
        signalTime: signal.time,
        reason: signal.reason,
        chartPeriod: identity.period,
        chartScope: identity.scope,
      };
      this.app.bus.emit(Topics.StrategyTradeIntent, intent);
    }
  }

  private identity(): { code: string; name: string; period: string; scope: string } {
    const form = this.context.toolbar.closest('.chart-form');
    const code = (form?.querySelector<HTMLInputElement>('#cCode')?.value ?? '').trim().replace(/^[A-Za-z]+/, '');
    const name = form?.querySelector<HTMLElement>('#cName')?.textContent?.trim() ?? '';
    const period = form?.querySelector<HTMLElement>('[data-p].on')?.getAttribute('data-p') ?? '';
    const scope = form?.querySelector<HTMLSelectElement>('#cScope')?.value ?? '';
    return { code, name, period, scope };
  }

  private paintMarkers(): void {
    if (!this.markerApi) return;
    const markers: any[] = [];
    for (const runtime of this.runtimes) {
      if (runtime.failed || !runtime.config.showMarkers) continue;
      for (const signal of runtime.signals) markers.push(markerOf(signal));
    }
    markers.sort((a, b) => timeKey(a.time) - timeKey(b.time));
    const hash = JSON.stringify(markers);
    if (hash === this.markerHash) return;
    this.markerHash = hash;
    this.markerApi.setMarkers(markers);
  }

  private failRuntime(runtime: StrategyRuntime, error: any): void {
    runtime.failed = true;
    this.context.reportError(
      `전략 ${runtime.config.strategyId}/${runtime.config.instanceId} 비활성화: ${error?.message ?? error}`,
    );
    this.setPanelMessage(`${runtime.plugin.label} 계산 실패. 기본 차트와 다른 전략은 계속 동작합니다.`);
  }

  private loadState(): StrategyChartState {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return normalizeStrategyState(JSON.parse(saved));
    } catch {
      // 손상된 저장값은 빈 구성으로 복구한다.
    }
    return createDefaultStrategyState();
  }

  private persistState(broadcast = true): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
    if (!broadcast) return;
    window.dispatchEvent(new CustomEvent<StateEventDetail>(STATE_EVENT, {
      detail: { source: this.hostId, state: this.state },
    }));
  }

  private refreshCount(): void {
    const enabled = this.state.strategies.filter(x => x.enabled).length;
    this.count.textContent = enabled ? String(enabled) : '';
    this.count.hidden = enabled === 0;
  }

  private renderPanel(): void {
    this.panel.hidden = !this.opened;
    this.button.classList.toggle('on', this.opened);
    this.refreshCount();
    if (!this.opened) return;

    const plugins = listStrategyPlugins();
    const rows = this.state.strategies.map(config => this.instanceHtml(config)).join('');
    this.panel.innerHTML = `
      <div class="strategy-arm-row">
        <button type="button" class="btn ${this.brokerArmed ? 'sell' : ''}" data-action="broker-arm">
          브로커 주문 ${this.brokerArmed ? 'ARMED' : 'LOCKED'}
        </button>
        <span>${this.esc(this.app.state.mode)} · 앱 재시작 시 자동 LOCK</span>
      </div>
      <div class="strategy-add-row">
        <select data-role="add-select">
          ${plugins.map(p => `<option value="${this.esc(p.id)}">${this.esc(p.label)}</option>`).join('')}
        </select>
        <button type="button" class="btn" data-action="add">추가</button>
      </div>
      <div class="strategy-instance-list">
        ${rows || '<div class="strategy-empty">적용 중인 전략이 없습니다.</div>'}
      </div>
      <details class="strategy-json">
        <summary>JSON 저장 / 복원</summary>
        <textarea data-role="json" spellcheck="false" placeholder="현재 JSON 또는 저장한 전략 JSON"></textarea>
        <div class="strategy-json-actions">
          <button type="button" class="btn" data-action="json-export">현재 JSON</button>
          <button type="button" class="btn" data-action="json-import">JSON 적용</button>
          <button type="button" class="lnk" data-action="defaults">모두 제거</button>
        </div>
      </details>
      <div class="strategy-message">${this.esc(this.panelMessage)}</div>`;
  }

  private instanceHtml(config: StrategyInstanceConfig): string {
    const plugin = getStrategyPlugin(config.strategyId);
    if (!plugin) {
      return `<div class="strategy-instance missing" data-instance="${this.esc(config.instanceId)}">
        ${this.esc(config.strategyId)} [플러그인 없음]
        <button type="button" class="lnk" data-action="remove">삭제</button></div>`;
    }
    const params = plugin.parameters.map(def => this.paramHtml(config, def)).join('');
    return `<div class="strategy-instance" data-instance="${this.esc(config.instanceId)}">
      <div class="strategy-instance-head">
        <label class="chk"><input type="checkbox" data-role="enabled" data-instance="${this.esc(config.instanceId)}" ${config.enabled ? 'checked' : ''}> ${this.esc(plugin.label)}</label>
        <span class="strategy-instance-id">${this.esc(config.instanceId)}</span>
        <button type="button" class="lnk" data-action="remove">삭제</button>
      </div>
      <div class="strategy-desc">${this.esc(plugin.description ?? '')}</div>
      <div class="strategy-exec">
        <label>실행
          <select data-role="exec-mode" data-instance="${this.esc(config.instanceId)}">
            ${[['signal','신호만'],['paper','Paper'],['broker','Broker 주문']].map(([v,t]) =>
              `<option value="${v}" ${config.execution.mode === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </label>
        <label>수량<input type="number" min="1" step="1" data-role="exec-qty" data-instance="${this.esc(config.instanceId)}" value="${config.execution.qty}"></label>
        <label>거래소<select data-role="exec-exchange" data-instance="${this.esc(config.instanceId)}">
          ${['SOR','KRX','NXT'].map(v => `<option ${config.execution.exchange === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>
        <label class="chk"><input type="checkbox" data-role="markers" data-instance="${this.esc(config.instanceId)}" ${config.showMarkers ? 'checked' : ''}> 신호표시</label>
      </div>
      <div class="strategy-params">${params}</div>
    </div>`;
  }

  private paramHtml(config: StrategyInstanceConfig, def: StrategyParameterDef): string {
    const value = config.params[def.key] ?? def.default;
    const common = `data-instance="${this.esc(config.instanceId)}" data-param="${this.esc(def.key)}"`;
    if (def.type === 'select') {
      return `<label>${this.esc(def.label)}<select ${common}>
        ${(def.options ?? []).map(o => `<option value="${this.esc(o.value)}" ${String(value) === o.value ? 'selected' : ''}>${this.esc(o.label)}</option>`).join('')}
      </select></label>`;
    }
    if (def.type === 'boolean') {
      return `<label class="chk"><input type="checkbox" ${common} ${value ? 'checked' : ''}> ${this.esc(def.label)}</label>`;
    }
    const step = def.step ?? (def.type === 'integer' ? 1 : 'any');
    return `<label>${this.esc(def.label)}<input type="number" value="${this.esc(value)}" ${common}
      ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''} step="${step}"></label>`;
  }

  private setPanelMessage(message: string): void {
    this.panelMessage = message;
    const el = this.panel.querySelector<HTMLElement>('.strategy-message');
    if (el) el.textContent = message;
  }

  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>\"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    })[c] ?? c);
  }
}

function signalKey(signal: StrategySignal): string {
  return `${String(signal.time)}|${signal.type}|${signal.price}|${signal.reason}`;
}

function markerOf(signal: StrategySignal): any {
  switch (signal.type) {
    case 'buy':
      return { time: signal.time, position: 'belowBar', color: '#00C853', shape: 'arrowUp', text: 'BUY' };
    case 'sell':
      return { time: signal.time, position: 'aboveBar', color: '#FF5252', shape: 'arrowDown', text: 'SELL' };
    case 'arm':
      return { time: signal.time, position: 'belowBar', color: '#FFD54F', shape: 'circle', text: 'ARM' };
    default:
      return { time: signal.time, position: 'aboveBar', color: '#9E9E9E', shape: 'circle', text: 'FAIL' };
  }
}

function timeKey(time: any): number {
  return typeof time === 'number' ? time : Date.parse(String(time));
}
