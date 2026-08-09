export interface OhlcvBar {
  time: any;
  /** 공급자 원본에서 보존한 거래 세션 날짜(YYYY-MM-DD). VWAP 세션 reset에 사용한다. */
  tradingDate?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TickProgressMatch<T extends OhlcvBar> {
  /** target 봉 자체에 이미 포함돼 있던 체결 개수. 0이면 target은 완료 봉이다. */
  progress: number;
  /** target snapshot 이후 1틱 snapshot에 추가로 잡힌 체결들. */
  catchup: T[];
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
    const day = sessionKey(source[start]);
    let end = start + 1;
    while (end < source.length && sessionKey(source[end]) === day) end++;

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
        tradingDate: last.tradingDate ?? first.tradingDate,
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
 * 1틱 원본에서 target과 OHLCV가 정확히 일치하는 가장 최신 연속 구간을 찾는다.
 *
 * target을 받은 뒤 1틱 동기화 요청이 끝날 때까지 새 체결이 생길 수 있으므로
 * 반드시 배열의 마지막 suffix만 비교하지 않는다. target과 맞는 구간 뒤에
 * 생긴 체결은 catchup으로 돌려주어 조회 snapshot 사이의 공백을 메운다.
 * 동일 초 다중체결도 timestamp가 아니라 OHLCV 전체로 경계를 판별한다.
 */
export function reconcileTickProgress<T extends OhlcvBar>(
  oneTickBars: readonly T[],
  target: OhlcvBar,
  scope: string | number,
): TickProgressMatch<T> | null {
  const maxTicks = Math.max(1, Math.trunc(Number(scope) || 1));
  if (!oneTickBars.length) return null;

  for (let end = oneTickBars.length - 1; end >= 0; end--) {
    const close = oneTickBars[end].close;
    if (!sameNumber(close, target.close)) continue;

    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    let volume = 0;
    const firstIndex = Math.max(0, end - maxTicks + 1);

    for (let start = end; start >= firstIndex; start--) {
      const bar = oneTickBars[start];
      high = Math.max(high, bar.high);
      low = Math.min(low, bar.low);
      volume += bar.volume;
      const count = end - start + 1;

      if (
        sameNumber(bar.open, target.open)
        && sameNumber(close, target.close)
        && sameNumber(high, target.high)
        && sameNumber(low, target.low)
        && sameNumber(volume, target.volume)
      ) {
        return {
          progress: count % maxTicks,
          catchup: oneTickBars.slice(end + 1),
        };
      }
    }
  }

  return null;
}

function sameNumber(a: number, b: number): boolean {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
}

function sessionKey(bar: OhlcvBar): string {
  const explicit = String(bar.tradingDate ?? '').trim();
  if (explicit) return explicit;

  const time = bar.time;
  if (typeof time === 'number' && Number.isFinite(time)) {
    return new Date(Math.trunc(time) * 1000).toISOString().slice(0, 10);
  }
  return String(time ?? '').slice(0, 10);
}
