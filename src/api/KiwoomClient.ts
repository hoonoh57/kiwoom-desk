import type { Logger } from '../core/logger';

export interface TrResponse<T = any> {
  ok: boolean;
  status: number;
  apiId: string;
  returnCode?: number;
  returnMsg?: string;
  contYn: boolean;
  nextKey?: string;
  body: T;
}

export interface CallOptions {
  contYn?: string;
  nextKey?: string;
  signal?: AbortSignal;
}

export interface KiwoomRateLimitInfo {
  code: 1700;
  flow?: number;
  apiId?: string;
  message: string;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const MAX_RATE_LIMIT_RETRIES = 2;

/** 본문을 항상 안전하게 읽는다. 비JSON이면 원문을 메시지로 보존한다. */
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return { __empty: true, __raw: '' };
  try { return JSON.parse(text); }
  catch { return { __invalid: true, __raw: text.slice(0, 300) }; }
}

/**
 * 키움은 유량 초과를 return_code=1700으로 주는 경우도 있고,
 * return_code=5 + "[1700:허용된 API 요청 개수를 초과...]" 형태로 주기도 한다.
 * UI/개별 TR에서는 이 차이를 알 필요가 없도록 여기서 정규화한다.
 */
export function parseKiwoomRateLimit(
  returnCode: number | undefined,
  returnMsg: unknown,
): KiwoomRateLimitInfo | null {
  const message = String(returnMsg ?? '').trim();
  const has1700 = returnCode === 1700 || /(?:^|\[|\s)1700\s*:/.test(message);
  const hasLimitText = /허용된\s*API\s*요청\s*개수를\s*초과|유량\s*=/.test(message);
  if (!has1700 && !hasLimitText) return null;

  const flowMatch = message.match(/유량\s*=\s*([0-9]+(?:\.[0-9]+)?)/);
  const flow = flowMatch ? Number(flowMatch[1]) : undefined;
  const apiMatch = message.match(/API\s*ID\s*=\s*([A-Za-z0-9_]+)/i);

  return {
    code: 1700,
    flow: Number.isFinite(flow) && (flow ?? 0) > 0 ? flow : undefined,
    apiId: apiMatch?.[1],
    message,
  };
}

/** 서버가 알려 준 초당 허용 건수에 50ms 안전 여유를 둔다. */
export function intervalForKiwoomFlow(flow: number | undefined): number {
  if (!Number.isFinite(flow) || (flow ?? 0) <= 0) return 1200;
  return Math.max(100, Math.ceil(1000 / Number(flow)) + 50);
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableObject(item)]),
  );
}

function requestKey(
  apiId: string,
  path: string,
  body: Record<string, unknown>,
): string {
  return `${apiId}|${path}|${JSON.stringify(stableObject(body))}`;
}

/**
 * 브라우저 → 로컬 프록시(server/index.ts) → 키움 REST.
 * 기본 간격은 보수적으로 직렬화하고, 서버가 1700 메시지로 더 낮은 API별
 * 허용 유량을 알려 주면 그 값을 런타임에 학습해 해당 API 호출 간격을 늘린다.
 */
export class KiwoomClient {
  private queue: Promise<unknown> = Promise.resolve();
  private minIntervalMs = 600;
  private cooldownUntil = 0;
  private readonly apiCooldownUntil = new Map<string, number>();
  private readonly apiMinIntervalMs = new Map<string, number>();
  private readonly apiLastStartedAt = new Map<string, number>();
  private readonly pending = new Map<string, Promise<TrResponse<any>>>();

  constructor(private log: Logger, private base = '/api/kiwoom') {}

  setMode(isMock: boolean): void {
    this.minIntervalMs = isMock ? 600 : 120;
    this.log.info(`기본 유량 설정: ${isMock ? '모의(600ms)' : '실전(120ms)'} · 1700 응답 시 API별 자동 감속`);
  }

  private async waitForSlot(apiId: string): Promise<void> {
    const now = Date.now();
    const apiInterval = this.apiMinIntervalMs.get(apiId) ?? 0;
    const lastStarted = this.apiLastStartedAt.get(apiId) ?? 0;
    const waitUntil = Math.max(
      this.cooldownUntil,
      this.apiCooldownUntil.get(apiId) ?? 0,
      lastStarted + apiInterval,
    );
    const wait = waitUntil - now;
    if (wait > 0) await sleep(wait);
  }

  private markStarted(apiId: string): void {
    this.apiLastStartedAt.set(apiId, Date.now());
  }

  private schedule<T>(apiId: string, task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await this.waitForSlot(apiId);
      this.markStarted(apiId);
      const started = Date.now();
      try { return await task(); }
      finally {
        const rest = this.minIntervalMs - (Date.now() - started);
        if (rest > 0) await sleep(rest);
      }
    });
    this.queue = run.catch(() => void 0);
    return run as Promise<T>;
  }

  private learnRateLimit(
    requestedApiId: string,
    info: KiwoomRateLimitInfo,
    retryIndex: number,
  ): number {
    const limitedApiId = info.apiId || requestedApiId;
    const learnedInterval = intervalForKiwoomFlow(info.flow);
    const previous = this.apiMinIntervalMs.get(limitedApiId) ?? 0;
    this.apiMinIntervalMs.set(limitedApiId, Math.max(previous, learnedInterval));

    // 이미 제한에 걸린 직후이므로 한 슬롯보다 넉넉히 비운 뒤 재시도한다.
    const cooldownMs = Math.max(1500, learnedInterval * 2) * (retryIndex + 1);
    const until = Date.now() + cooldownMs;
    this.apiCooldownUntil.set(
      limitedApiId,
      Math.max(this.apiCooldownUntil.get(limitedApiId) ?? 0, until),
    );

    if (limitedApiId !== requestedApiId) {
      this.apiCooldownUntil.set(
        requestedApiId,
        Math.max(this.apiCooldownUntil.get(requestedApiId) ?? 0, until),
      );
    }

    this.log.warn(
      `유량 초과(1700) · api=${limitedApiId}`
      + `${info.flow ? ` · 허용=${info.flow}/s · 간격>=${learnedInterval}ms` : ''}`
      + ` · ${cooldownMs}ms 후 재시도`,
    );
    return cooldownMs;
  }

  call<T = any>(
    apiId: string,
    path: string,
    body: Record<string, unknown>,
    opts: CallOptions = {}
  ): Promise<TrResponse<T>> {
    // 연속조회/AbortSignal은 호출별 의미가 다르므로 합치지 않는다.
    const dedupeKey = !opts.contYn && !opts.nextKey && !opts.signal
      ? requestKey(apiId, path, body)
      : '';

    if (dedupeKey) {
      const existing = this.pending.get(dedupeKey);
      if (existing) {
        this.log.info(`${apiId} 동일 요청 진행중 · 기존 호출 재사용`);
        return existing as Promise<TrResponse<T>>;
      }
    }

    const request = this.schedule<TrResponse<T>>(apiId, async () => {
      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
        if (attempt > 0) {
          await this.waitForSlot(apiId);
          this.markStarted(apiId);
        }

        const t0 = performance.now();
        let res: Response;
        try {
          res = await fetch(`${this.base}/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json;charset=UTF-8' },
            body: JSON.stringify({ apiId, path, body, contYn: opts.contYn, nextKey: opts.nextKey }),
            signal: opts.signal
          });
        } catch (e) {
          const msg = `프록시 연결 실패: ${(e as Error).message}. API 서버(3010)가 떠 있는지 확인하세요.`;
          this.log.error(`${apiId} ${msg}`);
          return { ok: false, status: 0, apiId, returnCode: -1, returnMsg: msg, contYn: false, body: {} as T };
        }

        const json = await readJson(res);
        const ms = Math.round(performance.now() - t0);

        // 프록시가 JSON 을 못 준 경우 (서버 다운 / Vite 프록시 에러)
        if (json.__empty || json.__invalid) {
          const msg = `프록시 응답 이상 (HTTP ${res.status}). ${json.__raw || '본문 없음'}`;
          this.log.error(`${apiId} ${msg} (${ms}ms)`);
          return { ok: false, status: res.status, apiId, returnCode: -1, returnMsg: msg, contYn: false, body: {} as T };
        }

        const rc: number | undefined = json?.body?.return_code;
        const returnMsg = json?.body?.return_msg;
        this.log.info(`${apiId} → ${res.status} rc=${rc ?? '-'} (${ms}ms)${attempt ? ` retry=${attempt}` : ''}`);

        const rateLimit = parseKiwoomRateLimit(rc, returnMsg);
        if (rateLimit) {
          this.learnRateLimit(apiId, rateLimit, attempt);
          if (attempt < MAX_RATE_LIMIT_RETRIES) continue;
        } else if (rc !== undefined && rc !== 0) {
          this.log.warn(`${apiId} [${rc}] ${returnMsg ?? ''}`);
        }

        return {
          ok: res.ok && rc === 0,
          status: res.status,
          apiId,
          returnCode: rc,
          returnMsg,
          contYn: json?.contYn === 'Y',
          nextKey: json?.nextKey,
          body: json?.body as T
        };
      }

      // 루프의 마지막 응답에서 항상 return하므로 도달하지 않는다.
      return {
        ok: false,
        status: 0,
        apiId,
        returnCode: -1,
        returnMsg: '유량 재시도 처리 실패',
        contYn: false,
        body: {} as T,
      };
    });

    if (dedupeKey) {
      this.pending.set(dedupeKey, request as Promise<TrResponse<any>>);
      const cleanup = () => {
        if (this.pending.get(dedupeKey) === request) this.pending.delete(dedupeKey);
      };
      void request.then(cleanup, cleanup);
    }

    return request;
  }

  async callAll<T = any>(
    apiId: string,
    path: string,
    body: Record<string, unknown>,
    pick: (b: any) => any[],
    maxPages = 20
  ): Promise<any[]> {
    const out: any[] = [];
    let contYn: string | undefined;
    let nextKey: string | undefined;

    for (let i = 0; i < maxPages; i++) {
      const r = await this.call<T>(apiId, path, body, { contYn, nextKey });
      if (!r.ok) break;
      out.push(...(pick(r.body) ?? []));
      if (!r.contYn || !r.nextKey) break;
      contYn = 'Y';
      nextKey = r.nextKey;
    }
    return out;
  }

  async status(): Promise<{ mode: string; tokenValid: boolean; expiresAt?: string; error?: string }> {
    try {
      const res = await fetch(`${this.base}/status`);
      const json = await readJson(res);
      if (json.__empty || json.__invalid) {
        return { mode: '미접속', tokenValid: false, error: `API 서버 응답 없음 (HTTP ${res.status})` };
      }
      return json;
    } catch (e) {
      return { mode: '미접속', tokenValid: false, error: `API 서버(3010) 연결 실패: ${(e as Error).message}` };
    }
  }
}
