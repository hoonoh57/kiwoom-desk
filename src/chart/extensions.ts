import type { OhlcvBar } from './tickAggregation';

export type ChartBar = OhlcvBar;
export type ChartBarChange = 'append' | 'replace';

export interface ChartExtensionContext {
  chart: any;
  lc: any;
  toolbar: HTMLElement;
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

interface RegisteredFactory {
  id: string;
  factory: ChartExtensionFactory;
}

interface ActiveExtension {
  id: string;
  extension: ChartExtension;
  failed: boolean;
}

const factories = new Map<string, ChartExtensionFactory>();

export function registerChartExtension(
  id: string,
  factory: ChartExtensionFactory,
): void {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('Chart extension id is required.');
  factories.set(key, factory);
}

export class ChartExtensionGroup implements ChartExtension {
  private readonly active: ActiveExtension[] = [];

  constructor(
    registered: readonly RegisteredFactory[],
    private readonly context: ChartExtensionContext,
  ) {
    for (const item of registered) {
      try {
        this.active.push({
          id: item.id,
          extension: item.factory(context),
          failed: false,
        });
      } catch (e: any) {
        context.reportError(
          `차트 추가기능 ${item.id} 로드 실패: ${e?.message ?? e}`,
        );
      }
    }
  }

  onBarsReset(bars: readonly ChartBar[]): void {
    for (const item of this.active) {
      if (item.failed) continue;
      try {
        item.extension.onBarsReset(bars);
      } catch (e: any) {
        this.fail(item, e);
      }
    }
  }

  onBarChanged(
    bar: ChartBar,
    change: ChartBarChange,
    bars: readonly ChartBar[],
  ): void {
    for (const item of this.active) {
      if (item.failed) continue;
      try {
        item.extension.onBarChanged(bar, change, bars);
      } catch (e: any) {
        this.fail(item, e);
      }
    }
  }

  dispose(): void {
    for (const item of this.active.splice(0)) {
      try {
        item.extension.dispose();
      } catch {
        // 기본 차트 dispose를 막지 않는다.
      }
    }
  }

  private fail(item: ActiveExtension, error: any): void {
    item.failed = true;
    try {
      item.extension.dispose();
    } catch {
      // 실패한 확장 정리 오류는 기본 차트에 전파하지 않는다.
    }
    this.context.reportError(
      `차트 추가기능 ${item.id} 비활성화: ${error?.message ?? error}`,
    );
  }
}

export function createChartExtensions(
  context: ChartExtensionContext,
): ChartExtensionGroup {
  const registered = Array.from(factories, ([id, factory]) => ({ id, factory }));
  return new ChartExtensionGroup(registered, context);
}
