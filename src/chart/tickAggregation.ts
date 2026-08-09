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

/**
 * 1틱 원본의 최신 구간과 현재 표시 봉의 OHLCV를 맞춰
 * 현재 봉 안에 이미 포함된 실제 체결 개수를 추론한다.
 *
 * 동일 초에 여러 체결이 있어도 timestamp가 아니라 OHLCV 전체를
 * 비교하므로 단순 시간 비교보다 안정적이다. 반환값 0은 현재 봉이
 * 정확히 scope개 체결로 완료돼 다음 체결이 새 봉을 시작해야 함을 뜻한다.
 */
export function inferTickProgress<T extends OhlcvBar>(
  oneTickBars: readonly T[],
  target: OhlcvBar,
  scope: string | number,
): number | null {
  const maxTicks = Math.max(1, Math.trunc(Number(scope) || 1));
  if (!oneTickBars.length) return null;

  const ticks = oneTickBars.slice(-maxTicks);
  const newest = ticks[ticks.length - 1];
  if (!sameNumber(newest.close, target.close)) return null;

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;

  for (let count = 1; count <= ticks.length; count++) {
    const bar = ticks[ticks.length - count];
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    volume += bar.volume;

    if (
      sameNumber(bar.open, target.open)
      && sameNumber(newest.close, target.close)
      && sameNumber(high, target.high)
      && sameNumber(low, target.low)
      && sameNumber(volume, target.volume)
    ) {
      return count % maxTicks;
    }
  }

  return null;
}

function sameNumber(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
}

function sessionKey(time: any): string {
  if (typeof time === 'number' && Number.isFinite(time)) {
    return new Date(Math.trunc(time) * 1000).toISOString().slice(0, 10);
  }
  return String(time ?? '').slice(0, 10);
}
