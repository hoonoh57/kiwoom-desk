import type { AppContext } from '../core/context';

export interface ActivityItem { id: string; icon: string; tooltip: string; }

export const ACTIVITY_ITEMS: ActivityItem[] = [
  { id: 'explorer',  icon: 'codicon-list-tree',  tooltip: 'API 탐색기 (Ctrl+Shift+E)' },
  { id: 'watchlist', icon: 'codicon-star-full',  tooltip: '관심종목' },
  { id: 'condition', icon: 'codicon-filter',     tooltip: '조건검색' },
  { id: 'account',   icon: 'codicon-account',    tooltip: '계좌/잔고' },
  { id: 'autotrade', icon: 'codicon-rocket',     tooltip: '자동매매' },
  { id: 'settings',  icon: 'codicon-gear',       tooltip: '설정' }
];

export class ActivityBar {
  constructor(private ctx: AppContext, private onSelect: (id: string) => void) {}

  mount(host: HTMLElement) {
    host.innerHTML = ACTIVITY_ITEMS.map((it, i) => `
      <button class="act-btn ${i === 0 ? 'active' : ''}" data-id="${it.id}" title="${it.tooltip}">
        <i class="codicon ${it.icon}"></i>
      </button>`).join('');
    host.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.act-btn');
      if (!btn) return;
      host.querySelectorAll('.act-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.onSelect(btn.dataset.id!);
    });
  }
}
