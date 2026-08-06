export type Handler<T> = (payload: T) => void;

export class Emitter<T> {
  private handlers = new Set<Handler<T>>();

  on(h: Handler<T>): () => void {
    this.handlers.add(h);
    return () => { this.handlers.delete(h); };
  }

  fire(payload: T): void {
    for (const h of [...this.handlers]) {
      try { h(payload); } catch (e) { console.error('[EventBus]', e); }
    }
  }

  dispose(): void { this.handlers.clear(); }
}

/** 모든 브로드캐스트 페이로드는 발신자 식별을 가진다. */
export interface Broadcast { source?: string; }

/**
 * 전역 느슨한 결합용 버스. 폼끼리 직접 참조하지 않는다.
 * 발신자가 자기 방송을 되받아 무한 루프에 빠지는 것을 onExcept 로 차단한다.
 */
export class EventBus {
  private map = new Map<string, Emitter<any>>();

  private slot<T>(topic: string): Emitter<T> {
    let e = this.map.get(topic);
    if (!e) { e = new Emitter<T>(); this.map.set(topic, e); }
    return e as Emitter<T>;
  }

  on<T = any>(topic: string, h: Handler<T>): () => void {
    return this.slot<T>(topic).on(h);
  }

  /** self 와 같은 source 를 가진 메시지는 건너뛴다. */
  onExcept<T extends Broadcast>(topic: string, self: string, h: Handler<T>): () => void {
    return this.slot<T>(topic).on((p) => { if (p?.source !== self) h(p); });
  }

  emit<T = any>(topic: string, payload: T): void {
    this.slot<T>(topic).fire(payload);
  }

  dispose(): void {
    for (const e of this.map.values()) e.dispose();
    this.map.clear();
  }
}

/** 표준 토픽 */
export const Topics = {
  SymbolSelected: 'symbol.selected',
  OrderFilled: 'order.filled',
  RealtimeTick: 'rt.tick',
  ConditionHit: 'condition.hit',
  ConnectionChanged: 'conn.changed',
  Log: 'log.append'
} as const;

/** 토픽별 페이로드 타입 */
export interface SymbolPayload extends Broadcast { code: string; name?: string; }
export interface ConnectionPayload extends Broadcast { ws: boolean; msg?: string; }
export interface RealtimePayload extends Broadcast {
  type?: string;
  item?: string;
  values?: Record<string, string>;
}
