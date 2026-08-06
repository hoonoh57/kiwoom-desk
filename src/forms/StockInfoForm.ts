import { ChildForm } from './ChildForm';
import { Topics, type SymbolPayload } from '../core/events';

export class StockInfoForm extends ChildForm {
  private lastLoaded = '';
  private busy = false;

  protected onInit(): void {
    const code = this.args.code ?? this.ctx.state.symbol.code;

    this.html(`
      <div class="form-toolbar">
        <label>종목코드</label>
        <input id="code" value="${code}" maxlength="7" />
        <button class="btn primary" id="go"><i class="codicon codicon-search"></i> 조회</button>
        <label class="chk"><input type="checkbox" id="sync" checked /> 종목 연동</label>
        <span class="spacer"></span>
        <span class="tr-badge">ka10001</span>
      </div>
      <div class="form-content">
        <div id="grid" class="kv-grid"></div>
      </div>`);

    this.$('#go').addEventListener('click', () => void this.load(true));
    this.$<HTMLInputElement>('#code').addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void this.load(true);
    });

    // 자기가 보낸 방송은 받지 않는다 (무한 루프 차단)
    this.track(this.ctx.bus.onExcept<SymbolPayload>(Topics.SymbolSelected, this.formKey, (s) => {
      if (!this.$<HTMLInputElement>('#sync').checked) return;
      if (!s.code || s.code === this.lastLoaded) return;
      this.$<HTMLInputElement>('#code').value = s.code;
      void this.load();
    }));

    void this.load();
  }

  private async load(force = false): Promise<void> {
    const code = this.$<HTMLInputElement>('#code').value.trim();
    if (!code || this.busy) return;
    if (!force && code === this.lastLoaded) return;   // 같은 종목 중복 조회 방지

    this.busy = true;
    this.$('#grid').innerHTML = `<div class="loading">조회 중…</div>`;

    try {
      const res = await this.ctx.api.call('ka10001', '/api/dostk/stkinfo', { stk_cd: code });
      if (!res.ok) {
        this.$('#grid').innerHTML =
          `<div class="err">[${res.returnCode ?? '-'}] ${res.returnMsg ?? '조회 실패'}</div>`;
        return;
      }

      this.lastLoaded = code;
      const b: any = res.body;
      const name = b.stk_nm ?? code;

      this.setTitle(`${name} (${code})`);
      this.ctx.state.symbol = { code, name };
      this.ctx.bus.emit<SymbolPayload>(Topics.SymbolSelected, { code, name, source: this.formKey });

      const rows: Array<[string, unknown]> = [
        ['종목명', b.stk_nm],   ['현재가', b.cur_prc],    ['전일대비', b.pred_pre],
        ['등락률', b.flu_rt],   ['거래량', b.trde_qty],   ['시가', b.open_pric],
        ['고가', b.high_pric],  ['저가', b.low_pric],     ['시가총액', b.mac],
        ['PER', b.per],         ['PBR', b.pbr],           ['ROE', b.roe],
        ['250최고', b.d250_hgst], ['250최저', b.d250_lwst]
      ];

      this.$('#grid').innerHTML = rows.map(([k, v]) =>
        `<div class="kv"><span class="k">${k}</span><span class="v">${v ?? '-'}</span></div>`
      ).join('');
    } catch (e) {
      this.$('#grid').innerHTML = `<div class="err">${(e as Error).message}</div>`;
    } finally {
      this.busy = false;
    }
  }
}
