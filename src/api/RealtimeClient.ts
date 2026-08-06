import { Topics, type EventBus } from '../core/events';
import type { Logger } from '../core/logger';

type WsMessage = Record<string, any>;

export class RealtimeClient {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private groupSeq = 1;
  private pending = new Map<string, (m: WsMessage) => void>();
  private url = '';
  private manualClose = false;
  connected = false;

  constructor(private bus: EventBus, private log: Logger) {}

  private emitWs(connected: boolean, msg?: string) {
    this.connected = connected;
    this.bus.emit(Topics.WsChanged, { connected, msg });
  }

  connect(url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.url = url;
    this.manualClose = false;
    if (this.ws && this.ws.readyState <= 1) return;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.log.info('WS 소켓 연결됨(프록시). LOGIN 대기');
    this.ws.onclose = () => {
      this.emitWs(false);
      if (this.manualClose) return;
      this.log.warn('WS 종료. 3초 후 재연결');
      this.reconnectTimer = window.setTimeout(() => this.connect(this.url), 3000);
    };
    this.ws.onerror = () => this.log.error('WS 오류');
    this.ws.onmessage = (ev) => {
      try { this.onMessage(JSON.parse(ev.data)); }
      catch { this.log.debug(`WS 파싱 불가: ${String(ev.data).slice(0, 120)}`); }
    };
  }

  reconnect() {
    this.manualClose = true;
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = undefined;
    window.setTimeout(() => this.connect(this.url || undefined), 200);
  }

  private onMessage(msg: WsMessage) {
    switch (msg.trnm) {
      case 'PING':
        this.send(msg); return;
      case 'LOGIN':
        this.emitWs(msg.return_code === 0, msg.return_msg);
        this.log.info(msg.return_code === 0 ? 'WS LOGIN 성공' : `WS LOGIN 실패: ${msg.return_msg}`);
        return;
      case 'REAL':
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

  send(msg: WsMessage) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  private request(trnm: string, extra: WsMessage = {}, timeoutMs = 8000): Promise<WsMessage> {
    return new Promise((resolve, reject) => {
      const to = window.setTimeout(() => { this.pending.delete(trnm); reject(new Error(`${trnm} timeout`)); }, timeoutMs);
      this.pending.set(trnm, (m) => { clearTimeout(to); resolve(m); });
      this.send({ trnm, ...extra });
    });
  }

  conditionList() { return this.request('CNSRLST'); }
  conditionSearch(seq: string, searchType: '0' | '1' = '0', stex = 'K') {
    return this.request('CNSRREQ', { seq, search_type: searchType, stex_tp: stex, cont_yn: 'N', next_key: '' });
  }
  conditionClear(seq: string) { return this.request('CNSRCLR', { seq }); }

  register(items: string[], types: string[], refresh: '0' | '1' = '1') {
    const grpNo = String(this.groupSeq++);
    this.send({ trnm: 'REG', grp_no: grpNo, refresh, data: [{ item: items, type: types }] });
    return grpNo;
  }
  unregister(grpNo: string, items: string[], types: string[]) {
    this.send({ trnm: 'REMOVE', grp_no: grpNo, refresh: '1', data: [{ item: items, type: types }] });
  }
  dispose() { this.manualClose = true; clearTimeout(this.reconnectTimer); this.ws?.close(); }
}
