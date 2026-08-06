import { Topics, type EventBus } from '../core/events';
import type { Logger } from '../core/logger';

type WsMessage = Record<string, any>;

interface QueuedRequest {
  trnm: string;
  extra: WsMessage;
  timeoutMs: number;
  resolve: (message: WsMessage) => void;
  reject: (reason?: any) => void;
  timer?: number;
}

export class RealtimeClient {
  private ws?: WebSocket;
  private reconnectTimer?: number;
  private groupSeq = 1;

  /**
   * 키움 WebSocket 응답에는 클라이언트 request id가 없으므로
   * 같은 trnm 요청은 반드시 직렬 처리한다.
   */
  private requestQueues =
    new Map<string, QueuedRequest[]>();

  private activeRequests =
    new Map<string, QueuedRequest>();

  /**
   * timeout 이후 늦은 응답이 다음 요청에 연결되지 않도록
   * 재로그인 전까지 해당 trnm 요청을 차단한다.
   */
  private blockedRequests =
    new Set<string>();

  private url = '';
  private manualClose = false;

  connected = false;

  constructor(
    private bus: EventBus,
    private log: Logger,
  ) {}

  private emitWs(
    connected: boolean,
    msg?: string,
  ): void {
    this.connected = connected;

    this.bus.emit(
      Topics.WsChanged,
      { connected, msg },
    );
  }

  connect(
    url =
      `${location.protocol === 'https:' ? 'wss' : 'ws'}`
      + `://${location.host}/ws`,
  ): void {
    this.url = url;
    this.manualClose = false;

    if (
      this.ws
      && this.ws.readyState <= WebSocket.OPEN
    ) {
      return;
    }

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.log.info('WS 소켓 연결됨(프록시). LOGIN 대기');
    };

    this.ws.onclose = () => {
      this.failAllRequests(
        new Error('WS 연결이 종료되었습니다.'),
      );

      this.emitWs(false);

      if (this.manualClose) return;

      this.log.warn('WS 종료. 3초 후 재연결');

      this.reconnectTimer = window.setTimeout(
        () => this.connect(this.url),
        3000,
      );
    };

    this.ws.onerror = () => {
      this.log.error('WS 오류');
    };

    this.ws.onmessage = ev => {
      try {
        this.onMessage(JSON.parse(ev.data));
      } catch {
        this.log.debug(
          `WS 파싱 불가: ${String(ev.data).slice(0, 120)}`,
        );
      }
    };
  }

  reconnect(): void {
    this.manualClose = true;

    clearTimeout(this.reconnectTimer);

    this.failAllRequests(
      new Error('WS 재연결로 요청이 취소되었습니다.'),
    );

    try {
      this.ws?.close();
    } catch {
      // 이미 닫힌 소켓은 무시한다.
    }

    this.ws = undefined;

    window.setTimeout(
      () => this.connect(this.url || undefined),
      200,
    );
  }

  private onMessage(msg: WsMessage): void {
    const trnm = String(msg.trnm ?? '');

    switch (trnm) {
      case 'PING':
        this.send(msg);
        return;

      case 'LOGIN': {
        const ok = Number(msg.return_code) === 0;

        if (ok) {
          // 재로그인이 끝났으므로 timeout 격리를 해제한다.
          this.blockedRequests.clear();
        }

        this.emitWs(ok, msg.return_msg);

        this.log.info(
          ok
            ? 'WS LOGIN 성공'
            : `WS LOGIN 실패: ${msg.return_msg}`,
        );
        return;
      }

      case 'REAL':
        for (const data of msg.data ?? []) {
          this.bus.emit(
            Topics.RealtimeTick,
            data,
          );
        }
        return;

      case 'CNSRLST':
      case 'CNSRCLR':
        this.completeRequest(trnm, msg);
        return;

      case 'CNSRREQ':
        /*
         * 요청에 대한 최종 응답에는 return_code가 있다.
         *
         * return_code가 없는 CNSRREQ 데이터 패킷을 활성 요청의
         * 응답으로 처리하면 다른 조건식 검색 Promise가 잘못 완료되고,
         * 실제 응답은 "대기 요청 없음" 상태로 버려진다.
         */
        if (
          Object.prototype.hasOwnProperty.call(
            msg,
            'return_code',
          )
        ) {
          this.completeRequest(trnm, msg);
          return;
        }

        // 요청 응답과 분리된 데이터 패킷은 이벤트로만 전달한다.
        this.bus.emit(
          Topics.ConditionHit,
          msg,
        );
        return;
      default:
        this.log.debug(
          `WS ${trnm || '?'} `
          + `${JSON.stringify(msg).slice(0, 200)}`,
        );
    }
  }

  send(msg: WsMessage): boolean {
    if (
      !this.ws
      || this.ws.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (e: any) {
      this.log.error(
        `WS 전송 실패: ${e?.message ?? e}`,
      );
      return false;
    }
  }

  /**
   * 동일 trnm 요청을 큐에 넣고 하나씩 전송한다.
   *
   * 응답에 request id가 없으므로 같은 trnm을 동시에 보내면
   * 어떤 응답이 어느 Promise의 것인지 확정할 수 없다.
   */
  private request(
    trnm: string,
    extra: WsMessage = {},
    timeoutMs = 8000,
  ): Promise<WsMessage> {
    return new Promise((resolve, reject) => {
      if (this.blockedRequests.has(trnm)) {
        reject(
          new Error(
            `${trnm} 요청은 이전 timeout으로 차단됐습니다. `
            + `WS 재로그인이 필요합니다.`,
          ),
        );
        return;
      }

      if (
        !this.connected
        || !this.ws
        || this.ws.readyState !== WebSocket.OPEN
      ) {
        reject(
          new Error(
            `${trnm} 요청 실패: WS LOGIN 상태가 아닙니다.`,
          ),
        );
        return;
      }

      const item: QueuedRequest = {
        trnm,
        extra,
        timeoutMs,
        resolve,
        reject,
      };

      const queue =
        this.requestQueues.get(trnm) ?? [];

      queue.push(item);
      this.requestQueues.set(trnm, queue);

      this.pumpRequest(trnm);
    });
  }

  /**
   * 해당 trnm의 선두 요청만 실제로 전송한다.
   */
  private pumpRequest(trnm: string): void {
    if (
      this.activeRequests.has(trnm)
      || this.blockedRequests.has(trnm)
    ) {
      return;
    }

    const queue =
      this.requestQueues.get(trnm);

    if (!queue?.length) {
      this.requestQueues.delete(trnm);
      return;
    }

    if (
      !this.connected
      || !this.ws
      || this.ws.readyState !== WebSocket.OPEN
    ) {
      this.failQueuedRequests(
        trnm,
        new Error(
          `${trnm} 요청 실패: WS 연결이 끊겼습니다.`,
        ),
      );
      return;
    }

    const item = queue.shift()!;

    if (!queue.length) {
      this.requestQueues.delete(trnm);
    }

    this.activeRequests.set(trnm, item);

    item.timer = window.setTimeout(
      () => this.timeoutRequest(item),
      item.timeoutMs,
    );

    const sent = this.send({
      trnm: item.trnm,
      ...item.extra,
    });

    if (sent) return;

    clearTimeout(item.timer);
    this.activeRequests.delete(trnm);

    item.reject(
      new Error(`${trnm} 요청 전송에 실패했습니다.`),
    );

    this.failQueuedRequests(
      trnm,
      new Error(
        `${trnm} 선행 요청 전송 실패로 큐가 취소됐습니다.`,
      ),
    );
  }

  /**
   * 현재 활성 요청에 응답을 전달한 후 다음 요청을 전송한다.
   */
  private completeRequest(
    trnm: string,
    message: WsMessage,
  ): boolean {
    if (this.blockedRequests.has(trnm)) {
      this.log.warn(
        `timeout 이후 도착한 ${trnm} 응답을 무시했습니다.`,
      );
      return false;
    }

    const item =
      this.activeRequests.get(trnm);

    if (!item) {
      this.log.debug(
        `대기 요청이 없는 ${trnm} 응답을 무시했습니다.`,
      );
      return false;
    }

    clearTimeout(item.timer);
    this.activeRequests.delete(trnm);

    item.resolve(message);

    this.pumpRequest(trnm);
    return true;
  }

  /**
   * timeout 뒤에는 늦은 응답과 다음 요청을 구분할 수 없다.
   * 큐를 폐기하고 WebSocket을 재연결해 프로토콜 경계를 초기화한다.
   */
  private timeoutRequest(
    item: QueuedRequest,
  ): void {
    const current =
      this.activeRequests.get(item.trnm);

    if (current !== item) return;

    clearTimeout(item.timer);
    this.activeRequests.delete(item.trnm);
    this.blockedRequests.add(item.trnm);

    const error = new Error(
      `${item.trnm} timeout (${item.timeoutMs}ms)`,
    );

    item.reject(error);

    this.failQueuedRequests(
      item.trnm,
      new Error(
        `${item.trnm} timeout으로 후속 요청이 취소됐습니다.`,
      ),
    );

    this.log.warn(
      `${item.trnm} timeout. `
      + `늦은 응답 격리를 위해 WS를 재연결합니다.`,
    );

    this.reconnect();
  }

  private failQueuedRequests(
    trnm: string,
    error: Error,
  ): void {
    const queue =
      this.requestQueues.get(trnm) ?? [];

    this.requestQueues.delete(trnm);

    for (const item of queue) {
      item.reject(error);
    }
  }

  private failAllRequests(
    error: Error,
  ): void {
    for (
      const item of this.activeRequests.values()
    ) {
      clearTimeout(item.timer);
      item.reject(error);
    }

    this.activeRequests.clear();

    for (
      const queue of this.requestQueues.values()
    ) {
      for (const item of queue) {
        item.reject(error);
      }
    }

    this.requestQueues.clear();
  }

  conditionList(): Promise<WsMessage> {
    return this.request('CNSRLST');
  }

  conditionSearch(
    seq: string,
    searchType: '0' | '1' = '0',
    stex = 'K',
  ): Promise<WsMessage> {
    return this.request(
      'CNSRREQ',
      {
        seq,
        search_type: searchType,
        stex_tp: stex,
        cont_yn: 'N',
        next_key: '',
      },
    );
  }

  conditionClear(
    seq: string,
  ): Promise<WsMessage> {
    return this.request(
      'CNSRCLR',
      { seq },
    );
  }

  register(
    items: string[],
    types: string[],
    refresh: '0' | '1' = '1',
  ): string {
    const grpNo =
      String(this.groupSeq++);

    this.send({
      trnm: 'REG',
      grp_no: grpNo,
      refresh,
      data: [
        {
          item: items,
          type: types,
        },
      ],
    });

    return grpNo;
  }

  unregister(
    grpNo: string,
    items: string[],
    types: string[],
  ): void {
    this.send({
      trnm: 'REMOVE',
      grp_no: grpNo,
      refresh: '1',
      data: [
        {
          item: items,
          type: types,
        },
      ],
    });
  }

  dispose(): void {
    this.manualClose = true;

    clearTimeout(this.reconnectTimer);

    this.failAllRequests(
      new Error('RealtimeClient가 종료됐습니다.'),
    );

    try {
      this.ws?.close();
    } catch {
      // 이미 닫힌 소켓은 무시한다.
    }

    this.ws = undefined;
    this.connected = false;
  }
}

export default RealtimeClient;
