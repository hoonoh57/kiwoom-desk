import type { AppContext } from '../core/context';
import {
  Topics,
  type StrategyPortfolioSnapshot,
  type StrategyPositionSnapshot,
  type TradeProtectionItem,
  type TradeProtectionSnapshot,
} from '../core/events';
import {
  canApplyLinkedSymbol,
  chartForcedLockReason,
  plainChartCode,
  type ChartControlMode,
} from '../chart/windowPolicy';
import { loadWorkbenchSettings } from '../settings';
import { ChildForm } from './ChildForm';
import { ChartForm } from './ChartForm';
import '../styles/chartWorkspace.css';

type TradeSide = 'buy' | 'sell';

interface ActionableSignal {
  side: TradeSide;
  strategyLabel: string;
  reason: string;
}

interface SymbolMessage {
  source?: string;
  route?: 'linked' | 'inform';
  code?: string;
  name?: string;
}

/**
 * ChartForm의 가격/지표/실시간 로직을 건드리지 않고 그 위에
 * 차트별 종목 연동 잠금, AUTO/반자동/수동 제어, 주문 진입 UI를 제공한다.
 *
 * 핵심 규칙
 * - 기본 userLocked=true: 조건검색/관심종목 등 외부 SymbolSelected를 차단한다.
 * - AUTO, 전략 포지션, 일반 미체결/계좌 보유 종목이면 강제잠금한다.
 * - ChartForm 자체의 종목 변경 알림은 route=inform 으로 바꿔 다른 차트에 전파하지 않는다.
 * - 외부 linked 선택은 잠금이 풀린 모든 차트에 동일하게 적용된다.
 */
export class ChartWorkspaceForm extends ChildForm {
  private chart?: ChartForm;
  /** Opaque child state owned semantically by ChartForm/runtime, never interpreted here. */
  private chartState: unknown;
  private userLocked = true;
  private controlMode: ChartControlMode = 'manual';
  private positions: StrategyPositionSnapshot[] = [];
  private protections: TradeProtectionItem[] = [];
  private orderQty = '';
  private actionable?: ActionableSignal;

  protected onInit(): void {
    const settings = loadWorkbenchSettings();
    const rememberedQty = this.orderQty || String(settings.order.defaultQuantity);
    this.orderQty = String(this.params.qty ?? rememberedQty);

    // Parent/session restore may replace the complete opaque chart child state.
    // Workspace must not inspect core/add-on/nested child schemas.
    if (this.params.chartState !== undefined) {
      this.chartState = structuredClone(this.params.chartState);
    }

    if (typeof this.params.locked === 'boolean') {
      this.userLocked = this.params.locked;
    }
    const requestedMode = String(this.params.controlMode ?? '').toLowerCase();
    if (requestedMode === 'auto' || requestedMode === 'semi' || requestedMode === 'manual') {
      this.controlMode = requestedMode;
    }

    this.renderWorkspace();
    this.mountChart();
    this.bindWorkspaceEvents();
    this.ctx.bus.emit(Topics.StrategyPortfolioRequest, { source: this.formKey });
    this.ctx.bus.emit(Topics.TradeProtectionRequest, { source: this.formKey });
    this.paintProtection();
  }

  private renderWorkspace(): void {
    this.html(`
      <div class="chart-workspace">
        <div class="chart-workspace-bar">
          <button type="button" class="cw-lock" id="cwLock" title="외부 종목 선택 연동 잠금">🔒 잠금</button>
          <span class="cw-trade-state" id="cwTradeState">수동</span>
          <span class="cw-sep"></span>
          <span class="cw-modes" aria-label="차트 매매 제어 모드">
            <button type="button" class="cw-mode auto" data-cw-mode="auto">AUTO</button>
            <button type="button" class="cw-mode semi" data-cw-mode="semi">반자동</button>
            <button type="button" class="cw-mode manual" data-cw-mode="manual">수동</button>
          </span>
          <span class="cw-signal" id="cwSignal"></span>
          <span class="tr-flex"></span>
          <label class="cw-qty-label">수량
            <input id="cwQty" class="cw-qty" value="${this.esc(this.orderQty)}" inputmode="numeric" maxlength="9">
          </label>
          <button type="button" class="cw-order buy" id="cwBuy">매수</button>
          <button type="button" class="cw-order sell" id="cwSell">매도</button>
          <span class="cw-window-actions">
            <button type="button" class="cw-window" id="cwMin" title="최소화">—</button>
            <button type="button" class="cw-window" id="cwMax" title="최대화/이전 크기">□</button>
            <button type="button" class="cw-window" id="cwPop" title="독립창/자식창">↗</button>
            <button type="button" class="cw-window close" id="cwClose" title="차트 닫기">×</button>
          </span>
        </div>
        <div class="chart-workspace-body" id="cwBody"></div>
      </div>`);
  }

  private mountChart(): void {
    const host = this.$('#cwBody');
    if (!host) return;

    const childContext = this.createChartContext();
    const forwardState = typeof this.params.onChartStateChange === 'function'
      ? this.params.onChartStateChange as (state: unknown) => void
      : undefined;
    const childParams = {
      ...this.params,
      chartState: this.chartState === undefined ? undefined : structuredClone(this.chartState),
      onChartStateChange: (state: unknown) => {
        const snapshot = state === undefined ? undefined : structuredClone(state);
        this.chartState = snapshot;
        // Keep this parent instance's opaque params current for its own re-init path.
        this.params.chartState = snapshot;
        forwardState?.(snapshot === undefined ? undefined : structuredClone(snapshot));
      },
    };

    this.chart = new ChartForm(childContext, childParams);
    this.chart.attach(host, this.panelApi);

    this.track(() => {
      this.chart?.dispose();
      this.chart = undefined;
    });
  }

  private bindWorkspaceEvents(): void {
    this.$('#cwLock')?.addEventListener('click', () => {
      if (this.forcedReason()) return;
      this.userLocked = !this.userLocked;
      this.paintProtection();
    });

    this.$$<HTMLButtonElement>('[data-cw-mode]').forEach(button => {
      button.addEventListener('click', () => {
        const mode = button.dataset.cwMode as ChartControlMode | undefined;
        if (mode !== 'auto' && mode !== 'semi' && mode !== 'manual') return;
        this.controlMode = mode;
        if (mode !== 'semi') this.actionable = undefined;
        this.paintProtection();
      });
    });

    this.$<HTMLInputElement>('#cwQty')?.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const qty = Math.max(1, Math.trunc(Number(input.value) || 1));
      this.orderQty = String(qty);
      input.value = this.orderQty;
    });

    this.$('#cwBuy')?.addEventListener('click', () => this.openOrder('buy'));
    this.$('#cwSell')?.addEventListener('click', () => this.openOrder('sell'));
    this.$('#cwMin')?.addEventListener('click', () => this.toggleMinimize());
    this.$('#cwMax')?.addEventListener('click', () => this.toggleMaximize());
    this.$('#cwPop')?.addEventListener('click', () => void this.togglePopout());
    this.$('#cwClose')?.addEventListener('click', () => this.closeSelf());

    if (this.panelApi?.onDidLocationChange) {
      const d = this.panelApi.onDidLocationChange(() => {
        requestAnimationFrame(() => this.paintWindowActions());
      });
      this.track(() => d.dispose());
    }

    const body = this.$('#cwBody');
    body?.addEventListener('change', event => {
      const target = event.target as HTMLElement;
      if (target.id === 'cCode') requestAnimationFrame(() => this.paintProtection());
    });
    body?.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.id === 'cGo') requestAnimationFrame(() => this.paintProtection());
    });

    this.track(this.ctx.bus.on<StrategyPortfolioSnapshot>(
      Topics.StrategyPortfolioChanged,
      snapshot => {
        this.positions = Array.isArray(snapshot?.positions)
          ? snapshot.positions.map(position => ({ ...position }))
          : [];
        this.paintProtection();
      },
    ));

    this.track(this.ctx.bus.on<TradeProtectionSnapshot>(
      Topics.TradeProtectionChanged,
      snapshot => {
        this.protections = Array.isArray(snapshot?.items)
          ? snapshot.items.map(item => ({ ...item }))
          : [];
        this.paintProtection();
      },
    ));

    this.track(this.ctx.bus.on(Topics.StrategySignal, (payload: any) => {
      if (this.controlMode !== 'semi') return;
      if (payload?.phase !== 'finalized' || payload?.actionable !== true) return;

      const symbol = this.currentSymbol();
      if (!symbol.code || plainChartCode(payload?.code) !== symbol.code) return;

      const side = String(payload?.signal?.type ?? '');
      if (side !== 'buy' && side !== 'sell') return;

      this.actionable = {
        side,
        strategyLabel: String(payload?.strategyLabel ?? payload?.strategyId ?? '전략'),
        reason: String(payload?.signal?.reason ?? ''),
      };
      this.paintProtection();
    }));

    // 자식 ChartForm이 직접 종목을 조회한 뒤 보내는 inform 알림은
    // 다른 차트에는 전달하지 않지만 이 Workspace의 상태표시는 즉시 갱신한다.
    this.track(this.ctx.bus.on<SymbolMessage>(Topics.SymbolSelected, payload => {
      if (payload?.source !== this.chart?.formKey || payload?.route !== 'inform') return;
      this.actionable = undefined;
      this.paintProtection();
    }));
  }

  /**
   * ChartForm 전용 EventBus facade.
   * SymbolSelected만 라우팅하고 나머지 토픽은 원래 전역 버스를 그대로 사용한다.
   */
  private createChartContext(): AppContext {
    const child = Object.create(this.ctx) as AppContext;
    const globalBus = this.ctx.bus;

    const scopedBus = {
      on: globalBus.on.bind(globalBus),
      onExcept: (topic: string, self: string, handler: (payload: any) => void) => {
        if (topic !== Topics.SymbolSelected) {
          return globalBus.onExcept(topic, self, handler);
        }

        return globalBus.onExcept(topic, self, (payload: SymbolMessage) => {
          if (payload?.route === 'inform') return;
          if (!this.canApplyLinkedSelection()) return;
          this.actionable = undefined;
          handler(payload);
          requestAnimationFrame(() => this.paintProtection());
        });
      },
      emit: (topic: string, payload: any) => {
        if (topic === Topics.SymbolSelected) {
          globalBus.emit(topic, { ...payload, route: 'inform' } as SymbolMessage);
          return;
        }
        globalBus.emit(topic, payload);
      },
      dispose: () => undefined,
    };

    Object.defineProperty(child, 'bus', {
      value: scopedBus,
      enumerable: true,
      configurable: true,
    });
    return child;
  }

  private currentSymbol(): { code: string; name: string } {
    const code = plainChartCode(
      this.$<HTMLInputElement>('#cCode')?.value
      ?? this.params.code
      ?? this.ctx.state.symbol.code,
    );
    const name = this.$<HTMLElement>('#cName')?.textContent?.trim()
      ?? String(this.params.name ?? '');
    return { code, name };
  }

  private accountProtectionReason(code: string): string {
    const item = this.protections.find(
      protection => plainChartCode(protection.code) === plainChartCode(code),
    );
    return item?.label ?? '';
  }

  private forcedReason(): string {
    const symbol = this.currentSymbol();
    const account = this.accountProtectionReason(symbol.code);
    if (account) return account;
    return chartForcedLockReason(this.controlMode, symbol.code, this.positions);
  }

  private canApplyLinkedSelection(): boolean {
    const symbol = this.currentSymbol();
    if (this.accountProtectionReason(symbol.code)) return false;
    return canApplyLinkedSymbol(
      this.userLocked,
      this.controlMode,
      symbol.code,
      this.positions,
    );
  }

  private paintProtection(): void {
    const symbol = this.currentSymbol();
    const forced = this.forcedReason();
    const effectiveLocked = this.userLocked || !!forced;

    const workspace = this.$('.chart-workspace');
    workspace?.setAttribute('data-control-mode', this.controlMode);
    workspace?.setAttribute('data-symbol-locked', effectiveLocked ? '1' : '0');

    const chartForm = this.$('.chart-form');
    chartForm?.setAttribute('data-control-mode', this.controlMode);
    chartForm?.setAttribute('data-chart-workspace', this.formKey);
    chartForm?.setAttribute('data-symbol-locked', effectiveLocked ? '1' : '0');

    const lock = this.$<HTMLButtonElement>('#cwLock');
    if (lock) {
      lock.disabled = !!forced;
      lock.classList.toggle('unlocked', !effectiveLocked);
      lock.classList.toggle('forced', !!forced);
      lock.textContent = forced
        ? `🔒 ${forced}`
        : this.userLocked
          ? '🔒 잠금'
          : '🔓 연동';
      lock.title = forced
        ? `현재 종목 ${symbol.code || '-'}은 ${forced} 상태라 종목 변경이 강제 차단됩니다.`
        : this.userLocked
          ? '외부 조건검색/관심종목 클릭으로 종목이 바뀌지 않습니다.'
          : '외부 종목 선택을 이 차트에 적용합니다.';
    }

    this.$$<HTMLButtonElement>('[data-cw-mode]').forEach(button => {
      button.classList.toggle('on', button.dataset.cwMode === this.controlMode);
    });

    const tradeState = this.$('#cwTradeState');
    if (tradeState) {
      tradeState.textContent = forced
        ? forced
        : this.controlMode === 'auto'
          ? 'AUTO 전략 자동실행'
          : this.controlMode === 'semi'
            ? '반자동 · 체결 전 확인'
            : '수동';
      tradeState.className = `cw-trade-state ${forced ? 'forced' : this.controlMode}`;
    }

    const codeInput = this.$<HTMLInputElement>('#cCode');
    const goButton = this.$<HTMLButtonElement>('#cGo');
    // 일반 사용자 잠금은 "외부 연동"만 막는다. AUTO/매매중 강제잠금에서는
    // 직접 종목입력도 막아 주문 대상 종목이 UI로 바뀌는 경로를 닫는다.
    if (codeInput) codeInput.disabled = !!forced;
    if (goButton) goButton.disabled = !!forced;

    const signal = this.$('#cwSignal');
    if (signal) {
      signal.textContent = this.actionable
        ? `${this.actionable.side === 'buy' ? 'BUY' : 'SELL'} · ${this.actionable.strategyLabel}${this.actionable.reason ? ` · ${this.actionable.reason}` : ''}`
        : '';
      signal.title = this.actionable?.reason ?? '';
    }

    const buy = this.$('#cwBuy');
    const sell = this.$('#cwSell');
    buy?.classList.toggle('recommended', this.actionable?.side === 'buy');
    sell?.classList.toggle('recommended', this.actionable?.side === 'sell');

    this.paintWindowActions();
  }

  private paintWindowActions(): void {
    const key = String(this.panelApi?.id ?? '');
    if (!key) return;

    const state = this.ctx.dock?.windowState?.(key);
    if (!state) return;

    const minButton = this.$<HTMLButtonElement>('#cwMin');
    if (minButton) {
      minButton.disabled = state.location === 'grid';
      minButton.textContent = state.minimized ? '▱' : '—';
      minButton.title = state.location === 'grid'
        ? '자식 floating 창에서 최소화할 수 있습니다.'
        : state.minimized
          ? '이전 크기'
          : '최소화';
    }

    const maxButton = this.$<HTMLButtonElement>('#cwMax');
    if (maxButton) {
      maxButton.textContent = state.maximized ? '❐' : '□';
      maxButton.title = state.maximized ? '이전 크기' : '최대화';
    }

    const popButton = this.$<HTMLButtonElement>('#cwPop');
    if (popButton) {
      popButton.textContent = state.location === 'popout' ? '↙' : '↗';
      popButton.title = state.location === 'popout'
        ? '자식창으로 복귀'
        : '독립창으로 분리';
    }
  }

  private openOrder(side: TradeSide): void {
    const symbol = this.currentSymbol();
    if (!symbol.code) return;

    const qtyInput = this.$<HTMLInputElement>('#cwQty');
    const qty = Math.max(1, Math.trunc(Number(qtyInput?.value) || 1));
    this.orderQty = String(qty);
    if (qtyInput) qtyInput.value = this.orderQty;

    this.ctx.dock?.open('order', {
      side,
      code: symbol.code,
      name: symbol.name,
      qty,
      symbolLocked: true,
    });
  }

  private toggleMinimize(): void {
    const key = String(this.panelApi?.id ?? '');
    if (!key) return;
    const changed = this.ctx.dock?.toggleMinimize?.(key);
    if (!changed) {
      this.ctx.log.warn(`차트 최소화/이전크기 실패: ${key}`);
      return;
    }
    requestAnimationFrame(() => this.paintWindowActions());
  }

  private toggleMaximize(): void {
    const key = String(this.panelApi?.id ?? '');
    if (!key) return;
    const changed = this.ctx.dock?.toggleMaximize?.(key);
    if (!changed) {
      this.ctx.log.warn(`차트 최대화/이전크기 실패: ${key}`);
      return;
    }
    requestAnimationFrame(() => this.paintWindowActions());
  }

  private async togglePopout(): Promise<void> {
    const key = String(this.panelApi?.id ?? '');
    if (!key) return;
    const changed = await this.ctx.dock?.togglePopout?.(key);
    if (!changed) {
      this.ctx.log.warn(`차트 독립창/자식창 전환 실패: ${key}`);
      return;
    }
    requestAnimationFrame(() => this.paintWindowActions());
  }
}

export default ChartWorkspaceForm;
