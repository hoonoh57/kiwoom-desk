import type { AppContext } from '../../src/core/context';
import {
  Topics,
  type StrategyPortfolioSnapshot,
  type StrategyPositionSnapshot,
  type StrategyTradeIntentPayload,
} from '../../src/core/events';

const SESSION_KEY = 'kiwoom-desk.strategy.positions.v1';
const NO_PRICE_ORDER_TYPES = new Set(['3', '13', '23', '61', '81']);

interface ArmPayload { source?: string; armed: boolean; confirmed?: boolean; }

export class StrategyExecutionRuntime {
  private readonly source = 'strategy-execution-runtime';
  private readonly positions = new Map<string, StrategyPositionSnapshot>();
  private readonly inFlight = new Set<string>();
  private readonly offs: Array<() => void> = [];
  private brokerArmed = false;
  private lastError = '';
  private publishFrame?: number;

  constructor(private readonly ctx: AppContext) {
    this.restoreSession();
    this.offs.push(
      ctx.bus.on<StrategyTradeIntentPayload>(Topics.StrategyTradeIntent, p => void this.onIntent(p)),
      ctx.bus.on(Topics.StrategyPortfolioRequest, () => this.publish()),
      ctx.bus.on<ArmPayload>(Topics.StrategyBrokerArm, p => this.onBrokerArm(p)),
      ctx.bus.on(Topics.RealtimeTick, p => this.onRealtime(p)),
    );
    this.publish();
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    if (this.publishFrame !== undefined) cancelAnimationFrame(this.publishFrame);
    this.inFlight.clear();
    this.brokerArmed = false;
  }

  private keyOf(intent: Pick<StrategyTradeIntentPayload, 'strategyInstanceId' | 'code'>): string {
    return `${intent.strategyInstanceId}:${plainCode(intent.code)}`;
  }

  private async onIntent(intent: StrategyTradeIntentPayload): Promise<void> {
    if (!intent?.strategyInstanceId || !intent?.code) return;
    if (intent.executionMode === 'signal') return;

    const normalized: StrategyTradeIntentPayload = {
      ...intent,
      code: plainCode(intent.code),
      qty: Math.max(1, Math.trunc(Number(intent.qty) || 1)),
      referencePrice: Math.abs(Number(intent.referencePrice) || 0),
    };

    if (normalized.executionMode === 'paper') {
      this.executePaper(normalized);
      return;
    }

    await this.executeBroker(normalized);
  }

  private executePaper(intent: StrategyTradeIntentPayload): void {
    const key = this.keyOf(intent);
    const existing = this.positions.get(key);

    if (intent.side === 'buy') {
      if (existing && existing.status !== 'broker-error') return;
      const price = intent.referencePrice;
      this.positions.set(key, {
        key,
        strategyId: intent.strategyId,
        strategyInstanceId: intent.strategyInstanceId,
        strategyLabel: intent.strategyLabel,
        code: intent.code,
        name: intent.name,
        executionMode: 'paper',
        status: 'paper-open',
        qty: intent.qty,
        filledQty: intent.qty,
        entryPrice: price,
        currentPrice: price,
        pnlPct: 0,
        reason: intent.reason,
        updatedAt: Date.now(),
      });
      this.ctx.log.info(`[전략/PAPER] BUY ${intent.code} ${intent.qty}주 @${price} · ${intent.strategyLabel}`);
      this.changed();
      return;
    }

    if (!existing || existing.executionMode !== 'paper' || existing.status !== 'paper-open') return;
    this.ctx.log.info(
      `[전략/PAPER] SELL ${intent.code} ${existing.qty}주 @${intent.referencePrice}`
      + ` · 손익=${existing.pnlPct.toFixed(2)}% · ${intent.strategyLabel}`,
    );
    this.positions.delete(key);
    this.changed();
  }

  private async executeBroker(intent: StrategyTradeIntentPayload): Promise<void> {
    const key = this.keyOf(intent);
    const existing = this.positions.get(key);

    if (!this.brokerArmed) {
      this.reject(`브로커 주문 잠금 상태: ${intent.strategyLabel} ${intent.side.toUpperCase()} ${intent.code}`);
      return;
    }
    if (this.ctx.state.mode === '미접속') {
      this.reject('브로커 주문 실패: API 투자모드가 연결되지 않았습니다.');
      return;
    }

    if (intent.side === 'buy') {
      if (existing && existing.status !== 'broker-error') return;
    } else if (!existing || existing.executionMode !== 'broker' || existing.status !== 'broker-open') {
      this.reject(`브로커 매도 차단: 전략 보유상태가 OPEN이 아닙니다 (${intent.code}).`);
      return;
    }

    const actionKey = `${key}:${intent.side}`;
    if (this.inFlight.has(actionKey)) {
      this.ctx.log.warn(`전략 중복 주문 차단(in-flight): ${actionKey}`);
      return;
    }
    this.inFlight.add(actionKey);

    const side = intent.side;
    const qty = side === 'sell' && existing ? Math.min(existing.qty, intent.qty) : intent.qty;
    const apiId = side === 'buy' ? 'kt10000' : 'kt10001';
    const mockMode = String(this.ctx.state.mode).includes('모의');
    const exchange = mockMode ? 'KRX' : intent.exchange;
    if (mockMode && intent.exchange !== 'KRX') {
      this.ctx.log.info(`전략 모의투자 거래소 정규화: ${intent.exchange} → KRX (${intent.code})`);
    }
    const orderType = NO_PRICE_ORDER_TYPES.has(intent.orderType) ? intent.orderType : '3';
    if (orderType !== intent.orderType) {
      this.ctx.log.warn(`전략 주문유형 정규화: ${intent.orderType} → 3(시장가) · 주문단가 없는 전략 v1`);
    }
    const body: Record<string, string> = {
      dmst_stex_tp: exchange,
      stk_cd: intent.code,
      ord_qty: String(qty),
      trde_tp: orderType,
    };

    try {
      const res = await this.ctx.api.call(apiId, '/api/dostk/ordr', body, {});
      const d: any = res.body ?? {};
      const rc = res.returnCode ?? d.return_code;
      if (Number(rc) !== 0) {
        this.reject(`전략 주문 실패 rc=${rc ?? '-'} ${res.returnMsg ?? d.return_msg ?? ''}`);
        if (existing) {
          existing.status = 'broker-error';
          existing.reason = String(res.returnMsg ?? d.return_msg ?? '주문 실패');
          existing.updatedAt = Date.now();
          this.changed();
        }
        return;
      }

      const orderNo = String(d.ord_no ?? '').trim();
      const base: StrategyPositionSnapshot = existing ? { ...existing } : {
        key,
        strategyId: intent.strategyId,
        strategyInstanceId: intent.strategyInstanceId,
        strategyLabel: intent.strategyLabel,
        code: intent.code,
        name: intent.name,
        executionMode: 'broker',
        status: 'broker-pending-buy',
        qty,
        filledQty: 0,
        entryPrice: intent.referencePrice,
        currentPrice: intent.referencePrice,
        pnlPct: 0,
        updatedAt: Date.now(),
      };
      base.status = side === 'buy' ? 'broker-pending-buy' : 'broker-pending-sell';
      base.orderNo = orderNo;
      base.reason = intent.reason;
      base.updatedAt = Date.now();
      this.positions.set(key, base);
      this.ctx.log.info(
        `[전략/${this.ctx.state.mode}] ${side.toUpperCase()} 주문접수 ${intent.code} ${qty}주 · ${exchange} · ord=${orderNo || '-'} · ${intent.strategyLabel}`,
      );
      this.changed();

      if (orderNo) void this.reconcileFill(intent, qty, orderNo, side, 0);
    } catch (e: any) {
      this.reject(`전략 주문 예외: ${e?.message ?? e}`);
    } finally {
      this.inFlight.delete(actionKey);
    }
  }

  private async reconcileFill(
    intent: StrategyTradeIntentPayload,
    requestedQty: number,
    orderNo: string,
    side: 'buy' | 'sell',
    attempt: number,
  ): Promise<void> {
    if (attempt >= 8) return;
    await delay(attempt === 0 ? 1200 : 2000);

    const key = this.keyOf(intent);
    const current = this.positions.get(key);
    if (!current || current.orderNo !== orderNo) return;

    try {
      const res = await this.ctx.api.call('ka10076', '/api/dostk/acnt', {
        qry_tp: '0', sell_tp: '0', stex_tp: '0',
      }, {});
      const d: any = res.body ?? {};
      const rows: any[] = Array.isArray(d.cntr) ? d.cntr : [];
      const fills = rows.filter(row => String(row?.ord_no ?? '').trim() === orderNo);
      let filledQty = 0;
      let amount = 0;
      for (const row of fills) {
        const q = Math.abs(Number(row?.cntr_qty) || 0);
        const p = Math.abs(Number(row?.cntr_pric) || 0);
        filledQty += q;
        amount += q * p;
      }

      if (filledQty > 0) {
        current.filledQty = filledQty;
        const fillPrice = amount > 0 ? amount / filledQty : intent.referencePrice;
        if (side === 'buy') {
          current.entryPrice = fillPrice;
          current.currentPrice = current.currentPrice || fillPrice;
          current.pnlPct = pnl(current.entryPrice, current.currentPrice);
        }
        current.updatedAt = Date.now();
        this.changed();
      }

      if (filledQty >= requestedQty) {
        if (side === 'buy') {
          current.status = 'broker-open';
          current.qty = requestedQty;
          current.filledQty = requestedQty;
          current.orderNo = undefined;
          current.updatedAt = Date.now();
          this.ctx.log.info(`[전략] BUY 체결확인 ${intent.code} ${requestedQty}주 @${current.entryPrice}`);
          this.changed();
        } else {
          this.ctx.log.info(`[전략] SELL 체결확인 ${intent.code} ${requestedQty}주`);
          this.positions.delete(key);
          this.changed();
        }
        return;
      }
    } catch (e: any) {
      this.ctx.log.warn(`[전략] 체결확인 재시도 ${orderNo}: ${e?.message ?? e}`);
    }

    void this.reconcileFill(intent, requestedQty, orderNo, side, attempt + 1);
  }

  private onBrokerArm(payload: ArmPayload): void {
    const next = payload?.armed === true && payload?.confirmed === true;
    this.brokerArmed = next;
    this.ctx.log.warn(`전략 브로커 주문 ${next ? 'ARMED' : 'LOCKED'} · 앱 재시작 시 항상 LOCKED`);
    this.ctx.bus.emit(Topics.StrategyBrokerState, {
      source: this.source,
      armed: this.brokerArmed,
      mode: this.ctx.state.mode,
    });
    this.publish();
  }

  private onRealtime(payload: any): void {
    if (String(payload?.type ?? '') !== '0B') return;
    const values = payload?.values ?? {};
    const code = plainCode(payload?.item ?? values['9001'] ?? '');
    const price = Math.abs(Number(String(values['10'] ?? '').replace(/,/g, '')) || 0);
    if (!code || !price) return;

    let changed = false;
    for (const position of this.positions.values()) {
      if (position.code !== code) continue;
      if (position.currentPrice === price) continue;
      position.currentPrice = price;
      position.pnlPct = pnl(position.entryPrice, price);
      position.updatedAt = Date.now();
      changed = true;
    }
    if (changed) this.schedulePublish();
  }

  private reject(message: string): void {
    this.lastError = message;
    this.ctx.log.warn(message);
    this.publish();
  }

  private changed(): void {
    this.persistSession();
    this.publish();
  }

  private schedulePublish(): void {
    if (this.publishFrame !== undefined) return;
    this.publishFrame = requestAnimationFrame(() => {
      this.publishFrame = undefined;
      this.persistSession();
      this.publish();
    });
  }

  private publish(): void {
    const snapshot: StrategyPortfolioSnapshot = {
      source: this.source,
      brokerArmed: this.brokerArmed,
      positions: Array.from(this.positions.values())
        .map(x => ({ ...x }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      lastError: this.lastError || undefined,
    };
    this.ctx.bus.emit(Topics.StrategyPortfolioChanged, snapshot);
  }

  private persistSession(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(this.positions.values())));
    } catch {
      // 세션 저장 실패는 주문/차트 동작을 막지 않는다.
    }
  }

  private restoreSession(): void {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '[]');
      if (!Array.isArray(raw)) return;
      for (const item of raw) {
        if (!item?.key || !item?.strategyInstanceId || !item?.code) continue;
        this.positions.set(String(item.key), item as StrategyPositionSnapshot);
      }
    } catch {
      // 손상된 세션 상태는 빈 상태로 시작한다.
    }
  }
}

export function installStrategyExecutionRuntime(ctx: AppContext): StrategyExecutionRuntime {
  return new StrategyExecutionRuntime(ctx);
}

function plainCode(value: unknown): string {
  return String(value ?? '').trim().replace(/^[A-Za-z]+/, '');
}

function pnl(entry: number, current: number): number {
  return entry > 0 ? (current / entry - 1) * 100 : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
