export interface OhlcvBar {
  time: any;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const TICK_SOURCE_SCOPE = 30;

export const NATIVE_TICK_SCOPES = [1, 3, 5, 10, 30, 60, 120] as const;
export const SYNTHETIC_TICK_SCOPES = [240, 360, 480, 540, 720] as const;

export const CHART_TICK_SCOPES = [
  ...NATIVE_TICK_SCOPES.map(v => ({ v: String(v), t: `${v}틱` })),
  ...SYNTHETIC_TICK_SCOPES.map(v => ({ v: String(v), t: `${v}틱` })),
];

export function isSyntheticTickScope(scope: string | number): boolean {
  const n = Number(scope);
  return (SYNTHETIC_TICK_SCOPES as readonly number[]).includes(n);
}

export function requestTickScope(scope: string | number): string {
  return isSyntheticTickScope(scope) ? String(TICK_SOURCE_SCOPE) : String(scope);
}

export function syntheticTickFactor(scope: string | number): number {
  const n = Number(scope);
  if (!isSyntheticTickScope(n) || n % TICK_SOURCE_SCOPE !== 0) {
    throw new Error(`Unsupported synthetic tick scope: ${scope}`);
  }
  return n / TICK_SOURCE_SCOPE;
}

/**
 * 30틱 원본봉을 사용자 틱봉으로 조립한다.
 *
 * 입력은 시간 오름차순이어야 한다. 거래일을 넘겨 봉을 합치지 않으며,
 * 각 거래일 안에서는 최신 쪽을 기준으로 N개씩 묶는다. 이렇게 하면
 * 연속조회로 더 오래된 30틱 봉을 앞에 추가해도 이미 표시 중인 최신
 * 합성봉의 경계가 바뀌지 않는다.
 */
export function aggregateSyntheticTickBars<T extends OhlcvBar>(
  source: readonly T[],
  scope: string | number,
): T[] {
  if (!source.length) return [];

  const factor = syntheticTickFactor(scope);
  const out: T[] = [];

  let start = 0;
  while (start < source.length) {
    const day = sessionKey(source[start].time);
    let end = start + 1;
    while (end < source.length && sessionKey(source[end].time) === day) end++;

    const dayBars = source.slice(start, end);
    const aggregated: T[] = [];

    for (let right = dayBars.length; right > 0; right -= factor) {
      const left = Math.max(0, right - factor);
      const chunk = dayBars.slice(left, right);
      const first = chunk[0];
      const last = chunk[chunk.length - 1];

      let high = first.high;
      let low = first.low;
      let volume = 0;
      for (const bar of chunk) {
        high = Math.max(high, bar.high);
        low = Math.min(low, bar.low);
        volume += bar.volume;
      }

      aggregated.unshift({
        ...first,
        time: last.time,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
      } as T);
    }

    out.push(...aggregated);
    start = end;
  }

  return out;
}

function sessionKey(time: any): string {
  if (typeof time === 'number' && Number.isFinite(time)) {
    return new Date(Math.trunc(time) * 1000).toISOString().slice(0, 10);
  }
  return String(time ?? '').slice(0, 10);
}
