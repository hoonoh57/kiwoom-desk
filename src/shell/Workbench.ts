import type { AppContext } from '../core/context';
import { DockService } from './DockHost';
import { SideBar } from './SideBar';
import { registerCommands } from '../core/commands';
import { Topics } from '../core/events';

interface ActivityItem { id: string; icon: string; title: string; formId?: string; params?: any; }

const ACTIVITY: ActivityItem[] = [
  { id: 'explorer', icon: 'files',       title: '탐색기' },
  { id: 'chart',    icon: 'graph-line',  title: '차트',     formId: 'chart',     params: { apiId: 'ka10081' } },
  { id: 'account',  icon: 'account',     title: '계좌',     formId: 'account',   params: { tab: 'balance' } },
  { id: 'order',    icon: 'credit-card', title: '주문',     formId: 'order',     params: { side: 'buy' } },
  { id: 'cond',     icon: 'filter',      title: '조건검색', formId: 'condition' },
  { id: 'settings', icon: 'gear',        title: '설정',     formId: 'settings' },
];

const MENUS: Array<{ label: string; items: Array<{ label: string; cmd?: string; sep?: boolean }> }> = [
  { label: '파일', items: [
    { label: '레이아웃 저장', cmd: 'layout.save' },
    { label: '레이아웃 초기화', cmd: 'layout.reset' },
    { label: '', sep: true },
    { label: '모든 패널 닫기', cmd: 'layout.closeAll' },
  ]},
  { label: '조회', items: [
    { label: '종목정보', cmd: 'view.stockInfo' },
    { label: '차트', cmd: 'view.chart' },
    { label: '거래대금 상위', cmd: 'tr.ka10032' },
    { label: '전일대비등락률 상위', cmd: 'tr.ka10027' },
  ]},
  { label: '거래', items: [
    { label: '주문', cmd: 'view.order' },
    { label: '계좌 잔고', cmd: 'view.account' },
    { label: '미체결', cmd: 'tr.ka10075' },
    { label: '조건검색', cmd: 'view.open.condition' },
  ]},
  { label: '보기', items: [
    { label: '출력', cmd: 'view.output' },
    { label: '로그', cmd: 'view.open.log' },
    { label: '', sep: true },
    { label: '명령 팔레트…', cmd: 'palette.show' },
  ]},
];

export class Workbench {
  private host!: HTMLElement;
  private editorHost!: HTMLElement;
  private sideHost!: HTMLElement;
  private sidebar!: SideBar;
  private sideVisible = true;
  private palette?: HTMLElement;

  constructor(private ctx: AppContext, host?: HTMLElement) {
    if (host) this.host = host;
  }

  /** main.ts 가 render(host) 로 부르든 render() 로 부르든 동작 */
  render(host?: HTMLElement): void {
    const target = host ?? this.host ?? document.getElementById('workbench');
    if (!target) throw new Error('#workbench 컨테이너를 찾을 수 없습니다.');
    this.host = target;

    this.host.innerHTML = `
      <div class="wb-titlebar">
        <span class="wb-logo">Kiwoom Desk</span>
        <nav class="wb-menu" id="wbMenu">
          ${MENUS.map((m, i) => `<button class="wb-menu-btn" data-m="${i}">${m.label}</button>`).join('')}
        </nav>
        <span class="wb-title-center" id="wbCenterTitle">Kiwoom Desk</span>
        <span class="wb-title-right" id="wbMode">미접속</span>
      </div>

      <div class="wb-main">
        <div class="wb-activity" id="wbActivity">
          ${ACTIVITY.map(a => `<button class="wb-act" data-a="${a.id}" title="${a.title}">
              <i class="codicon codicon-${a.icon}"></i></button>`).join('')}
        </div>
        <div class="wb-side" id="wbSide"></div>
        <div class="wb-sash" id="wbSash"></div>
        <div class="wb-center">
          <div class="wb-editor" id="wbEditor"></div>
        </div>
      </div>

      <div class="wb-status">
        <span class="st-item" id="stConn">● 미접속</span>
        <span class="st-item" id="stWs">WS 대기</span>
        <span class="st-item" id="stSymbol">-</span>
        <span class="st-flex"></span>
        <span class="st-item" id="stLast"></span>
        <span class="st-item" id="stClock"></span>
      </div>`;

    this.sideHost = this.host.querySelector('#wbSide') as HTMLElement;
    this.editorHost = this.host.querySelector('#wbEditor') as HTMLElement;

    // 1) 도크 먼저 (커맨드가 ctx.dock 을 참조)
    const dock = new DockService(this.ctx);
    (this.ctx as any).dock = dock;
    dock.mount(this.editorHost);

    // 2) 사이드바
    this.sidebar = new SideBar(this.ctx);
    this.sideHost.appendChild(this.sidebar.render());

    // 3) 커맨드 + 키보드
    registerCommands(this.ctx);
    this.ctx.commands.register({
      id: 'palette.show', title: '명령 팔레트', category: '보기',
      keybinding: 'ctrl+shift+p', run: () => this.showPalette(),
    });
    this.ctx.commands.register({
      id: 'view.toggleSidebar', title: '사이드바 토글', category: '보기',
      keybinding: 'ctrl+b', run: () => this.toggleSide(),
    });
    this.ctx.commands.attachKeyboard(document);

    this.bindMenus();
    this.bindActivity();
    this.bindSash();
    this.bindStatus();

    // 4) 레이아웃 복원 또는 기본 배치
    if (!dock.restoreLayout()) {
      dock.open('welcome', {}, {});
      dock.open('chart', { apiId: 'ka10081' }, { direction: 'right' });
      dock.open('output', {}, { direction: 'below' });
      dock.focus('welcome');
    }
    window.addEventListener('beforeunload', () => dock.saveLayout());
  }

  /* ---------- 메뉴 ---------- */
  private bindMenus(): void {
    const bar = this.host.querySelector('#wbMenu') as HTMLElement;
    bar.querySelectorAll<HTMLElement>('[data-m]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeMenus();
        const menu = MENUS[Number(btn.dataset.m)];
        const pop = document.createElement('div');
        pop.className = 'wb-pop';
        pop.innerHTML = menu.items.map(it => it.sep
          ? `<div class="wb-pop-sep"></div>`
          : `<button class="wb-pop-item" data-c="${it.cmd ?? ''}">${it.label}</button>`).join('');
        const r = btn.getBoundingClientRect();
        pop.style.left = `${r.left}px`;
        pop.style.top = `${r.bottom}px`;
        document.body.appendChild(pop);
        pop.querySelectorAll<HTMLElement>('[data-c]').forEach(i =>
          i.addEventListener('click', () => {
            const c = i.dataset.c;
            this.closeMenus();
            if (c) this.ctx.commands.execute(c);
          }));
      });
    });
    document.addEventListener('click', () => this.closeMenus());
  }
  private closeMenus(): void {
    document.querySelectorAll('.wb-pop').forEach(p => p.remove());
  }

  /* ---------- 액티비티 바 ---------- */
  private bindActivity(): void {
    this.host.querySelectorAll<HTMLElement>('[data-a]').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = ACTIVITY.find(a => a.id === btn.dataset.a)!;
        if (!item.formId) { this.toggleSide(); return; }
        (this.ctx as any).dock?.open(item.formId, item.params ?? {}, {});
      });
    });
  }

  private toggleSide(): void {
    this.sideVisible = !this.sideVisible;
    this.sideHost.style.display = this.sideVisible ? '' : 'none';
    (this.host.querySelector('#wbSash') as HTMLElement).style.display = this.sideVisible ? '' : 'none';
  }

  /* ---------- 사이드바 리사이즈 ---------- */
  private bindSash(): void {
    const sash = this.host.querySelector('#wbSash') as HTMLElement;
    let dragging = false;
    sash.addEventListener('mousedown', () => {
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = this.sideHost.getBoundingClientRect().left;
      const w = Math.min(560, Math.max(160, e.clientX - left));
      this.sideHost.style.width = `${w}px`;
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  /* ---------- 상태 바 ---------- */
  private bindStatus(): void {
    const $ = (s: string) => this.host.querySelector(s) as HTMLElement;
    const clock = () => { $('#stClock').textContent = new Date().toLocaleTimeString('ko-KR'); };
    clock();
    const t = window.setInterval(clock, 1000);
    window.addEventListener('beforeunload', () => window.clearInterval(t));

    this.ctx.bus.on('conn.changed', (p: any) => {
      const mode = p?.mode ?? '미접속';
      $('#stConn').textContent = `● ${mode}`;
      $('#stConn').className = `st-item ${p?.tokenValid ? 'ok' : 'off'}`;
      $('#wbMode').textContent = mode;
    });
    this.ctx.bus.on('ws.changed', (p: any) => {
      $('#stWs').textContent = p?.connected ? 'WS 연결됨' : 'WS 끊김';
      $('#stWs').className = `st-item ${p?.connected ? 'ok' : 'off'}`;
    });
    this.ctx.bus.on(Topics.SymbolSelected, (p: any) => {
      $('#stSymbol').textContent = `${p?.code ?? ''} ${p?.name ?? ''}`.trim() || '-';
    });
    this.ctx.bus.on(Topics.Log, (r: any) => {
      const lv = r?.level ?? 'info';
      if (lv === 'debug') return;
      $('#stLast').textContent = String(r?.msg ?? '').slice(0, 90);
    });
  }

  /* ---------- 명령 팔레트 ---------- */
  private showPalette(): void {
    if (this.palette) { this.palette.remove(); this.palette = undefined; }
    const wrap = document.createElement('div');
    wrap.className = 'pal-mask';
    wrap.innerHTML = `
      <div class="pal">
        <input class="pal-input" id="palQ" placeholder="명령 또는 TR 검색…" spellcheck="false">
        <div class="pal-list" id="palL"></div>
      </div>`;
    document.body.appendChild(wrap);
    this.palette = wrap;

    const input = wrap.querySelector('#palQ') as HTMLInputElement;
    const list = wrap.querySelector('#palL') as HTMLElement;
    let sel = 0;
    let items = this.ctx.commands.search('');

    const paint = () => {
      items = this.ctx.commands.search(input.value).slice(0, 200);
      if (sel >= items.length) sel = Math.max(0, items.length - 1);
      list.innerHTML = items.map((c, i) => `
        <div class="pal-row ${i === sel ? 'on' : ''}" data-i="${i}">
          <span class="pal-t">${this.escape(c.title)}</span>
          <span class="pal-c">${this.escape(c.category ?? '')}</span>
          ${c.keybinding ? `<span class="pal-k">${this.escape(c.keybinding)}</span>` : ''}
        </div>`).join('') || `<div class="pal-empty">일치하는 명령이 없습니다.</div>`;
      list.querySelectorAll<HTMLElement>('[data-i]').forEach(r =>
        r.addEventListener('click', () => { sel = Number(r.dataset.i); pick(); }));
      list.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' });
    };
    const close = () => { wrap.remove(); this.palette = undefined; };
    const pick = () => { const c = items[sel]; close(); if (c) this.ctx.commands.execute(c.id); };

    input.addEventListener('input', () => { sel = 0; paint(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

    paint();
    input.focus();
  }

  private escape(s: string): string {
    return String(s ?? '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }
}

export default Workbench;
