import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

type TabId = 'balance' | 'deposit' | 'pending' | 'filled' | 'profit';

interface TabDef { id: TabId; label: string; apiId: string; body: Record<string, string>; listKey?: string; }

const TABS: TabDef[] = [
  { id: 'balance', label: '잔고', apiId: 'kt00018', listKey: 'acnt_evlt_remn_indv_tot',
    body: { qry_tp: '1', dmst_stex_tp: 'KRX' } },
  { id: 'deposit', label: '예수금', apiId: 'kt00001', body: { qry_tp: '3' } },
  { id: 'pending', label: '미체결', apiId: 'ka10075', listKey: 'oso',
    body: { all_stk_tp: '0', trde_tp: '0', stex_tp: '0' } },
  { id: 'filled', label: '체결', apiId: 'ka10076', listKey: 'cntr',
    body: { qry_tp: '0', sell_tp: '0', stex_tp: '0' } },
  { id: 'profit', label: '수익률', apiId: 'ka10085', listKey: 'acnt_prft_rt',
    body: { stex_tp: '0' } },
];

const LABEL: Record<string, string> = {
  stk_cd: '종목코드', stk_nm: '종목명', rmnd_qty: '보유수량', trde_able_qty: '매도가능',
  pur_pric: '매입가', cur_prc: '현재가', pur_amt: '매입금액', evlt_amt: '평가금액',
  evltv_prft: '평가손익', prft_rt: '수익률(%)', poss_rt: '비중(%)', pred_close_pric: '전일종가',
  ord_no: '주문번호', ord_qty: '주문수량', ord_pric: '주문가격', oso_qty: '미체결수량',
  io_tp_nm: '주문구분', ord_stt: '상태', tm: '시간', cntr_qty: '체결량', cntr_pric: '체결가',
  orig_ord_no: '원주문', trde_tp: '매매구분', sell_tp: '매도수구분', crd_tp_nm: '신용구분',
  entr: '예수금', profa_ch: '증거금현금', ord_alow_amt: '주문가능금액',
  tot_pur_amt: '총매입', tot_evlt_amt: '총평가', tot_evlt_pl: '총평가손익',
  tot_prft_rt: '총수익률(%)', prsm_dpst_aset_amt: '추정예탁자산',
};

export class AccountForm extends ChildForm {
  private tab: TabDef = TABS[0];
  private data: any = null;
  private busy = false;
  private timer?: number;
  private auto = false;

  protected onInit(): void {
    const wanted = this.params.apiId
      ? TABS.find(t => t.apiId === this.params.apiId)
      : TABS.find(t => t.id === this.params.tab);
    if (wanted) this.tab = wanted;
    this.setTitle('계좌');
    this.render();
    void this.load();
    this.track(() => { if (this.timer) window.clearInterval(this.timer); });
  }

  private render(): void {
    this.html(`
      <div class="acc-form">
        <div class="acc-bar">
          ${TABS.map(t => `<button class="tabx ${t.id === this.tab.id ? 'on' : ''}" data-t="${t.id}">${t.label}</button>`).join('')}
          <span class="tr-flex"></span>
          <span class="tr-badge">${this.esc(this.tab.apiId)}</span>
          <label class="chk"><input type="checkbox" id="aAuto" ${this.auto ? 'checked' : ''}> 10초 자동</label>
          <button class="btn primary" id="aGo">${this.busy ? '조회중…' : '새로고침'}</button>
        </div>
        <div class="acc-body" id="aBody"><div class="loading">조회중…</div></div>
      </div>`);

    this.$$('[data-t]').forEach(b => b.addEventListener('click', () => {
      this.tab = TABS.find(t => t.id === b.getAttribute('data-t'))!;
      this.data = null; this.render(); void this.load();
    }));
    this.$('#aGo')?.addEventListener('click', () => void this.load());
    this.$('#aAuto')?.addEventListener('change', e => {
      this.auto = (e.target as HTMLInputElement).checked;
      if (this.timer) { window.clearInterval(this.timer); this.timer = undefined; }
      if (this.auto) this.timer = window.setInterval(() => void this.load(), 10_000);
    });
  }

  private async load(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const res: any = await this.ctx.api.call(this.tab.apiId, '/api/dostk/acnt', this.tab.body, {});
      this.data = this.payload(res);
    } catch (e: any) {
      this.data = { return_code: -1, return_msg: String(e?.message ?? e) };
    } finally {
      this.busy = false;
      this.paint();
      const btn = this.$('#aGo'); if (btn) btn.textContent = '새로고침';
    }
  }

  private paint(): void {
    const host = this.$('#aBody'); if (!host) return;
    const d = this.data;
    if (!d) { host.innerHTML = `<div class="loading">조회중…</div>`; return; }
    if (d.return_code !== undefined && d.return_code !== 0) {
      host.innerHTML = `<div class="err">rc=${d.return_code} ${this.esc(d.return_msg)}</div>`;
      return;
    }

    const listKey = this.tab.listKey && Array.isArray(d[this.tab.listKey])
      ? this.tab.listKey
      : Object.keys(d).find(k => Array.isArray(d[k]) && d[k].length && typeof d[k][0] === 'object');

    const scalars = Object.entries(d)
      .filter(([k, v]) => typeof v !== 'object' && k !== 'return_code' && k !== 'return_msg');

    let html = '';
    if (scalars.length) {
      html += `<div class="acc-sum">${scalars.map(([k, v]) => {
        const n = this.num(v);
        const cls = /prft|pl$/.test(k) ? (n > 0 ? 'up' : n < 0 ? 'dn' : '') : '';
        const val = /amt|pric|prft|entr|ch$|qty|rt$/.test(k) ? this.fmt(v) : String(v);
        return `<div class="sum-cell"><span>${this.esc(LABEL[k] ?? k)}</span><b class="${cls}">${this.esc(val)}</b></div>`;
      }).join('')}</div>`;
    }

    if (listKey) {
      const rows: any[] = d[listKey];
      const cols = Object.keys(rows[0] ?? {});
      html += `<div class="tr-sub2">${this.esc(listKey)} · ${rows.length}건</div>
        <div class="grid-wrap"><table class="grid">
          <thead><tr>${cols.map(c => `<th>${this.esc(LABEL[c] ?? c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr data-i="${i}" class="clickable">${cols.map(c => {
            const n = this.num(r[c]);
            const cls = /prft|prft_rt|pl$/.test(c) ? (n > 0 ? 'up' : n < 0 ? 'dn' : '') : '';
            const isNum = /qty|pric|amt|prft|rt$/.test(c);
            return `<td class="${cls}">${this.esc(isNum ? this.fmt(r[c]) : (r[c] ?? ''))}</td>`;
          }).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
      host.innerHTML = html;

      this.$$('tr.clickable').forEach(tr => tr.addEventListener('click', () => {
        const row = rows[Number(tr.getAttribute('data-i'))];
        const code = String(row?.stk_cd ?? '').replace(/^A/, '').trim();
        if (!code) return;
        this.ctx.bus.emit(Topics.SymbolSelected, { source: this.formKey, code, name: row?.stk_nm ?? '' });
      }));
      return;
    }
    host.innerHTML = html || `<pre>${this.esc(JSON.stringify(d, null, 2))}</pre>`;
  }
}
