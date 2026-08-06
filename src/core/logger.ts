import type { EventBus } from './events';
import { Topics } from './events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: number;
  level: LogLevel;
  channel: string;
  message: string;
}

/** 모든 scope 가 공유하는 링버퍼 */
class LogStore {
  readonly records: LogRecord[] = [];
  private max = 5000;
  push(rec: LogRecord) {
    this.records.push(rec);
    if (this.records.length > this.max) {
      this.records.splice(0, this.records.length - this.max);
    }
  }
}

export class Logger {
  constructor(
    private bus: EventBus,
    private channel = 'app',
    private store: LogStore = new LogStore()
  ) {}

  /** 채널만 다른 자식 로거. 버퍼는 공유한다. */
  scope(channel: string): Logger {
    return new Logger(this.bus, channel, this.store);
  }

  get buffer(): readonly LogRecord[] { return this.store.records; }

  private push(level: LogLevel, message: string) {
    const rec: LogRecord = { ts: Date.now(), level, channel: this.channel, message };
    this.store.push(rec);
    this.bus.emit(Topics.Log, rec);
  }

  debug(m: string) { this.push('debug', m); }
  info(m: string)  { this.push('info', m); }
  warn(m: string)  { this.push('warn', m); }
  error(m: string) { this.push('error', m); }
}
