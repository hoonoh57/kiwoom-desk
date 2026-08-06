import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, writeFileSync } from 'node:fs';
import 'dotenv/config';

// ── 환경 ────────────────────────────────────────────────────────────
const MOCK = (process.env.KIWOOM_MOCK ?? 'true').toLowerCase() === 'true';
const REST = MOCK ? 'https://mockapi.kiwoom.com' : 'https://api.kiwoom.com';
const WS   = MOCK ? 'wss://mockapi.kiwoom.com:10000/api/dostk/websocket'
                  : 'wss://api.kiwoom.com:10000/api/dostk/websocket';
const APPKEY = (MOCK ? process.env.KIWOOM_MOCK_APP_KEY    : process.env.KIWOOM_REAL_APP_KEY)    ?? '';
const SECRET = (MOCK ? process.env.KIWOOM_MOCK_SECRET_KEY : process.env.KIWOOM_REAL_SECRET_KEY) ?? '';
const CACHE  = '.token-cache.json';
const PORT   = Number(process.env.PORT ?? 3010);

process.on('uncaughtException',  (e) => console.error('[fatal] uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('[fatal] unhandledRejection', e));

if (!APPKEY || !SECRET) {
  console.error(`[env] ${MOCK ? '모의' : '실'}투자 앱키/시크릿이 비어 있습니다. .env 를 확인하세요.`);
}

// ── 토큰 관리 ───────────────────────────────────────────────────────
let token = '';
let tokenExp = 0;
let inflight: Promise<string> | null = null;   // 동시 발급 방지

try {
  const c = JSON.parse(readFileSync(CACHE, 'utf-8'));
  if (c.mock === MOCK && c.exp > Date.now() + 60_000) {
    token = c.token;
    tokenExp = c.exp;
    console.log(`[token] 캐시 재사용 (만료 ${new Date(tokenExp).toLocaleString('ko-KR')})`);
  }
} catch { /* 캐시 없음 */ }

// expires_dt 형식: 'YYYYMMDDHHmmss' (KST)
function parseExpire(s?: string): number {
  if (!s || s.length < 14) return Date.now() + 6 * 3600_000;
  const n = (a: number, b: number) => Number(s.slice(a, b));
  const utc = Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14)) - 9 * 3600_000;
  return Number.isFinite(utc) ? utc : Date.now() + 6 * 3600_000;
}

async function issueToken(): Promise<string> {
  const r = await fetch(`${REST}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: APPKEY, secretkey: SECRET })
  });
  const text = await r.text();
  let j: any = {};
  try { j = JSON.parse(text); } catch { /* 비JSON 응답 */ }

  if (!j?.token) {
    throw new Error(`토큰 발급 실패 (HTTP ${r.status}) [${j?.return_code ?? '-'}] ${j?.return_msg ?? text.slice(0, 200)}`);
  }
  token = j.token;
  tokenExp = parseExpire(j.expires_dt);
  try { writeFileSync(CACHE, JSON.stringify({ mock: MOCK, token, exp: tokenExp })); } catch { /* noop */ }
  console.log(`[token] 발급 완료 (만료 ${j.expires_dt})`);
  return token;
}

/** 유효 토큰 반환. 동시 호출은 하나의 발급 요청으로 합쳐진다. */
async function getToken(force = false): Promise<string> {
  if (!force && token && Date.now() < tokenExp - 60_000) return token;
  if (inflight) return inflight;
  inflight = issueToken().finally(() => { inflight = null; });
  return inflight;
}

interface KiwoomResult { status: number; json: any; contYn: string | null; nextKey: string | null; }

/** 8005(토큰 무효)면 강제 재발급 후 1회 재시도 */
async function callKiwoom(
  apiId: string, path: string, body: any,
  contYn?: string, nextKey?: string, retry = true
): Promise<KiwoomResult> {
  const tk = await getToken();
  const r = await fetch(`${REST}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${tk}`,
      'api-id': apiId,
      ...(contYn ? { 'cont-yn': contYn } : {}),
      ...(nextKey ? { 'next-key': nextKey } : {})
    },
    body: JSON.stringify(body ?? {})
  });

  const text = await r.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; }
  catch { json = { return_code: -1, return_msg: `비JSON 응답: ${text.slice(0, 200)}` }; }

  const rc = json?.return_code;
  const invalid = r.status === 401 || rc === 8005 ||
                  (rc !== 0 && rc !== undefined && /token/i.test(String(json?.return_msg ?? '')));
  if (invalid && retry) {
    console.warn(`[token] 무효 감지(rc=${rc}). 재발급 후 재시도`);
    await getToken(true);
    return callKiwoom(apiId, path, body, contYn, nextKey, false);
  }
  return { status: r.status, json, contYn: r.headers.get('cont-yn'), nextKey: r.headers.get('next-key') };
}

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '2mb' }));

/** 루트: 브라우저로 바로 열어보는 진단 페이지 */
app.get('/', (_req, res) => {
  const alive = token && Date.now() < tokenExp;
  res.type('html').send(`<!doctype html><meta charset="utf-8">
    <title>Kiwoom Desk API</title>
    <body style="font:14px/1.7 'Malgun Gothic',sans-serif;padding:32px;background:#1e1e1e;color:#ccc">
      <h2 style="color:#fff;font-weight:400">Kiwoom Desk API 프록시</h2>
      <p>상태: <b style="color:#4ec9b0">정상 동작 중</b></p>
      <p>모드: <b>${MOCK ? '모의투자' : '실투자'}</b> (${REST})</p>
      <p>토큰: <b style="color:${alive ? '#4ec9b0' : '#f48771'}">${alive ? '유효' : '없음/만료'}</b>
         ${alive ? `(만료 ${new Date(tokenExp).toLocaleString('ko-KR')})` : ''}</p>
      <p>앱키: <b style="color:${APPKEY ? '#4ec9b0' : '#f48771'}">${APPKEY ? '설정됨' : '없음 — .env 확인'}</b></p>
      <hr style="border:0;border-top:1px solid #333;margin:20px 0">
      <p><a style="color:#3794ff" href="/api/kiwoom/status">/api/kiwoom/status</a> — 토큰 상태(JSON)</p>
      <p>웹 UI는 <a style="color:#3794ff" href="http://localhost:5173">http://localhost:5173</a> 입니다.</p>
    </body>`);
});

app.get('/api/kiwoom/status', async (_req, res) => {
  const mode = MOCK ? '모의투자' : '실투자';
  try {
    await getToken();
    res.json({ mode, tokenValid: true, expiresAt: new Date(tokenExp).toISOString() });
  } catch (e: any) {
    console.error('[status]', e.message);
    res.json({ mode, tokenValid: false, error: e.message });
  }
});

app.post('/api/kiwoom/call', async (req, res) => {
  const { apiId, path, body, contYn, nextKey } = req.body ?? {};
  if (!apiId || !path) {
    res.status(400).json({ body: { return_code: -1, return_msg: 'apiId/path 누락' } });
    return;
  }
  try {
    const r = await callKiwoom(apiId, path, body, contYn, nextKey);
    res.status(200).json({ body: r.json, contYn: r.contYn, nextKey: r.nextKey, httpStatus: r.status });
  } catch (e: any) {
    console.error(`[call] ${apiId}`, e.message);
    res.status(200).json({ body: { return_code: -1, return_msg: e.message } });
  }
});

// /api/kiwoom/* 는 무조건 JSON 으로 응답한다 (프론트 파싱 실패 방지)
app.use('/api/kiwoom', (_req, res) => {
  res.status(404).json({ body: { return_code: -1, return_msg: '알 수 없는 프록시 경로' } });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[express]', err);
  res.status(500).json({ body: { return_code: -1, return_msg: String(err?.message ?? err) } });
});

const server = app.listen(PORT, () => {
  console.log(`[api] http://localhost:${PORT} (${MOCK ? '모의' : '실'}투자)`);
});

server.on('error', (e: any) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[api] 포트 ${PORT} 사용 중입니다. 기존 프로세스를 종료하세요.`);
    console.error(`      Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
  } else {
    console.error('[api] listen 오류', e);
  }
  process.exit(1);
});

// ── WebSocket 릴레이 ────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (client) => {
  let up: WebSocket | null = null;
  let canRelogin = true;

  const start = async (force = false) => {
    const tk = await getToken(force);
    up = new WebSocket(WS);

    up.on('open', () => up?.send(JSON.stringify({ trnm: 'LOGIN', token: tk })));

    up.on('message', (d) => {
      const text = d.toString();
      try {
        const m = JSON.parse(text);
        if (m.trnm === 'LOGIN' && m.return_code !== 0 && canRelogin) {
          canRelogin = false;
          console.warn(`[ws] LOGIN 실패(${m.return_code} ${m.return_msg}). 토큰 재발급 후 재접속`);
          up?.removeAllListeners();
          up?.close();
          void start(true);
          return;
        }
        if (m.trnm === 'LOGIN' && m.return_code === 0) console.log('[ws] LOGIN 성공');
      } catch { /* 파싱 불가 메시지는 그대로 전달 */ }
      if (client.readyState === 1) client.send(text);
    });

    up.on('close', () => { if (client.readyState === 1) client.close(); });
    up.on('error', (e) => console.error('[ws upstream]', e.message));
  };

  client.on('message', (d) => { if (up?.readyState === 1) up.send(d.toString()); });
  client.on('close', () => { up?.removeAllListeners(); up?.close(); });

  try {
    await start();
  } catch (e: any) {
    console.error('[ws]', e.message);
    client.send(JSON.stringify({ trnm: 'LOGIN', return_code: -1, return_msg: e.message }));
    client.close();
  }
});
