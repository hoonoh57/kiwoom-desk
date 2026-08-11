import type { AppContext } from '../core/context';
import {
  Topics,
  type TradeProtectionItem,
  type TradeProtectionSnapshot,
} from '../core/events';
import { getSpec } from '../api/trSchema';
import { plainChartCode } from '../chart/windowPolicy';

interface OrderAcceptedPayload {
  source?: string;
  code?: string;
}

/**
 * 일반 주문/계좌 잔고를 차트 종목 잠금에 연결하는 중앙 안전 런타임.
 * 전략 포지션은 StrategyExecutionRuntime이 별도로 관리하며 이 클래스는
 * OrderForm과 계좌 API에서 확인되는 미체결/보유 종목만 담당한다.
 */
export class TradeProtectionRuntime {
  private readonly source = 'trade-protection-runtime';
  private readonly items = new Map<string, TradeProtectionItem>();
  private readonly offs: Array<() => void> = [];
  private timer?: number;
  private busy = false;
  private refreshAgain = false;
  private disposed = false;

  constructor(private readonly ctx: AppContext) {
    this.offs.push(
      ctx.bus.on<OrderAcceptedPayload>(Topics.OrderFilled, payload => this.onOrderAccepted(payload)),
      ctx.bus.on(Topics.TradeProtectionRequest, () => void this.refresh()),
      ctx.bus.on(Topics.ConnectionChanged, () => this.scheduleRefresh(300)),
      ctx.bus.on(Topics.WsChanged, (payload: any) => {
        if (payload?.connected) this.scheduleRefresh(300);
      }),
    );
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.items.clear();
  }

  private onOrderAccepted(payload: OrderAcceptedPayload): void {
    const code = plainChartCode(payload?.code);
    if (!code) return;

    this.items.set(code, {
      code,
      reason: 'pending-order',
      label: '주문 접수/확인중',
    });
    this.publish();
    this.scheduleRefresh(700);
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.disposed) return;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, Math.max(0, delayMs));
  }

  private async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.ctx.state.mode === '미접속') {
      this.publish();
      return;
    }
    if (this.busy) {
      this.refreshAgain = true;
      return;
    }

    this.busy = true;
    this.refreshAgain = false;

    const previous = new Map(this.items);
    const next = new Map<string, TradeProtectionItem>();

    try {
      const pendingPromise = this.ctx.api.call(
        'ka10075',
        getSpec('ka10075')?.path ?? '/api/dostk/acnt',
        { all_stk_tp: '0', trde_tp: '0', stex_tp: '0' },
        {},
      );
      const balancePromise = this.ctx.api.call(
        'kt00018',
        getSpec('kt00018')?.path ?? '/api/dostk/acnt',
        { qry_tp: '1', dmst_stex_tp: 'KRX' },
        {},
      );

      const [pendingResult, balanceResult] = await Promise.allSettled([
        pendingPromise,
        balancePromise,
      ]);

      if (pendingResult.status === 'fulfilled') {
        try {
          const data = checkedPayload(pendingResult.value, '미체결');
          const rows = Array.isArray(data?.oso) ? data.oso : [];
          for (const row of rows) {
            const code = plainChartCode(row?.stk_cd ?? row?.code);
            const remain = Math.abs(Number(String(row?.oso_qty ?? '').replace(/,/g, '')) || 0);
            if (!code || remain <= 0) continue;
            next.set(code, {
              code,
              name: String(row?.stk_nm ?? '').trim() || undefined,
              reason: 'pending-order',
              label: '미체결 주문',
            });
          }
        } catch (e: any) {
          preserveReason(previous, next, 'pending-order');
          this.ctx.log.warn(`미체결 종목 보호상태 조회 실패: ${e?.message ?? e}`);
        }
      } else {
        preserveReason(previous, next, 'pending-order');
        this.ctx.log.warn(`미체결 종목 보호상태 조회 실패: ${messageOf(pendingResult.reason)}`);
      }

      if (balanceResult.status === 'fulfilled') {
        try {
          const data = checkedPayload(balanceResult.value, '보유잔고');
          const rows = Array.isArray(data?.acnt_evlt_remn_indv_tot)
            ? data.acnt_evlt_remn_indv_tot
            : [];
          for (const row of rows) {
            const code = plainChartCode(row?.stk_cd ?? row?.code);
            const qty = Math.abs(Number(String(row?.rmnd_qty ?? '').replace(/,/g, '')) || 0);
            if (!code || qty <= 0) continue;
            if (next.has(code)) continue;
            next.set(code, {
              code,
              name: String(row?.stk_nm ?? '').trim() || undefined,
              reason: 'holding',
              label: '계좌 보유중',
            });
          }
        } catch (e: any) {
          preserveReason(previous, next, 'holding');
          this.ctx.log.warn(`보유종목 보호상태 조회 실패: ${e?.message ?? e}`);
        }
      } else {
        preserveReason(previous, next, 'holding');
        this.ctx.log.warn(`보유종목 보호상태 조회 실패: ${messageOf(balanceResult.reason)}`);
      }

      this.items.clear();
      for (const [code, item] of next) this.items.set(code, item);
      this.publish();
    } finally {
      this.busy = false;

      if (this.refreshAgain) {
        this.scheduleRefresh(0);
        return;
      }

      // 미체결은 빠르게, 보유만 있으면 낮은 빈도로 재검증한다.
      const hasPending = Array.from(this.items.values())
        .some(item => item.reason === 'pending-order');
      if (hasPending) this.scheduleRefresh(2_500);
      else if (this.items.size > 0) this.scheduleRefresh(60_000);
    }
  }

  private publish(): void {
    const snapshot: TradeProtectionSnapshot = {
      source: this.source,
      items: Array.from(this.items.values())
        .map(item => ({ ...item }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      refreshedAt: Date.now(),
    };
    this.ctx.bus.emit(Topics.TradeProtectionChanged, snapshot);
  }
}

export function installTradeProtectionRuntime(ctx: AppContext): TradeProtectionRuntime {
  return new TradeProtectionRuntime(ctx);
}

function payloadOf(response: any): any {
  return response?.data ?? response?.body ?? response ?? {};
}

function checkedPayload(response: any, label: string): any {
  const data = payloadOf(response);
  const rawCode = data?.return_code;
  const code = Number(rawCode);
  if (rawCode !== undefined && (!Number.isFinite(code) || code !== 0)) {
    const message = String(data?.return_msg ?? '').trim();
    throw new Error(`${label} rc=${rawCode}${message ? ` · ${message}` : ''}`);
  }
  return data;
}

function preserveReason(
  previous: ReadonlyMap<string, TradeProtectionItem>,
  next: Map<string, TradeProtectionItem>,
  reason: TradeProtectionItem['reason'],
): void {
  for (const [code, item] of previous) {
    if (item.reason !== reason || next.has(code)) continue;
    next.set(code, { ...item });
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown');
}
