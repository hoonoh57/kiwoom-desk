export type ChartRuntimeDiagnosticKind =
  | 'bars.reset'
  | 'bar.append'
  | 'bar.replace'
  | 'series.setData'
  | 'series.update'
  | 'indicator.reset'
  | 'indicator.update';

export type ChartRuntimeDiagnosticSource = 'base' | 'indicator';

export interface ChartRuntimeDiagnosticEvent {
  chartId: string;
  source: ChartRuntimeDiagnosticSource;
  kind: ChartRuntimeDiagnosticKind;
  target: string;
  points?: number;
  change?: 'append' | 'replace';
  indicatorId?: string;
  instanceId?: string;
  outputId?: string;
  at?: number;
}

export type ChartRuntimeDiagnosticListener = (
  event: Readonly<ChartRuntimeDiagnosticEvent>,
) => void;

const listeners = new Set<ChartRuntimeDiagnosticListener>();

export function emitChartRuntimeDiagnostic(
  event: ChartRuntimeDiagnosticEvent,
): void {
  if (!listeners.size) return;
  const snapshot: Readonly<ChartRuntimeDiagnosticEvent> = Object.freeze({
    ...event,
    at: event.at ?? Date.now(),
  });
  for (const listener of Array.from(listeners)) {
    try {
      listener(snapshot);
    } catch {
      // 진단 수신자의 실패가 차트 렌더링 경로를 방해하지 않게 한다.
    }
  }
}

export function subscribeChartRuntimeDiagnostics(
  listener: ChartRuntimeDiagnosticListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function chartRuntimeDiagnosticListenerCount(): number {
  return listeners.size;
}
