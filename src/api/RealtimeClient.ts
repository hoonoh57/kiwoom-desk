import { Topics, type EventBus } from '../core/events';
import type { Logger } from '../core/logger';

type WsMessage = Record<string, any>;

export class RealtimeClient {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private groupSeq = 1;
  private pending = new Map<string, (m: WsMessage) => void>();
  connected = false;

  constructor(private bus: EventBus, private log: Logger) {}

  connect(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    if (this.ws && this.ws.readyState <= 1) return;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.log.info('WS 연결됨(프록시). LOGIN 대기'); };
    this.ws.onclose = () => {
      this.connected = false;
      this.bus.emit(Topics.ConnectionChanged, { ws: false });
      this.log.warn('WS 종료. 3초 후 재연결');
      this.reconnectTimer = window.setTimeout(() => this.connect(url), 3000);
    };
    this.ws.onerror = () => this.log.error('WS 오류');
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
  }

  private onMessage(msg: WsMessage) {
    switch (msg.trnm) {
      case 'PING':                                  // 받은 그대로 되돌려야 세션 유지
        this.send(msg); return;
      case 'LOGIN':
        this.connected = msg.return_code === 0;
        this.bus.emit(Topics.ConnectionChanged, { ws: this.connected, msg: msg.return_msg });
        this.log.info(this.connected ? 'WS LOGIN 성공' : `WS LOGIN 실패: ${msg.return_msg}`);
        return;
      case 'REAL':                                  // 실시간 시세/체결/잔고
        for (const d of msg.data ?? []) this.bus.emit(Topics.RealtimeTick, d);
        return;
      case 'CNSRLST':
      case 'CNSRREQ':
      case 'CNSRCLR': {
        const waiter = this.pending.get(msg.trnm);
        if (waiter) { this.pending.delete(msg.trnm); waiter(msg); }
        if (msg.trnm === 'CNSRREQ' && msg.data) this.bus.emit(Topics.ConditionHit, msg);
        return;
      }
      default:
        this.log.debug(`WS ${msg.trnm ?? '?'} ${JSON.stringify(msg).slice(0, 200)}`);
    }
  }

  send(msg: WsMessage) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(msg)); }

  private request(trnm: string, extra: WsMessage = {}, timeoutMs = 8000): Promise<WsMessage> {
    return new Promise((resolve, reject) => {
      const to = window.setTimeout(() => { this.pending.delete(trnm); reject(new Error(`${trnm} timeout`)); }, timeoutMs);
      this.pending.set(trnm, (m) => { clearTimeout(to); resolve(m); });
      this.send({ trnm, ...extra });
    });
  }

  /** 조건검색식 목록 */
  conditionList() { return this.request('CNSRLST'); }

  /** 조건검색 요청. searchType '0'=일반조회, '1'=실시간등록 */
  conditionSearch(seq: string, searchType: '0' | '1' = '0', stex = 'K') {
    return this.request('CNSRREQ', { seq, search_type: searchType, stex_tp: stex, cont_yn: 'N', next_key: '' });
  }
  conditionClear(seq: string) { return this.request('CNSRCLR', { seq }); }

  /** 실시간 시세 등록. types 예: ['0B'](주식체결), ['0D'](호가잔량) */
  register(items: string[], types: string[], refresh: '0' | '1' = '1') {
    const grpNo = String(this.groupSeq++);
    this.send({ trnm: 'REG', grp_no: grpNo, refresh, data: [{ item: items, type: types }] });
    return grpNo;
  }
  unregister(grpNo: string, items: string[], types: string[]) {
    this.send({ trnm: 'REMOVE', grp_no: grpNo, refresh: '1', data: [{ item: items, type: types }] });
  }
  dispose() { clearTimeout(this.reconnectTimer); this.ws?.close(); }
}
