import type { AppContext } from '../../src/core/context';
import { registerChartExtension } from '../../src/chart/extensions';
import { StrategyHost } from './StrategyHost';
import { installStrategyExecutionRuntime, type StrategyExecutionRuntime } from './execution';
import './strategy.css';

let installed = false;
let runtime: StrategyExecutionRuntime | undefined;

/**
 * Workbench가 차트를 만들기 전에 한 번 호출한다.
 * 이 import/호출을 제거하면 전략 add-on과 주문 실행기가 모두 빠진다.
 */
export function installChartStrategyAddon(ctx: AppContext): StrategyExecutionRuntime {
  if (!installed) {
    registerChartExtension('strategies', chartContext => new StrategyHost(chartContext, ctx));
    installed = true;
  }
  runtime ??= installStrategyExecutionRuntime(ctx);
  return runtime;
}
