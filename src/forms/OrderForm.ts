import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

type Side = 'buy' | 'sell';

const TRDE_TP = [
  { v: '0', t: '보통(지정가)' }, { v: '3', t: '시장가' }, { v: '5', t: '조건부지정가' },
  { v: '6', t: '최유리지정가' }, { v: '7', t: '최우선지정가' }, { v: '10', t: '보통(IOC)' },
  { v: '13', t: '시장가(IOC)' }, { v: '20', t: '보통(FOK)' }, { v: '23', t: '시장가(FOK)' },
];

export class OrderForm extends ChildForm {
  private side: Side = 'buy';
  private code = '005930';
  private name = '';
  private qty = '1';
  private price = '';
  private trdeTp = '3';
  private stex = 'KRX';
  private pending: any[] = [];
  private busy = false;
  private lastMsg = '';

  protected onInit(): void {
    this.code = this.params.code ?? (this.ctx as any).state?.symbol?.code ?? '005930';
    if (this.params.side === 'sell' || this.params.apiId === 'kt10001') this.side = 'sell';
    this.setTitle('주문');
    this.render();
    void this.loadPending();

    const off = this.ctx.bus.onExcept(Topics.SymbolSelected, this.formKey, (p: any) => {
      if (!p?.code) return;
      this.code = p.code; this.name = p.name ?? '';
      const el = this.$<HTMLInputElement>('#oCode'); if (el) el.value = this.code;
      const nm = this.$('#oName'); if (nm) nm.textContent = this.name;
    });
    this.track(off);
  }

  private get mode(): string { return (this.ctx as any).state?.mode ?? '미접속'; }
  private get isMock(): boolean { return this.mode.includes('모의'); }

  private render(): void {
    this.html(`
      <div class="ord-form">
        <div class="ord-head ${this.side}">
          <button class="side buy ${this.side === 'buy' ? 'on' : ''}" data-s="buy">매수</button>
          <button class="side sell ${this.side === 'sell' ? 'on' : ''}" data-s="sell">매도</button>
          <span class="tr-flex"></span>
          <span class="mode-badge ${this.isMock ? 'mock' : 'real'}">${this.esc(this.mode)}</span>
        </div>

        <div class="ord-grid">
          <label>종목코드</label>
          <span class="fld-sym">
            <input id="oCode" value="${this.esc(this.code)}" maxlength="20" spellcheck="false">
            <span class="c-nm" id="oName">${this.esc(this.name)}</span>
          </span>

          <label>거래소</label>
          <select id="oStex">
            ${['KRX', 'NXT', 'SOR'].map(v => `<option ${v === this.stex ? 'selected' : ''}>${v}</option>`).join('')}
          </select>

          <label>매매구분</label>
          <select id="oType">
            ${TRDE_TP.map(t => `<option value="${t.v}" ${t.v === this.trdeTp ? 'selected' : ''}>${t.v}:${t.t}</option>`).join('')}
          </select>

          <label>수량</label>
          <input id="oQty" value="${this.esc(this.qty)}" inputmode="numeric" maxlength="12">

          <label>단가</label>
          <input id="oPrice" value="${this.esc(this.price)}" inputmode="numeric" maxlength="12"
                 placeholder="시장가는 비워두세요">
        </div>

        <div class="ord-actions">
          <button class="btn ${this.side === 'buy' ? 'buy' : 'sell'}" id="oSend" ${this.busy ? 'disabled' : ''}>
            ${this.side === 'buy' ? '매수 주문' : '매도 주문'}
          </button>
          <span class="ord-msg ${this.lastMsg.startsWith('실패') ? 'dn' : 'up'}">${this.esc(this.lastMsg)}</span>
        </div>

        <div class="tr-sub">미체결 <span class="tr-flex"></span>
          <button class="lnk" id="oRefresh">새로고침</button></div>
        <div class="ord-pending" id="oPending"><div class="loading">조회중…</div></div>
      </div>`);

    this.$$('[data-s]').forEach(b => b.addEventListener('click', () => {
      this.side = b.getAttribute('data-s') as Side; this.pull(); this.render();
    }));
    ['#oCode', '#oQty', '#oPrice', '#oType', '#oStex'].forEach(sel =>
      this.$(sel)?.addEventListener('change', () => this.pull()));
    this.$('#oSend')?.addEventListener('click', () => void this.send());
    this.$('#oRefresh')?.addEventListener('click', () => void this.loadPending());
    this.paintPending();
  }

  private pull(): void {
    this.code = (this.$<HTMLInputElement>('#oCode')?.value ?? '').trim();
    this.qty = (this.$<HTMLInputElement>('#oQty')?.value ?? '').trim();
    this.price = (this.$<HTMLInputElement>('#oPrice')?.value ?? '').trim();
    this.trdeTp = this.$<HTMLSelectElement>('#oType')?.value ?? '3';
    this.stex = this.$<HTMLSelectElement>('#oStex')?.value ?? 'KRX';
  }

  private async send(): Promise<void> {
    this.pull();
    if (!this.code) { this.msg('실패: 종목코드를 입력하세요.'); return; }
    if (!this.qty || this.num(this.qty) <= 0) { this.msg('실패: 수량을 확인하세요.'); return; }
    const isMarket = ['3', '13', '23', '61', '81'].includes(this.trdeTp);
    if (!isMarket && !this.price) { this.msg('실패: 지정가 주문은 단가가 필요합니다.'); return; }

    const apiId = this.side === 'buy' ? 'kt10000' : 'kt10001';
    const body: Record<string, string> = {
      dmst_stex_tp: this.stex, stk_cd: this.code, ord_qty: this.qty, trde_tp: this.trdeTp,
    };
    if (!isMarket) body.ord_uv = this.price;

    const label = this.side === 'buy' ? '매수' : '매도';
    if (!confirm(`[${this.mode}] ${label} 주문\n\n종목 ${this.code}\n수량 ${this.qty}\n단가 ${isMarket ? '시장가' : this.price}\n\n실행할까요?`)) return;

    this.busy = true; this.msg('전송중…');
    try {
      const res: any = await this.ctx.api.call(apiId, '/api/dostk/ordr', body, {});
      const d = this.payload(res);
      if (d?.return_code === 0) {
        this.msg(`성공: 주문번호 ${d.ord_no ?? '-'}`);
        this.ctx.log.info(`${label}주문 성공 ${this.code} ${this.qty}주 (${d.ord_no ?? '-'})`);
        this.ctx.bus.emit(Topics.OrderFilled, { source: this.formKey, code: this.code, ordNo: d.ord_no });
        setTimeout(() => void this.loadPending(), 700);
      } else {
        this.msg(`실패: rc=${d?.return_code} ${d?.return_msg ?? ''}`);
      }
    } catch (e: any) {
      this.msg(`실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
    }
  }

  private async loadPending(): Promise<void> {
    try {
      const res: any = await this.ctx.api.call('ka10075', '/api/dostk/acnt',
        { all_stk_tp: '0', trde_tp: '0', stex_tp: '0' }, {});
      const d = this.payload(res);
      this.pending = Array.isArray(d?.oso) ? d.oso : [];
    } catch { this.pending = []; }
    this.paintPending();
  }

  private paintPending(): void {
    const host = this.$('#oPending'); if (!host) return;
    if (!this.pending.length) { host.innerHTML = `<div class="tr-empty">미체결 주문이 없습니다.</div>`; return; }
    host.innerHTML = `<div class="grid-wrap"><table class="grid">
      <thead><tr><th>주문번호</th><th>종목</th><th>구분</th><th>주문수량</th><th>미체결</th><th>주문가</th><th>취소</th></tr></thead>
      <tbody>${this.pending.map((o, i) => `<tr>
        <td>${this.esc(o.ord_no)}</td>
        <td style="text-align:left">${this.esc(o.stk_nm ?? o.stk_cd)}</td>
        <td>${this.esc(o.io_tp_nm ?? '')}</td>
        <td>${this.fmt(o.ord_qty)}</td>
        <td>${this.fmt(o.oso_qty)}</td>
        <td>${this.fmt(o.ord_pric)}</td>
        <td><button class="lnk dn" data-cancel="${i}">취소</button></td>
      </tr>`).join('')}</tbody></table></div>`;

    this.$$('[data-cancel]').forEach(b => b.addEventListener('click', () => {
      void this.cancel(this.pending[Number(b.getAttribute('data-cancel'))]);
    }));
  }

  private async cancel(o: any): Promise<void> {
    if (!o?.ord_no) return;
    if (!confirm(`주문 취소\n\n주문번호 ${o.ord_no}\n종목 ${o.stk_nm ?? o.stk_cd}\n잔량 ${o.oso_qty}\n\n전량 취소할까요?`)) return;
    try {
      const res: any = await this.ctx.api.call('kt10003', '/api/dostk/ordr', {
        dmst_stex_tp: this.stex,
        orig_ord_no: String(o.ord_no),
        stk_cd: String(o.stk_cd ?? '').replace(/^A/, ''),
        cncl_qty: '0',
      }, {});
      const d = this.payload(res);
      this.msg(d?.return_code === 0 ? `취소 접수: ${d.ord_no ?? ''}` : `실패: ${d?.return_msg ?? ''}`);
      setTimeout(() => void this.loadPending(), 700);
    } catch (e: any) {
      this.msg(`실패: ${e?.message ?? e}`);
    }
  }

  private msg(s: string): void {
    this.lastMsg = s;
    const el = this.$('.ord-msg');
    if (el) { el.textContent = s; el.className = `ord-msg ${s.startsWith('실패') ? 'dn' : 'up'}`; }
    const btn = this.$('#oSend') as HTMLButtonElement | null;
    if (btn) btn.disabled = this.busy;
  }
}
