import type { AppContext } from '../core/context';
import { registerChartSessionStateBridge } from './chartSessionBridge';

registerChartSessionStateBridge();

/**
 * Project runtime seam currently registers only generic runtime/state contracts.
 * Durable project/VD persistence remains a later migration tranche.
 */
export function installProject(_ctx: AppContext): { dispose(): void } {
  return { dispose() {} };
}
