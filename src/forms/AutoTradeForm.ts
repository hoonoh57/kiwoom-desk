import { ChildForm } from './ChildForm';
import {
  Topics,
  type StrategyPortfolioSnapshot,
  type StrategyPositionSnapshot,
} from '../core/events';
import './AutoTradeForm.css';

interface StrategySignalEvent {
  source?: string;
  strategyId?: string;
  strategyInstanceId?: string;
  code?: string;
  signal?: {
    time?: unknown;
    type?: string;
    price?: number;
    reason?: string;
  };
}

interface RecentSignal {
  at: number;
  strategyId: string;
  strategyInstanceId: string;
  code: string;
  type: string;
  price: number;
  reason: string;
}

export class AutoTradeForm extends ChildForm {
  private portfolio: StrategyPortfolioSnapshot = { brokerArmed: false, positions: [] };
  private runtimeSeen = false;
  private recentSignals: RecentSignal[] = [];

  protected onInit(): void {
    this.setTitle('자동매매 관제');
    this.render();

    this.track(this.ctx.bus.on<StrategyPortfolioSnapshot>(Topics.StrategyPortfolioChanged, snapshot => {
      this.runtimeSeen = true;
      this.portfolio = snapshot;
      this.render();
    }));

    this.track(this.ctx.bus.on<StrategySignalEvent>(Topics.StrategySignal, event => {
      const signal = event?.signal;
      if (!signal?.type) return;
      this.recentSignals.unshift({
        at: Date.now(),
        strategyId: String(event.strategyId ?? ''),
        strategyInstanceId: String(event.strategyInstanceId ?? ''),
        code: String(event.code ?? ''),
        type: String(signal.type ?? '').toUpperCase(),
        price: Math.abs(Number(signal.price) || 0),
        reason: String(signal.reason ?? ''),
      });
      if (this.recentSignals.length > 100) this.recentSignals.length = 100;
      this.paintSignals();
    }));

    this.requestSnapshot();
  }

  private requestSnapshot(): void {
    this.ctx.bus.emit(Topics.StrategyPortfolioRequest, { source: this.formKey });
  }

  private render(): void {
    const p = this.portfolio;
    const brokerClass = p.brokerArmed ? 'danger' : 'safe';
    const brokerText = p.brokerArmed ? 'BROKER ARMED' : 'BROKER LOCKED';

    this.html(`
      <div class="autotrade-form">
        <div class="autotrade-head">
          <div>
            <div class="autotrade-title">자동매매 중앙 관제</div>
            <div class="autotrade-sub">전략 작성/파라미터 편집은 차트 Strategy Add-on에서 수행합니다. 이 화면은 실행 상태와 안전 잠금만 관리합니다.</div>
          </div>
          <span class="tr-flex"></span>
          <span class="autotrade-runtime ${this.runtimeSeen ? 'ok' : 'off'}">${this.runtimeSeen ? 'RUNTIME ONLINE' : 'RUNTIME WAIT'}</span>
        </div>

        <div class="autotrade-toolbar">
          <span class="autotrade-broker ${brokerClass}">${brokerText}</span>
          <button class="btn ${p.brokerArmed ? '' : 'primary'}" id="atBroker" ${this.runtimeSeen ? '' : 'disabled'}>
            ${p.brokerArmed ? '브로커 잠금' : '브로커 ARM'}
          </button>
          <button class="btn" id="atAccount">계좌현황</button>
          <button class="btn" id="atRefresh">상태 새로고침</button>
        </div>

        <div class="autotrade-note">
          BROKER ARM은 현재 브라우저 세션에서만 유효하며 앱 재시작 시 항상 LOCKED입니다. 이 관제판은 주문 API를 직접 호출하지 않습니다.
        </div>

        <div class="autotrade-section">
          <div class="tr-sub2">전략 포지션 / 주문 · ${(p.positions ?? []).length}건</div>
          <div id="atPositions"></div>
        </div>

        <div class="autotrade-section signals">
          <div class="tr-sub2">최근 전략 신호 · <span id="atSignalCount">${this.recentSignals.length}</span>건
            <span class="tr-flex"></span><button class="lnk" id="atClearSignals">지우기</button>
          </div>
          <div id="atSignals"></div>
        </div>

        <div id="atError"></div>
      </div>`);

    this.$('#atBroker')?.addEventListener('click', () => this.toggleBroker());
    this.$('#atRefresh')?.addEventListener('click', () => this.requestSnapshot());
    this.$('#atAccount')?.addEventListener('click', () => this.ctx.dock?.open('account', { tab: 'balance' }, {}));
    this.$('#atClearSignals')?.addEventListener('click', () => {
      this.recentSignals = [];
      this.paintSignals();
    });

    this.paintPositions();
    this.paintSignals();
    this.paintError();
  }

  private toggleBroker(): void {
    if (!this.runtimeSeen) return;
    if (this.portfolio.brokerArmed) {
      this.ctx.bus.emit(Topics.StrategyBrokerArm, {
        source: this.formKey,
        armed: false,
        confirmed: true,
      });
      return;
    }

    const mode = this.ctx.state.mode;
    const ok = confirm(
      `전략 브로커 주문 잠금 해제\n\n현재 API 모드: ${mode}\n\n`
      + 'broker 실행모드 전략의 확정 BUY/SELL 신호가 실제 주문 실행기로 전달됩니다.\n'
      + '이 잠금은 앱을 다시 시작하면 자동으로 잠깁니다.\n\n계속할까요?',
    );
    if (!ok) return;
    this.ctx.bus.emit(Topics.StrategyBrokerArm, {
      source: this.formKey,
      armed: true,
      confirmed: true,
    });
  }

  private paintPositions(): void {
    const host = this.$('#atPositions');
    if (!host) return;
    const positions = this.portfolio.positions ?? [];
    if (!positions.length) {
      host.innerHTML = `<div class="tr-empty">현재 PAPER/BROKER 포지션 또는 주문이 없습니다. signal 모드는 아래 최근 신호에서 확인합니다.</div>`;
      return;
    }

    host.innerHTML = `<div class="grid-wrap"><table class="grid autotrade-grid">
      <thead><tr><th>실행</th><th>상태</th><th>전략</th><th>종목</th><th>수량</th><th>진입가</th><th>현재가</th><th>손익%</th><th>주문번호</th><th>갱신</th></tr></thead>
      <tbody>${positions.map(p => this.positionRow(p)).join('')}</tbody>
    </table></div>`;
  }

  private positionRow(p: StrategyPositionSnapshot): string {
    const pnlClass = p.pnlPct > 0 ? 'up' : p.pnlPct < 0 ? 'dn' : '';
    return `<tr>
      <td>${this.esc(p.executionMode.toUpperCase())}</td>
      <td>${this.esc(this.statusLabel(p.status))}</td>
      <td class="left" title="${this.esc(p.strategyInstanceId)}">${this.esc(p.strategyLabel)}</td>
      <td>${this.esc(p.code)}${p.name ? `<br><small>${this.esc(p.name)}</small>` : ''}</td>
      <td>${this.fmt(p.filledQty ?? p.qty)} / ${this.fmt(p.qty)}</td>
      <td>${this.fmt(Math.round(p.entryPrice))}</td>
      <td>${this.fmt(Math.round(p.currentPrice))}</td>
      <td class="${pnlClass}">${Number(p.pnlPct).toFixed(2)}</td>
      <td>${this.esc(p.orderNo ?? '')}</td>
      <td>${this.esc(this.timeLabel(p.updatedAt))}</td>
    </tr>`;
  }

  private paintSignals(): void {
    const count = this.$('#atSignalCount');
    if (count) count.textContent = String(this.recentSignals.length);

    const host = this.$('#atSignals');
    if (!host) return;
    if (!this.recentSignals.length) {
      host.innerHTML = `<div class="tr-empty">현재 세션에서 수신한 전략 신호가 없습니다. 과거 차트 marker는 이 목록에 재생하지 않습니다.</div>`;
      return;
    }

    host.innerHTML = `<div class="grid-wrap"><table class="grid autotrade-grid">
      <thead><tr><th>수신</th><th>신호</th><th>전략</th><th>종목</th><th>가격</th><th>사유</th></tr></thead>
      <tbody>${this.recentSignals.map(s => `<tr>
        <td>${this.esc(this.timeLabel(s.at))}</td>
        <td class="${s.type === 'BUY' ? 'up' : s.type === 'SELL' || s.type === 'FAIL' ? 'dn' : ''}">${this.esc(s.type)}</td>
        <td class="left" title="${this.esc(s.strategyInstanceId)}">${this.esc(s.strategyId || s.strategyInstanceId)}</td>
        <td>${this.esc(s.code)}</td>
        <td>${s.price ? this.fmt(Math.round(s.price)) : ''}</td>
        <td class="left">${this.esc(s.reason)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }

  private paintError(): void {
    const host = this.$('#atError');
    if (!host) return;
    host.innerHTML = this.portfolio.lastError
      ? `<div class="err autotrade-error">${this.esc(this.portfolio.lastError)}</div>`
      : '';
  }

  private statusLabel(status: StrategyPositionSnapshot['status']): string {
    return ({
      'paper-open': 'PAPER OPEN',
      'broker-pending-buy': 'BUY PENDING',
      'broker-open': 'BROKER OPEN',
      'broker-pending-sell': 'SELL PENDING',
      'broker-error': 'ERROR',
    } as Record<string, string>)[status] ?? status;
  }

  private timeLabel(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '';
    return new Date(value).toLocaleTimeString('ko-KR', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
}

export default AutoTradeForm;
