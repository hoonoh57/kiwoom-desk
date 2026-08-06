import type { AppContext } from '../core/context';
import { API_TREE, searchTr, type TreeNode, type FlatTr } from '../api/endpoints';

export class SideBar {
  private el: HTMLElement;
  private listEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private query = '';
  private open = new Set<string>();

  constructor(private ctx: AppContext) {
    this.el = document.createElement('div');
    this.el.className = 'sidebar';
    API_TREE.forEach(n => { if (n.expanded) this.open.add(n.label); });
    this.build();
  }

  /** Workbench 가 element 를 직접 쓰는 경우 */
  render(): HTMLElement { return this.el; }
  get element(): HTMLElement { return this.el; }

  /** Workbench 가 host 에 붙이는 경우 */
  mount(host: HTMLElement): HTMLElement {
    host.appendChild(this.el);
    return this.el;
  }

  private build(): void {
    this.el.innerHTML = `
      <div class="sb-title">탐색기</div>
      <div class="sb-search">
        <input id="sbQ" type="text" placeholder="TR 검색 (ka10001, 일봉, 계좌…)" spellcheck="false">
      </div>
      <div class="sb-list" id="sbList"></div>`;

    this.searchEl = this.el.querySelector('#sbQ') as HTMLInputElement;
    this.listEl = this.el.querySelector('#sbList') as HTMLElement;

    this.searchEl.addEventListener('input', () => {
      this.query = this.searchEl.value;
      this.paint();
    });
    this.searchEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.searchEl.value = ''; this.query = ''; this.paint(); }
      if (e.key === 'Enter') {
        const first = this.listEl.querySelector<HTMLElement>('.sb-leaf');
        first?.click();
      }
    });

    this.paint();
  }

  private paint(): void {
    this.listEl.innerHTML = this.query.trim()
      ? this.paintSearch(searchTr(this.query))
      : API_TREE.map(n => this.paintNode(n, 0)).join('');
    this.bind();
  }

  private paintSearch(hits: FlatTr[]): string {
    if (!hits.length) return `<div class="sb-empty">일치하는 TR 이 없습니다.</div>`;
    return `<div class="sb-hint">${hits.length}건</div>` + hits.map(h => `
      <div class="sb-row sb-leaf" data-api="${this.esc(h.apiId)}" data-form="${this.esc(h.formId)}"
           style="padding-left:14px" title="${this.esc(h.path)}">
        <span class="sb-code">${this.esc(h.apiId)}</span>
        <span class="sb-name">${this.esc(h.name)}</span>
        <span class="sb-grp">${this.esc(h.group)}</span>
      </div>`).join('');
  }

  private paintNode(n: TreeNode, depth: number): string {
    const pad = 8 + depth * 12;
    if (n.children?.length) {
      const isOpen = this.open.has(n.label);
      return `
        <div class="sb-row sb-group" data-group="${this.esc(n.label)}" style="padding-left:${pad}px">
          <span class="sb-arrow">${isOpen ? '▾' : '▸'}</span>
          <span class="sb-name">${this.esc(n.label)}</span>
          <span class="sb-cnt">${n.children.length}</span>
        </div>
        ${isOpen ? n.children.map(c => this.paintNode(c, depth + 1)).join('') : ''}`;
    }
    return `
      <div class="sb-row sb-leaf" style="padding-left:${pad + 14}px"
           data-api="${this.esc(n.apiId ?? '')}" data-form="${this.esc(n.formId ?? 'trRunner')}"
           title="${this.esc(n.path ?? '')}">
        ${n.apiId ? `<span class="sb-code">${this.esc(n.apiId)}</span>` : ''}
        <span class="sb-name">${this.esc(n.label)}</span>
      </div>`;
  }

  private bind(): void {
    this.listEl.querySelectorAll<HTMLElement>('.sb-group').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.group!;
        this.open.has(key) ? this.open.delete(key) : this.open.add(key);
        this.paint();
      });
    });

    this.listEl.querySelectorAll<HTMLElement>('.sb-leaf').forEach(row => {
      row.addEventListener('click', () => {
        const apiId = row.dataset.api || undefined;
        const formId = row.dataset.form || 'trRunner';
        this.openForm(formId, apiId);
      });
    });
  }

  private openForm(formId: string, apiId?: string): void {
    const dock: any = (this.ctx as any).dock;
    if (!dock?.open) { this.ctx.log.error('DockService 가 준비되지 않았습니다.'); return; }
    // 같은 TR 은 하나의 패널로 재사용
    const key = apiId ? `${formId}:${apiId}` : formId;
    dock.open(formId, apiId ? { apiId } : undefined, { key });
    this.ctx.log.info(`패널 열기: ${key}`);
  }

  private esc(s: string): string {
    return String(s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }
}

export default SideBar;
