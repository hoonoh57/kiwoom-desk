export type ChartControlMode = 'auto' | 'semi' | 'manual';

export interface ChartTradePositionLike {
  code: string;
  status: string;
}

const STATUS_PRIORITY: Record<string, number> = {
  'broker-error': 50,
  'broker-pending-sell': 40,
  'broker-pending-buy': 30,
  'broker-open': 20,
  'paper-open': 10,
};

const STATUS_LABEL: Record<string, string> = {
  'broker-error': '주문 오류 확인 필요',
  'broker-pending-sell': '매도 주문중',
  'broker-pending-buy': '매수 주문중',
  'broker-open': '보유중',
  'paper-open': 'Paper 보유중',
};

export function plainChartCode(value: unknown): string {
  return String(value ?? '').trim().replace(/^[A-Za-z]+/, '');
}

export function chartTradeLockReason(
  code: unknown,
  positions: readonly ChartTradePositionLike[] = [],
): string {
  const target = plainChartCode(code);
  if (!target) return '';

  const active = positions
    .filter(position => plainChartCode(position?.code) === target)
    .filter(position => Object.prototype.hasOwnProperty.call(STATUS_LABEL, String(position?.status ?? '')))
    .sort((a, b) =>
      (STATUS_PRIORITY[String(b.status)] ?? 0) - (STATUS_PRIORITY[String(a.status)] ?? 0));

  const status = String(active[0]?.status ?? '');
  return STATUS_LABEL[status] ?? '';
}

export function chartForcedLockReason(
  mode: ChartControlMode,
  code: unknown,
  positions: readonly ChartTradePositionLike[] = [],
): string {
  const trade = chartTradeLockReason(code, positions);
  if (trade) return trade;
  return mode === 'auto' ? 'AUTO 종목 고정' : '';
}

export function canApplyLinkedSymbol(
  userLocked: boolean,
  mode: ChartControlMode,
  code: unknown,
  positions: readonly ChartTradePositionLike[] = [],
): boolean {
  return !userLocked && chartForcedLockReason(mode, code, positions) === '';
}
