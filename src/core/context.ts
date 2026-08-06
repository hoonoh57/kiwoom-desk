import { EventBus } from './events';
import { Logger } from './logger';
import { CommandRegistry } from './commands';
import { KiwoomClient } from '../api/KiwoomClient';
import { RealtimeClient } from '../api/RealtimeClient';
import type { DockService } from '../shell/DockHost';

export type TradeMode = '모의투자' | '실투자' | '미접속';

export interface AppState {
  mode: TradeMode;
  account?: string;
  symbol: { code: string; name: string };
  wsConnected: boolean;
}

export class AppContext {
  readonly bus = new EventBus();
  readonly commands = new CommandRegistry();
  readonly log: Logger;
  readonly api: KiwoomClient;
  readonly rt: RealtimeClient;

  /** Workbench.render() 안에서 주입된다. */
  dock!: DockService;

  state: AppState = {
    mode: '미접속',
    symbol: { code: '005930', name: '삼성전자' },
    wsConnected: false
  };

  constructor() {
    this.log = new Logger(this.bus, 'app');
    this.api = new KiwoomClient(this.log.scope('rest'));
    this.rt = new RealtimeClient(this.bus, this.log.scope('ws'));
  }
}
