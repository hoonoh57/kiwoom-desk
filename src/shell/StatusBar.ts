// StatusBar.ts
import type { AppContext } from '../core/context';
import { Topics } from '../core/events';

export class StatusBar {
  mount(host: HTMLElement) { host.innerHTML = this.tpl(); this.bind(host); }
  constructor(private ctx: AppContext) {}

  private tpl() {
    return `
      <div class="sb-left">
        <span class="sb-item" id="sbMode"><i class="codicon codicon-server-process"></i> ${this.ctx.state.mode}</span>
        <span class="sb-item" id="sbWs"><i class="codicon codicon-debug-disconnect"></i> WS 미연결</span>
        <span class="sb-item" id="sbSymbol"><i class="codicon codicon-symbol-field"></i> ${this.ctx.state.symbol.code}</span>
      </div>
      <div class="sb-right">
        <span class="sb-item" id="sbMsg"></span>
        <span class="sb-item" id="sbClock"></span>
      </div>`;
  }
  private bind(host: HTMLElement) {
    const q = (s: string) => host.querySelector<HTMLElement>(s)!;
    setInterval(() => { q('#sbClock').textContent = new Date().toLocaleTimeString('ko-KR'); }, 1000);
    this.ctx.bus.on(Topics.ConnectionChanged, (s: any) => {
      const el = q('#sbWs');
      el.innerHTML = `<i class="codicon ${s.ws ? 'codicon-debug-start' : 'codicon-debug-disconnect'}"></i> ${s.ws ? 'WS 연결됨' : 'WS 미연결'}`;
      el.classList.toggle('ok', !!s.ws);
    });
    this.ctx.bus.on(Topics.SymbolSelected, (s: any) => {
      q('#sbSymbol').innerHTML = `<i class="codicon codicon-symbol-field"></i> ${s.code} ${s.name ?? ''}`;
    });
    this.ctx.bus.on(Topics.Log, (r: any) => { q('#sbMsg').textContent = `${r.channel}: ${r.message}`.slice(0, 90); });
  }
}
