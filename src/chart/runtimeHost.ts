import type { OhlcvBar } from './tickAggregation';

export type ChartRuntimeBar = OhlcvBar;
export type ChartRuntimeBarChange = 'append' | 'replace';

/** Stable service ids. Optional plugins use this registry instead of growing ChartForm fields. */
export const ChartRuntimeServiceIds = Object.freeze({
  APP_API: 'app.api',
  APP_DOCK: 'app.dock',
  CHART_PARAMS: 'chart.params',
  CHART_STATE: 'chart.state',
  CHART_VIEWPORT: 'chart.viewport',
  CHART_PROPERTIES: 'chart.properties',
} as const);

export interface ChartRuntimeServiceRegistry {
  get<T = unknown>(id: string): T | undefined;
  provide<T = unknown>(id: string, value: T): { dispose(): void };
}

export interface ChartRuntimeShell {
  root: HTMLElement;
  canvas: HTMLElement;
  toolbar: HTMLElement;
}

export interface ChartRuntimeSurface {
  chart: any;
  lc: any;
  toolbar: HTMLElement;
  /** Canonical primary price series; plugins never infer it from pane ordering. */
  primarySeries?: any;
  firstAddonPane: number;
}

export interface ChartRuntimeContext {
  /** Dynamic symbol accessor; no plugin owns ChartForm symbol state. */
  getSymbol(): string;
  readonly services: ChartRuntimeServiceRegistry;
  getShell(): ChartRuntimeShell | undefined;
  getSurface(): ChartRuntimeSurface | undefined;
  reportError(message: string): void;
}

/**
 * The single normal-chart integration contract.
 *
 * Plugins may be visual add-ons, persistence/runtime adapters, or diagnostics.
 * They all enter through one registry and one lifecycle. Chart Core never receives
 * feature-specific source patches for a new plugin.
 */
export interface ChartRuntimePlugin {
  onShellReady?(shell: ChartRuntimeShell): void;
  onShellDetached?(): void;
  onChartReady?(surface: ChartRuntimeSurface): void;
  onChartDetached?(): void;
  onBeforeBarsReset?(bars: readonly ChartRuntimeBar[]): void;
  onBarsReset?(bars: readonly ChartRuntimeBar[]): void;
  onBarChanged?(
    bar: ChartRuntimeBar,
    change: ChartRuntimeBarChange,
    bars: readonly ChartRuntimeBar[],
  ): void;
  dispose?(): void;
}

export type ChartRuntimePluginFactory = (
  context: ChartRuntimeContext,
) => ChartRuntimePlugin;

interface RegisteredPlugin {
  id: string;
  factory: ChartRuntimePluginFactory;
}

interface ActivePlugin {
  id: string;
  plugin: ChartRuntimePlugin;
  failed: boolean;
}

class ServiceRegistry implements ChartRuntimeServiceRegistry {
  private readonly values = new Map<string, unknown>();

  constructor(initial?: Readonly<Record<string, unknown>>) {
    for (const [id, value] of Object.entries(initial ?? {})) {
      if (value !== undefined) this.values.set(id, value);
    }
  }

  get<T = unknown>(id: string): T | undefined {
    return this.values.get(String(id ?? '').trim()) as T | undefined;
  }

  provide<T = unknown>(id: string, value: T): { dispose(): void } {
    const key = String(id ?? '').trim();
    if (!key) throw new Error('Chart runtime service id is required.');
    if (this.values.has(key)) {
      throw new Error(`Chart runtime service already provided: ${key}`);
    }
    this.values.set(key, value);
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (this.values.get(key) === value) this.values.delete(key);
      },
    };
  }
}

const factories = new Map<string, ChartRuntimePluginFactory>();

/** This is the only end-state plugin registration seam for the normal chart runtime. */
export function registerChartPlugin(
  id: string,
  factory: ChartRuntimePluginFactory,
): void {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('Chart runtime plugin id is required.');
  factories.set(key, factory);
}

export interface ChartRuntimeHostOptions {
  getSymbol(): string;
  initialServices?: Readonly<Record<string, unknown>>;
  reportError(message: string): void;
}

export class ChartRuntimeHost {
  private readonly active: ActivePlugin[] = [];
  private readonly serviceRegistry: ServiceRegistry;
  private shell?: ChartRuntimeShell;
  private surface?: ChartRuntimeSurface;
  private disposed = false;
  private readonly context: ChartRuntimeContext;

  constructor(
    registered: readonly RegisteredPlugin[],
    options: ChartRuntimeHostOptions,
  ) {
    this.serviceRegistry = new ServiceRegistry(options.initialServices);
    this.context = {
      getSymbol: options.getSymbol,
      services: this.serviceRegistry,
      getShell: () => this.shell,
      getSurface: () => this.surface,
      reportError: options.reportError,
    };

    for (const item of registered) {
      try {
        this.active.push({
          id: item.id,
          plugin: item.factory(this.context),
          failed: false,
        });
      } catch (error: any) {
        options.reportError(
          `차트 플러그인 ${item.id} 로드 실패: ${error?.message ?? error}`,
        );
      }
    }
  }

  shellReady(shell: ChartRuntimeShell): void {
    if (this.disposed) return;
    if (this.shell && this.shell !== shell) this.dispatchReverse('onShellDetached');
    this.shell = shell;
    this.dispatch('onShellReady', shell);
  }

  attachSurface(surface: ChartRuntimeSurface): void {
    if (this.disposed) return;
    if (this.surface && this.surface !== surface) this.detachSurface();
    this.surface = surface;
    this.dispatch('onChartReady', surface);
  }

  detachSurface(): void {
    if (!this.surface) return;
    this.dispatchReverse('onChartDetached');
    this.surface = undefined;
  }

  beforeBarsReset(bars: readonly ChartRuntimeBar[]): void {
    this.dispatch('onBeforeBarsReset', bars);
  }

  barsReset(bars: readonly ChartRuntimeBar[]): void {
    this.dispatch('onBarsReset', bars);
  }

  barChanged(
    bar: ChartRuntimeBar,
    change: ChartRuntimeBarChange,
    bars: readonly ChartRuntimeBar[],
  ): void {
    this.dispatch('onBarChanged', bar, change, bars);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachSurface();
    if (this.shell) {
      this.dispatchReverse('onShellDetached');
      this.shell = undefined;
    }
    for (const item of [...this.active].reverse()) {
      try {
        item.plugin.dispose?.();
      } catch {
        // Plugin cleanup must never block base chart disposal.
      }
    }
    this.active.length = 0;
  }

  private dispatch(
    method: keyof ChartRuntimePlugin,
    ...args: unknown[]
  ): void {
    for (const item of this.active) {
      if (item.failed) continue;
      const handler = item.plugin[method];
      if (typeof handler !== 'function') continue;
      try {
        (handler as (...values: unknown[]) => void).apply(item.plugin, args);
      } catch (error: any) {
        this.fail(item, error);
      }
    }
  }

  private dispatchReverse(method: keyof ChartRuntimePlugin): void {
    for (const item of [...this.active].reverse()) {
      if (item.failed) continue;
      const handler = item.plugin[method];
      if (typeof handler !== 'function') continue;
      try {
        (handler as () => void).call(item.plugin);
      } catch (error: any) {
        this.fail(item, error);
      }
    }
  }

  private fail(item: ActivePlugin, error: any): void {
    item.failed = true;
    try {
      item.plugin.dispose?.();
    } catch {
      // Failure cleanup is best-effort; base chart remains authoritative.
    }
    this.context.reportError(
      `차트 플러그인 ${item.id} 비활성화: ${error?.message ?? error}`,
    );
  }
}

export function createChartRuntimeHost(options: ChartRuntimeHostOptions): ChartRuntimeHost {
  const registered = Array.from(factories, ([id, factory]) => ({ id, factory }));
  return new ChartRuntimeHost(registered, options);
}

/** Test-only registry reset. Production code must register plugins during bootstrap. */
export function resetChartRuntimePluginsForTests(): void {
  factories.clear();
}
