import type { OhlcvBar } from './tickAggregation';
import {
  ChartRuntimeHost,
  ChartRuntimeServiceIds,
  createChartRuntimeHost,
  registerChartPlugin,
  resetChartRuntimePluginsForTests,
  type ChartRuntimeContext,
  type ChartRuntimePlugin,
  type ChartRuntimeServiceRegistry,
  type ChartRuntimeShell,
  type ChartRuntimeSurface,
} from './runtimeHost';

export type ChartBar = OhlcvBar;
export type ChartBarChange = 'append' | 'replace';

/**
 * Legacy visual add-on context.
 *
 * This remains only as migration compatibility for existing indicator/strategy/
 * diagnostics add-ons. New chart functionality must use registerChartPlugin and
 * ChartRuntimeContext instead of growing this interface or patching ChartForm.
 */
export interface ChartExtensionContext {
  chart: any;
  lc: any;
  toolbar: HTMLElement;
  /** 기본 가격 series. add-on이 pane 내부 series 순서를 추정하지 않도록 공개한다. */
  primarySeries?: any;
  firstAddonPane: number;
  reportError(message: string): void;
}

export interface ChartExtension {
  onBarsReset(bars: readonly ChartBar[]): void;
  onBarChanged(
    bar: ChartBar,
    change: ChartBarChange,
    bars: readonly ChartBar[],
  ): void;
  dispose(): void;
}

export type ChartExtensionFactory = (
  context: ChartExtensionContext,
) => ChartExtension;

/**
 * Compatibility adapter: existing add-ons still call registerChartExtension, but
 * they now execute inside the ONE canonical ChartRuntimeHost lifecycle.
 *
 * Delete this alias after built-in add-ons migrate to registerChartPlugin.
 */
export function registerChartExtension(
  id: string,
  factory: ChartExtensionFactory,
): void {
  registerChartPlugin(id, runtime => {
    let extension: ChartExtension | undefined;

    const disposeExtension = () => {
      const current = extension;
      extension = undefined;
      if (!current) return;
      current.dispose();
    };

    return {
      onChartReady(surface) {
        disposeExtension();
        extension = factory({
          chart: surface.chart,
          lc: surface.lc,
          toolbar: surface.toolbar,
          primarySeries: surface.primarySeries,
          firstAddonPane: surface.firstAddonPane,
          reportError: runtime.reportError,
        });
      },
      onChartDetached() {
        disposeExtension();
      },
      onBarsReset(bars) {
        extension?.onBarsReset(bars);
      },
      onBarChanged(bar, change, bars) {
        extension?.onBarChanged(bar, change, bars);
      },
      dispose() {
        disposeExtension();
      },
    } satisfies ChartRuntimePlugin;
  });
}

/**
 * Historical type name retained while ChartForm and old tests migrate. It is now
 * the same single runtime host, not a second extension engine.
 */
export { ChartRuntimeHost as ChartExtensionGroup };

/** Historical constructor name retained as a temporary source-compatibility alias. */
export function createChartExtensions(context: ChartExtensionContext): ChartRuntimeHost {
  const host = createChartRuntimeHost({
    getSymbol: () => '',
    reportError: context.reportError,
  });
  host.attachSurface({
    chart: context.chart,
    lc: context.lc,
    toolbar: context.toolbar,
    primarySeries: context.primarySeries,
    firstAddonPane: context.firstAddonPane,
  });
  return host;
}

export {
  ChartRuntimeHost,
  ChartRuntimeServiceIds,
  createChartRuntimeHost,
  registerChartPlugin,
  resetChartRuntimePluginsForTests,
};
export type {
  ChartRuntimeContext,
  ChartRuntimePlugin,
  ChartRuntimeServiceRegistry,
  ChartRuntimeShell,
  ChartRuntimeSurface,
};
