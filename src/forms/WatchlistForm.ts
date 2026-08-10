import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';
import { WatchlistClient, WatchlistConflictError } from '../api/WatchlistClient';
import {
  createWatchlistGroup,
  normalizeWatchlistCode,
  normalizeWatchlistDocument,
  type WatchlistDocument,
  type WatchlistGroup,
  type WatchlistItem,
} from '../watchlists/model';
import { upsertWatchlistCandidate } from '../watchlists/mutations';
import {
  WATCHLIST_COLUMNS,
  defaultWatchlistViewConfig,
  latestWatchlistOrigin,
  normalizeWatchlistViewConfig,
  returnSinceAddedPct,
  sortWatchlistItems,
  watchlistOriginLabel,
  type WatchlistColumnDef,
  type WatchlistColumnId,
  type WatchlistQuoteView,
  type WatchlistViewConfig,
} from '../watchlists/view';
import './WatchlistForm.css';

const ACTIVE_GROUP_KEY = 'kiwoom-desk.watchlist.active-group.v1';
const VIEW_KEY = 'kiwoom-desk.watchlist.view.v1';

interface QuoteSnapshot extends WatchlistQuoteView {
  code: string;
  name: string;
  error?: string;
}

export class WatchlistForm extends ChildForm {
  private readonly client = new WatchlistClient();
  private document: WatchlistDocument = normalizeWatchlistDocument({});
  private activeGroupId = '';
  private quotes = new Map<string, QuoteSnapshot>();
  private view: WatchlistViewConfig = defaultWatchlistViewConfig();
  private propertiesOpen = false;
  private loading = true;
  private saving = false;
  private quoteBusy = false;
  private message = '';
  private abort?: AbortController;

  protected onInit(): void {
    this.setTitle('관심종목');
    this.activeGroupId = localStorage.getItem(ACTIVE_GROUP_KEY) ?? '';
    this.view = this.loadView();
    this.abort = new AbortController();
    this.track(() => this.abort?.abort());
    this.render();
    void this.load();
  }

  private loadView(): WatchlistViewConfig {
    try {
      return normalizeWatchlistViewConfig(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null'));
    } catch {
      return defaultWatchlistViewConfig();
    }
  }

  private saveView(): void {
    this.view = normalizeWatchlistViewConfig(this.view);
    localStorage.setItem(VIEW_KEY, JSON.stringify(this.view));
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.render();
    try {
      this.document = await this.client.load(this.abort?.signal);
      this.ensureActiveGroup();
      this.message = `schema v${this.document.schemaVersion} · 저장 revision ${this.document.revision}`;
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      this.message = `관심종목 조회 실패: ${error?.message ?? error}`;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private ensureActiveGroup(): WatchlistGroup {
    let group = this.document.groups.find(x => x.id === this.activeGroupId);
    if (!group) group = this.document.groups[0];
    this.activeGroupId = group.id;
    localStorage.setItem(ACTIVE_GROUP_KEY, group.id);
    return group;
  }

  private activeGroup(): WatchlistGroup {
    return this.ensureActiveGroup();
  }

  private cloneGroups(): WatchlistGroup[] {
    return this.document.groups.map(group => ({
      ...group,
      items: group.items.map(item => ({
        ...item,
        origins: item.origins.map(origin => ({ ...origin })),
      })),
    }));
  }

  private async saveGroups(groups: WatchlistGroup[], successMessage: string): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    this.render();
    try {
      this.document = await this.client.save(this.document.revision, groups, this.abort?.signal);
      this.ensureActiveGroup();
      this.message = successMessage;
      const itemCount = this.document.groups.reduce((sum, group) => sum + group.items.length, 0);
      this.ctx.bus.emit(Topics.WatchlistChanged, {
        source: this.formKey,
        revision: this.document.revision,
        groups: this.document.groups.length,
        items: itemCount,
      });
      return true;
    } catch (error: any) {
      if (error?.name === 'AbortError') return false;
      if (error instanceof WatchlistConflictError) {
        this.document = error.current;
        this.ensureActiveGroup();
        this.message = '다른 화면의 관심종목 변경을 감지해 최신 목록을 다시 불러왔습니다. 작업을 다시 시도하세요.';
      } else {
        this.message = `저장 실패: ${error?.message ?? error}`;
      }
      return false;
    } finally {
      this.saving = false;
      this.render();
    }
  }

  private render(): void {
    const group = this.activeGroup();
    const disabled = this.loading || this.saving ? 'disabled' : '';
    this.html(`
      <div class="watch-form">
        <div class="watch-bar">
          <select class="input watch-group" id="wGroup" ${disabled}>
            ${this.document.groups.map(g => `<option value="${this.esc(g.id)}" ${g.id === group.id ? 'selected' : ''}>${this.esc(g.name)} (${g.items.length})</option>`).join('')}
          </select>
          <button class="btn" data-action="group-add" ${disabled}>+ 그룹</button>
          <button class="btn" data-action="group-rename" ${disabled}>이름변경</button>
          <button class="btn" data-action="group-up" ${disabled}>↑</button>
          <button class="btn" data-action="group-down" ${disabled}>↓</button>
          <button class="btn" data-action="group-delete" ${disabled}>그룹삭제</button>
          <span class="tr-flex"></span>
          <button class="btn ${this.propertiesOpen ? 'primary' : ''}" id="wProperties">표시/정렬</button>
          <button class="btn" id="wReload" ${this.loading ? 'disabled' : ''}>목록 다시읽기</button>
          <button class="btn primary" id="wQuote" ${this.quoteBusy || this.loading ? 'disabled' : ''}>${this.quoteBusy ? '시세 조회중…' : '시세 새로고침'}</button>
        </div>

        <div class="watch-add">
          <input class="input mono" id="wCode" placeholder="종목코드 (005930 / 005930_AL)" ${disabled}>
          <input class="input" id="wName" placeholder="종목명 (비우면 ka10001로 확인)" ${disabled}>
          <button class="btn primary" id="wAdd" ${disabled}>추가</button>
          <span class="watch-help">행 클릭: 종목 선택 · 더블클릭: 일봉 차트 · 수동 추가는 등록가/등록시각을 함께 보존</span>
        </div>

        <div class="watch-msg ${/실패|충돌|감지/.test(this.message) ? 'warn' : ''}" id="wMsg">${this.esc(this.message)}</div>
        <div class="watch-content">
          <div class="watch-body">${this.renderTable(group)}</div>
          ${this.propertiesOpen ? this.renderProperties() : ''}
        </div>
      </div>`);

    this.$<HTMLSelectElement>('#wGroup')?.addEventListener('change', event => {
      this.activeGroupId = (event.target as HTMLSelectElement).value;
      localStorage.setItem(ACTIVE_GROUP_KEY, this.activeGroupId);
      this.render();
    });
    this.$('#wProperties')?.addEventListener('click', () => {
      this.propertiesOpen = !this.propertiesOpen;
      this.render();
    });
    this.$('#wReload')?.addEventListener('click', () => void this.load());
    this.$('#wQuote')?.addEventListener('click', () => void this.refreshQuotes());
    this.$('#wAdd')?.addEventListener('click', () => void this.addItem());
    this.$<HTMLInputElement>('#wCode')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') void this.addItem();
    });

    this.$$<HTMLElement>('[data-action]').forEach(button => button.addEventListener('click', event => {
      const action = (event.currentTarget as HTMLElement).dataset.action ?? '';
      void this.handleAction(action, (event.currentTarget as HTMLElement).dataset.code ?? '');
    }));

    this.$$<HTMLInputElement>('[data-note]').forEach(input => input.addEventListener('change', () => {
      void this.updateNote(input.dataset.note ?? '', input.value);
    }));

    this.$$<HTMLTableRowElement>('tr[data-code]').forEach(row => {
      row.addEventListener('click', event => {
        if ((event.target as HTMLElement).closest('button,input,select,label')) return;
        const item = group.items.find(x => x.code === row.dataset.code);
        if (item) this.selectSymbol(item);
      });
      row.addEventListener('dblclick', event => {
        if ((event.target as HTMLElement).closest('button,input,select,label')) return;
        const item = group.items.find(x => x.code === row.dataset.code);
        if (item) this.openChart(item);
      });
    });

    this.bindProperties();
  }

  private renderProperties(): string {
    const visible = new Set(this.view.visibleColumns);
    const sortable = WATCHLIST_COLUMNS.filter(column => column.sortable);
    return `<aside class="watch-properties">
      <div class="watch-prop-title">관심종목 표시 속성</div>
      <div class="watch-prop-section">
        <div class="watch-prop-head">표시 컬럼</div>
        ${WATCHLIST_COLUMNS.map(column => `
          <label class="watch-prop-row">
            <input type="checkbox" data-watch-column="${column.id}" ${visible.has(column.id) ? 'checked' : ''}>
            <span>${this.esc(column.label)}</span>
          </label>`).join('')}
      </div>
      <div class="watch-prop-section">
        <div class="watch-prop-head">정렬</div>
        <label class="watch-prop-field"><span>기준</span>
          <select class="input" id="wSort">
            <option value="" ${this.view.sort ? '' : 'selected'}>수동 순서</option>
            ${sortable.map(column => `<option value="${column.id}" ${this.view.sort?.column === column.id ? 'selected' : ''}>${this.esc(column.label)}</option>`).join('')}
          </select>
        </label>
        <label class="watch-prop-field"><span>방향</span>
          <select class="input" id="wSortDir" ${this.view.sort ? '' : 'disabled'}>
            <option value="desc" ${this.view.sort?.direction === 'desc' ? 'selected' : ''}>내림차순</option>
            <option value="asc" ${this.view.sort?.direction === 'asc' ? 'selected' : ''}>오름차순</option>
          </select>
        </label>
        <div class="watch-prop-note">화면 정렬은 저장된 수동 순서를 변경하지 않습니다.</div>
      </div>
      <button class="btn" id="wViewReset">표시 기본값 복원</button>
    </aside>`;
  }

  private bindProperties(): void {
    if (!this.propertiesOpen) return;
    this.$$<HTMLInputElement>('[data-watch-column]').forEach(input => input.addEventListener('change', () => {
      const column = input.dataset.watchColumn as WatchlistColumnId;
      const visible = new Set(this.view.visibleColumns);
      input.checked ? visible.add(column) : visible.delete(column);
      this.view = normalizeWatchlistViewConfig({ ...this.view, visibleColumns: Array.from(visible) });
      this.saveView();
      this.render();
    }));

    this.$<HTMLSelectElement>('#wSort')?.addEventListener('change', event => {
      const column = (event.target as HTMLSelectElement).value as WatchlistColumnId | '';
      this.view = {
        ...this.view,
        sort: column ? { column, direction: this.view.sort?.direction ?? 'desc' } : null,
      };
      this.saveView();
      this.render();
    });
    this.$<HTMLSelectElement>('#wSortDir')?.addEventListener('change', event => {
      if (!this.view.sort) return;
      this.view = {
        ...this.view,
        sort: { ...this.view.sort, direction: (event.target as HTMLSelectElement).value === 'asc' ? 'asc' : 'desc' },
      };
      this.saveView();
      this.render();
    });
    this.$('#wViewReset')?.addEventListener('click', () => {
      this.view = defaultWatchlistViewConfig();
      this.saveView();
      this.render();
    });
  }

  private visibleColumns(): WatchlistColumnDef[] {
    const visible = new Set(this.view.visibleColumns);
    return WATCHLIST_COLUMNS.filter(column => visible.has(column.id));
  }

  private renderTable(group: WatchlistGroup): string {
    if (this.loading) return `<div class="loading">관심종목을 불러오는 중…</div>`;
    if (!group.items.length) {
      return `<div class="tr-empty">이 그룹에 종목이 없습니다. 위 입력란에서 종목코드를 추가하세요.</div>`;
    }

    const columns = this.visibleColumns();
    const rows = sortWatchlistItems(group.items, this.view, code => this.quotes.get(code));
    return `<div class="grid-wrap watch-grid-wrap"><table class="grid watch-grid">
      <thead><tr>${columns.map(column => this.renderHeader(column)).join('')}</tr></thead>
      <tbody>${rows.map((item, index) => this.renderRow(item, index, columns)).join('')}</tbody>
    </table></div>`;
  }

  private renderHeader(column: WatchlistColumnDef): string {
    const sorted = this.view.sort?.column === column.id
      ? (this.view.sort.direction === 'asc' ? ' ▲' : ' ▼')
      : '';
    const width = column.width ? ` style="min-width:${column.width}px"` : '';
    return `<th${width}>${this.esc(column.label)}${sorted}</th>`;
  }

  private renderRow(item: WatchlistItem, index: number, columns: WatchlistColumnDef[]): string {
    const quote = this.quotes.get(item.code);
    const title = quote?.error ? ` title="${this.esc(quote.error)}"` : '';
    return `<tr class="clickable" data-code="${this.esc(item.code)}"${title}>
      ${columns.map(column => this.renderCell(column.id, item, index)).join('')}
    </tr>`;
  }

  private renderCell(column: WatchlistColumnId, item: WatchlistItem, index: number): string {
    const quote = this.quotes.get(item.code);
    const rate = quote?.rate ?? 0;
    const marketSign = rate > 0 ? 'up' : rate < 0 ? 'dn' : '';
    const registrationReturn = returnSinceAddedPct(item, quote);
    const registrationSign = (registrationReturn ?? 0) > 0 ? 'up' : (registrationReturn ?? 0) < 0 ? 'dn' : '';
    const name = item.name || quote?.name || '';
    const origin = latestWatchlistOrigin(item);

    switch (column) {
      case 'row': return `<td>${index + 1}</td>`;
      case 'code': return `<td class="mono">${this.esc(item.code)}</td>`;
      case 'name': return `<td class="watch-name">${this.esc(name)}</td>`;
      case 'currentPrice': return `<td class="${marketSign}">${quote ? this.fmt(quote.price) : ''}</td>`;
      case 'change': return `<td class="${marketSign}">${quote ? this.fmt(quote.change) : ''}</td>`;
      case 'changeRate': return `<td class="${marketSign}">${quote ? quote.rate.toFixed(2) : ''}</td>`;
      case 'volume': return `<td>${quote ? this.fmt(quote.volume) : ''}</td>`;
      case 'addedAt': return `<td>${this.esc(this.formatDateTime(item.addedAt))}</td>`;
      case 'addedPrice': return `<td>${item.addedPrice ? this.fmt(item.addedPrice) : ''}</td>`;
      case 'returnSinceAddedPct': return `<td class="${registrationSign}">${registrationReturn === undefined ? '' : registrationReturn.toFixed(2)}</td>`;
      case 'source': return `<td class="watch-source" title="${this.esc(this.originHistoryTitle(item))}">${this.esc(watchlistOriginLabel(origin))}</td>`;
      case 'sourceCapturedAt': return `<td>${origin ? this.esc(this.formatDateTime(origin.capturedAt)) : ''}</td>`;
      case 'note': return `<td><input class="input watch-note" data-note="${this.esc(item.code)}" value="${this.esc(item.note)}" maxlength="240"></td>`;
      case 'actions': {
        const sorted = !!this.view.sort;
        const disabled = sorted ? 'disabled' : '';
        const title = sorted ? '화면 정렬 중에는 수동 순서 변경을 잠급니다.' : '';
        return `<td class="watch-actions">
          <button class="mini" data-action="item-up" data-code="${this.esc(item.code)}" ${disabled} title="${title || '위로'}">↑</button>
          <button class="mini" data-action="item-down" data-code="${this.esc(item.code)}" ${disabled} title="${title || '아래로'}">↓</button>
          <button class="mini danger" data-action="item-delete" data-code="${this.esc(item.code)}" title="삭제">×</button>
        </td>`;
      }
      default: return '<td></td>';
    }
  }

  private formatDateTime(value: string): string {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return '';
    return new Date(time).toLocaleString('ko-KR', {
      year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  private originHistoryTitle(item: WatchlistItem): string {
    return item.origins
      .map(origin => `${watchlistOriginLabel(origin)} · ${this.formatDateTime(origin.capturedAt)}${origin.capturedPrice ? ` · ${this.fmt(origin.capturedPrice)}` : ''}`)
      .join('\n');
  }

  private async handleAction(action: string, code: string): Promise<void> {
    if (this.saving || this.loading) return;
    if (action === 'group-add') return void this.addGroup();
    if (action === 'group-rename') return void this.renameGroup();
    if (action === 'group-delete') return void this.deleteGroup();
    if (action === 'group-up') return void this.moveGroup(-1);
    if (action === 'group-down') return void this.moveGroup(1);
    if (action === 'item-up') return void this.moveItem(code, -1);
    if (action === 'item-down') return void this.moveItem(code, 1);
    if (action === 'item-delete') return void this.deleteItem(code);
  }

  private async addGroup(): Promise<void> {
    const name = prompt('새 관심종목 그룹 이름', '새 그룹')?.trim();
    if (!name) return;
    const groups = this.cloneGroups();
    const group = createWatchlistGroup(name);
    group.order = groups.length;
    groups.push(group);
    if (await this.saveGroups(groups, `그룹 '${name}'을 추가했습니다.`)) {
      this.activeGroupId = group.id;
      localStorage.setItem(ACTIVE_GROUP_KEY, group.id);
      this.render();
    }
  }

  private async renameGroup(): Promise<void> {
    const current = this.activeGroup();
    const name = prompt('그룹 이름 변경', current.name)?.trim();
    if (!name || name === current.name) return;
    const groups = this.cloneGroups();
    const target = groups.find(x => x.id === current.id);
    if (!target) return;
    target.name = name;
    await this.saveGroups(groups, `그룹 이름을 '${name}'으로 변경했습니다.`);
  }

  private async deleteGroup(): Promise<void> {
    const current = this.activeGroup();
    if (this.document.groups.length <= 1) {
      this.message = '마지막 그룹은 삭제할 수 없습니다.';
      this.render();
      return;
    }
    if (!confirm(`'${current.name}' 그룹과 종목 ${current.items.length}개를 삭제할까요?`)) return;
    const groups = this.cloneGroups().filter(x => x.id !== current.id);
    this.activeGroupId = groups[0]?.id ?? '';
    await this.saveGroups(groups, `'${current.name}' 그룹을 삭제했습니다.`);
  }

  private async moveGroup(delta: number): Promise<void> {
    const groups = this.cloneGroups();
    const index = groups.findIndex(x => x.id === this.activeGroupId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= groups.length) return;
    [groups[index], groups[next]] = [groups[next], groups[index]];
    await this.saveGroups(groups, '그룹 순서를 변경했습니다.');
  }

  private async addItem(): Promise<void> {
    if (this.saving) return;
    const codeInput = this.$<HTMLInputElement>('#wCode');
    const nameInput = this.$<HTMLInputElement>('#wName');
    const code = normalizeWatchlistCode(codeInput?.value);
    if (!code) {
      this.message = '종목코드를 입력하세요.';
      this.render();
      return;
    }
    const current = this.activeGroup();
    if (current.items.some(x => x.code === code)) {
      this.message = `${code}는 이미 '${current.name}' 그룹에 있습니다.`;
      this.render();
      return;
    }

    // 수동 등록도 한 번의 ka10001 조회로 종목명과 등록 당시 가격을 함께 확보한다.
    // 실패하더라도 관심종목 자체는 추가하고 addedPrice만 비워 둔다.
    const existingQuote = this.quotes.get(code);
    const quote = existingQuote?.price ? existingQuote : await this.fetchQuote(code);
    if (quote && !quote.error) this.quotes.set(code, quote);
    const name = nameInput?.value.trim() || quote?.name || '';
    const capturedAt = new Date().toISOString();
    const result = upsertWatchlistCandidate(this.cloneGroups(), current.id, {
      code,
      name,
      capturedAt,
      capturedPrice: quote && !quote.error ? quote.price : undefined,
      source: { type: 'manual', label: '수동' },
    });

    const ok = await this.saveGroups(result.groups, `${code}${name ? ` ${name}` : ''} 추가`);
    if (ok) {
      const nextCode = this.$<HTMLInputElement>('#wCode');
      const nextName = this.$<HTMLInputElement>('#wName');
      if (nextCode) nextCode.value = '';
      if (nextName) nextName.value = '';
      nextCode?.focus();
    }
  }

  private async deleteItem(code: string): Promise<void> {
    const current = this.activeGroup();
    const item = current.items.find(x => x.code === code);
    if (!item) return;
    if (!confirm(`${code}${item.name ? ` ${item.name}` : ''}을(를) 관심종목에서 삭제할까요?`)) return;
    const groups = this.cloneGroups();
    const target = groups.find(x => x.id === current.id);
    if (!target) return;
    target.items = target.items.filter(x => x.code !== code);
    if (await this.saveGroups(groups, `${code} 삭제`)) this.quotes.delete(code);
  }

  private async moveItem(code: string, delta: number): Promise<void> {
    if (this.view.sort) return;
    const current = this.activeGroup();
    const groups = this.cloneGroups();
    const target = groups.find(x => x.id === current.id);
    if (!target) return;
    const index = target.items.findIndex(x => x.code === code);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= target.items.length) return;
    [target.items[index], target.items[next]] = [target.items[next], target.items[index]];
    await this.saveGroups(groups, '종목 순서를 변경했습니다.');
  }

  private async updateNote(code: string, note: string): Promise<void> {
    const current = this.activeGroup();
    const groups = this.cloneGroups();
    const target = groups.find(x => x.id === current.id);
    const item = target?.items.find(x => x.code === code);
    if (!item || item.note === note.trim()) return;
    item.note = note.trim().slice(0, 240);
    await this.saveGroups(groups, `${code} 메모 저장`);
  }

  private async refreshQuotes(): Promise<void> {
    if (this.quoteBusy) return;
    const items = [...this.activeGroup().items];
    if (!items.length) return;
    this.quoteBusy = true;
    this.message = `시세 조회 0 / ${items.length}`;
    this.render();
    try {
      for (let i = 0; i < items.length; i++) {
        const quote = await this.fetchQuote(items[i].code);
        if (quote) this.quotes.set(items[i].code, quote);
        this.message = `시세 조회 ${i + 1} / ${items.length}`;
        this.render();
      }
      this.message = `시세 ${items.length}종목 조회 완료 · 자동 반복조회는 하지 않습니다.`;
    } finally {
      this.quoteBusy = false;
      this.render();
    }
  }

  private async fetchQuote(code: string): Promise<QuoteSnapshot | null> {
    try {
      const res = await this.ctx.api.call<any>('ka10001', '/api/dostk/stkinfo', { stk_cd: code }, { signal: this.abort?.signal });
      const body = res.body ?? {};
      if (!res.ok) {
        return {
          code,
          name: '',
          price: 0,
          change: 0,
          rate: 0,
          volume: 0,
          error: `ka10001 rc=${res.returnCode ?? '-'} ${res.returnMsg ?? ''}`.trim(),
        };
      }
      return {
        code,
        name: String(body.stk_nm ?? body.name ?? '').trim(),
        price: Math.abs(this.num(body.cur_prc ?? body.cur_pric ?? body.now_prc)),
        change: this.num(body.pred_pre ?? body.change ?? body.diff),
        rate: this.num(body.flu_rt ?? body.change_rt ?? body.rate),
        volume: Math.abs(this.num(body.trde_qty ?? body.volume)),
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') return null;
      return { code, name: '', price: 0, change: 0, rate: 0, volume: 0, error: String(error?.message ?? error) };
    }
  }

  private selectSymbol(item: WatchlistItem): void {
    const quote = this.quotes.get(item.code);
    const name = item.name || quote?.name || '';
    this.ctx.state.symbol = { code: item.code, name };
    this.ctx.bus.emit(Topics.SymbolSelected, { source: this.formKey, code: item.code, name });
  }

  private openChart(item: WatchlistItem): void {
    this.selectSymbol(item);
    this.ctx.dock?.open('chart', { apiId: 'ka10081', code: item.code }, {});
  }
}

export default WatchlistForm;
