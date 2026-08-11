import {
  Topics,
  type StrategyTradeIntentPayload,
} from '../../src/core/events';

type ChartControlMode = 'auto' | 'semi' | 'manual';

const PATCH_MARK = Symbol.for('kiwoom-desk.strategy-host-control-mode.v1');

/**
 * StrategyHost의 계산/marker/config 코드는 그대로 두고 최종 주문 dispatch 지점만
 * 차트 Workspace의 AUTO/반자동/수동 상태로 게이트한다.
 *
 * TypeScript private 메서드는 런타임에서는 prototype 메서드이므로 이 add-on 내부에서
 * 한 번만 교체할 수 있다. 전략 add-on 폴더를 제거하면 이 정책도 함께 제거된다.
 */
export function installStrategyHostControlModePatch(StrategyHostCtor: any): void {
  const prototype = StrategyHostCtor?.prototype as any;
  if (!prototype || prototype[PATCH_MARK]) return;

  Object.defineProperty(prototype, PATCH_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  prototype.dispatchFinalizedTrades = function dispatchFinalizedTrades(
    runtime: any,
    finalizedTime: any,
  ): void {
    if (runtime?.failed || runtime?.config?.execution?.mode === 'signal') return;

    const mode = chartControlModeOf(this?.context?.toolbar);
    if (mode === 'manual') return;

    const identity = this.identity?.();
    if (!identity?.code) return;

    for (const signal of runtime.signals ?? []) {
      if (String(signal?.time) !== String(finalizedTime)) continue;
      if (signal?.type !== 'buy' && signal?.type !== 'sell') continue;

      const dispatchKey =
        `${runtime.config.instanceId}|${identity.code}|${String(signal.time)}|${signal.type}`;
      if (this.dispatched?.has?.(dispatchKey)) continue;
      this.dispatched?.add?.(dispatchKey);

      if (mode === 'semi') {
        this.app?.bus?.emit?.(Topics.StrategySignal, {
          source: this.hostId,
          strategyId: runtime.plugin.id,
          strategyInstanceId: runtime.config.instanceId,
          strategyLabel: runtime.plugin.label,
          code: identity.code,
          name: identity.name,
          signal,
          phase: 'finalized',
          actionable: true,
          chartPeriod: identity.period,
          chartScope: identity.scope,
        });
        continue;
      }

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
      this.app?.bus?.emit?.(Topics.StrategyTradeIntent, intent);
    }
  };
}

function chartControlModeOf(toolbar: HTMLElement | undefined): ChartControlMode {
  const form = toolbar?.closest?.('.chart-form');
  const raw = String(form?.getAttribute?.('data-control-mode') ?? '').toLowerCase();
  if (raw === 'auto' || raw === 'semi' || raw === 'manual') return raw;
  // Workspace가 없는 구형/독립 ChartForm은 자동주문을 보수적으로 차단한다.
  return 'manual';
}
