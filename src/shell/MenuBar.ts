// MenuBar.ts
import type { AppContext } from '../core/context';

const MENUS = [
  { label: '파일', items: [
    { label: '레이아웃 저장', cmd: 'layout.save' },
    { label: '레이아웃 초기화', cmd: 'layout.reset' } ] },
  { label: '조회', items: [
    { label: '주식기본정보 (ka10001)', cmd: 'form.open', arg: 'stockInfo' },
    { label: '차트', cmd: 'form.open', arg: 'chart' },
    { label: '조건검색', cmd: 'form.open', arg: 'condition' } ] },
  { label: '주문', items: [
    { label: '주문창', cmd: 'form.open', arg: 'order' },
    { label: '자동매매', cmd: 'form.open', arg: 'autotrade' } ] },
  { label: '보기', items: [
    { label: '명령 팔레트  Ctrl+Shift+P', cmd: 'palette.show' },
    { label: '출력 패널', cmd: 'form.open', arg: 'output' } ] }
];

export class MenuBar {
  constructor(private ctx: AppContext) {}
  mount(host: HTMLElement) {
    host.innerHTML = `
      <div class="title-left">
        <span class="brand"><i class="codicon codicon-graph-scatter"></i> Kiwoom Desk</span>
        ${MENUS.map((m, i) => `<div class="menu" data-i="${i}"><span>${m.label}</span>
          <div class="menu-pop">${m.items.map(it =>
            `<div class="menu-item" data-cmd="${it.cmd}" data-arg="${(it as any).arg ?? ''}">${it.label}</div>`).join('')}
          </div></div>`).join('')}
      </div>
      <div class="title-center" id="titleCenter">Kiwoom Desk</div>
      <div class="title-right"><span id="connChip" class="chip">미접속</span></div>`;

    host.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
      if (!item) return;
      const arg = item.dataset.arg;
      void this.ctx.commands.execute(item.dataset.cmd!, arg || undefined);
    });
    this.ctx.bus.on('dock.activeChanged', (p: any) => {
      const el = host.querySelector('#titleCenter')!;
      el.textContent = p?.title ? `${p.title} — Kiwoom Desk` : 'Kiwoom Desk';
    });
  }
}
