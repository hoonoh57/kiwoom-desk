import {
  registerChartPlugin,
  type ChartRuntimeBar,
  type ChartRuntimeBarChange,
  type ChartRuntimePlugin,
  type ChartRuntimeSurface,
} from '../../src/chart/runtimeHost';
import { IndicatorHost } from './IndicatorHost';
import './indicator.css';

registerChartPlugin('indicators', runtime => {
  let surface: ChartRuntimeSurface | undefined;
  let host: IndicatorHost | undefined;
  let currentBars: readonly ChartRuntimeBar[] = [];
  let visualVisible = true;

  const disposeHost = (): void => {
    const current = host;
    host = undefined;
    current?.dispose();
  };

  const attachHost = (): void => {
    if (!surface || !visualVisible || host) return;
    host = new IndicatorHost({
      chart: surface.chart,
      lc: surface.lc,
      toolbar: surface.toolbar,
      primarySeries: surface.primarySeries,
      firstAddonPane: surface.firstAddonPane,
      reportError: runtime.reportError,
    });
    if (currentBars.length) host.onBarsReset(currentBars);
  };

  const visualRegistration = runtime.visuals.register('indicators', {
    setVisible(visible) {
      visualVisible = visible;
      if (!visible) {
        disposeHost();
        return;
      }
      attachHost();
    },
  });

  return {
    onChartReady(next) {
      disposeHost();
      surface = next;
      attachHost();
    },
    onChartDetached() {
      disposeHost();
      surface = undefined;
    },
    onBarsReset(bars) {
      currentBars = bars;
      host?.onBarsReset(bars);
    },
    onBarChanged(
      bar: ChartRuntimeBar,
      change: ChartRuntimeBarChange,
      bars: readonly ChartRuntimeBar[],
    ) {
      currentBars = bars;
      host?.onBarChanged(bar, change, bars);
    },
    dispose() {
      visualRegistration.dispose();
      disposeHost();
      surface = undefined;
      currentBars = [];
    },
  } satisfies ChartRuntimePlugin;
});
