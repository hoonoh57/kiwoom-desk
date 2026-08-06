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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** 본문을 항상 안전하게 읽는다. 비JSON이면 원문을 메시지로 보존한다. */
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return { __empty: true, __raw: '' };
  try { return JSON.parse(text); }
  catch { return { __invalid: true, __raw: text.slice(0, 300) }; }
}

/**
 * 브라우저 → 로컬 프록시(server/index.ts) → 키움 REST
 * 유량: 실전 1초당 20건, 모의투자 1초당 2건 (계좌 단위).
 */
export class KiwoomClient {
  private queue: Promise<unknown> = Promise.resolve();
  private minIntervalMs = 600;
  private cooldownUntil = 0;

  constructor(private log: Logger, private base = '/api/kiwoom') {}

  setMode(isMock: boolean): void {
    this.minIntervalMs = isMock ? 600 : 120;
    this.log.info(`유량 설정: ${isMock ? '모의(초당 약 1.6건)' : '실전(초당 약 8건)'}`);
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.cooldownUntil - Date.now();
      if (wait > 0) await sleep(wait);
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

  call<T = any>(
    apiId: string,
    path: string,
    body: Record<string, unknown>,
    opts: CallOptions = {}
  ): Promise<TrResponse<T>> {
    return this.schedule<TrResponse<T>>(async () => {
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
      this.log.info(`${apiId} → ${res.status} rc=${rc ?? '-'} (${ms}ms)`);

      if (rc === 1700) {
        this.cooldownUntil = Date.now() + 3000;
        this.log.warn('유량 초과(1700). 3초간 모든 요청을 멈춥니다.');
      } else if (rc !== undefined && rc !== 0) {
        this.log.warn(`${apiId} [${rc}] ${json?.body?.return_msg ?? ''}`);
      }

      return {
        ok: res.ok && rc === 0,
        status: res.status,
        apiId,
        returnCode: rc,
        returnMsg: json?.body?.return_msg,
        contYn: json?.contYn === 'Y',
        nextKey: json?.nextKey,
        body: json?.body as T
      };
    });
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
