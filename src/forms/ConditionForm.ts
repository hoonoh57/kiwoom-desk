import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

interface Cond { seq: string; name: string; }

/** 조건검색 응답에서 자주 오는 필드 코드 → 라벨 */
const F: Record<string, string> = {
  '9001': '종목코드', '302': '종목명', '10': '현재가', '11': '전일대비',
  '12': '등락률', '13': '누적거래량', '16': '시가', '17': '고가', '18': '저가',
  '841': '조건식', '843': '편입이탈', '20': '시간', '907': '매도수구분',
};

export class ConditionForm extends ChildForm {
  private conds: Cond[] = [];
  private sel = '';
  private rows: any[] = [];
  private live = false;
  private busy = false;
  private events: string[] = [];

  protected onInit(): void {
    this.setTitle('조건검색');
    this.render();
    void this.loadList();

    // 실시간 편입/이탈은 REAL 로 들어온다
    this.track(this.ctx.bus.on(Topics.RealtimeTick, (d: any) => {
      if (!this.live) return;
      const v = d?.values ?? d ?? {};
      const seq = String(v['841'] ?? d?.item ?? '');
      if (this.sel && seq && !seq.includes(this.sel)) return;
      const io = String(v['843'] ?? '');
      if (!io) return;
      const code = String(v['9001'] ?? '').replace(/^A/, '');
      const tag = io === 'I' ? '편입' : io === 'D' ? '이탈' : io;
      this.events.unshift(`${new Date().toLocaleTimeString('ko-KR')} [${tag}] ${code}`);
      this.events = this.events.slice(0, 200);
      this.paintEvents();
    }));

    this.track(this.ctx.bus.on(Topics.ConditionHit, (m: any) => {
      const list = this.normRows(m?.data);
      if (!list.length) return;
      this.rows = list;
      this.paintRows();
    }));

    this.track(() => { if (this.live && this.sel) this.ctx.rt.conditionClear(this.sel); });
  }

  private render(): void {
    this.html(`
      <div class="cnd-form">
        <div class="cnd-bar">
          <select id="kSel" class="cnd-sel"><option value="">조건식 로딩중…</option></select>
          <button class="btn primary" id="kGo">검색</button>
          <label class="chk"><input type="checkbox" id="kLive"> 실시간 등록</label>
          <span class="tr-flex"></span>
          <span class="tr-badge">ka10171/2/3/4</span>
          <button class="lnk" id="kReload">목록 새로고침</button>
        </div>
        <div class="cnd-split">
          <div class="cnd-main">
            <div class="tr-sub2" id="kInfo">조건식을 선택하고 검색하세요.</div>
            <div class="grid-wrap" id="kRows"></div>
          </div>
          <div class="cnd-side">
            <div class="tr-sub2">실시간 편입/이탈</div>
            <div class="cnd-ev" id="kEv"><div class="tr-empty">대기중</div></div>
          </div>
        </div>
      </div>`);

    this.$('#kGo')?.addEventListener('click', () => void this.search());
    this.$('#kReload')?.addEventListener('click', () => void this.loadList());
    this.$('#kSel')?.addEventListener('change', e => {
      this.sel = (e.target as HTMLSelectElement).value;
    });
    this.$('#kLive')?.addEventListener('change', e => {
      const on = (e.target as HTMLInputElement).checked;
      void this.toggleLive(on);
    });
  }

  private normRows(data: any): any[] {
    if (!Array.isArray(data)) return [];
    return data.map(r => (Array.isArray(r) ? { ...r } : r)).filter(Boolean);
  }

  private async loadList(): Promise<void> {
    const selEl = this.$<HTMLSelectElement>('#kSel');
    if (!this.ctx.rt.connected) {
      if (selEl) selEl.innerHTML = `<option value="">WS 미연결 — 연결 후 새로고침</option>`;
      this.info('WebSocket 이 연결되지 않았습니다. 상태바를 확인하세요.');
      return;
    }
    try {
      const m: any = await this.ctx.rt.conditionList();
      const raw = m?.data ?? [];
      this.conds = raw.map((x: any) => Array.isArray(x)
        ? { seq: String(x[0] ?? ''), name: String(x[1] ?? '') }
        : { seq: String(x?.seq ?? ''), name: String(x?.name ?? '') })
        .filter((c: Cond) => c.seq !== '');

      if (selEl) {
        selEl.innerHTML = this.conds.length
          ? this.conds.map(c => `<option value="${this.esc(c.seq)}">${this.esc(c.seq)} · ${this.esc(c.name)}</option>`).join('')
          : `<option value="">등록된 조건식이 없습니다 (영웅문4에서 생성)</option>`;
        this.sel = this.conds[0]?.seq ?? '';
      }
      this.info(`조건식 ${this.conds.length}개`);
    } catch (e: any) {
      this.info(`목록 조회 실패: ${e?.message ?? e}`);
    }
  }

  private async search(): Promise<void> {
    if (!this.sel) { this.info('조건식을 선택하세요.'); return; }
    if (this.busy) return;
    this.busy = true;
    this.info('검색중…');
    try {
      const m: any = await this.ctx.rt.conditionSearch(this.sel, '0');
      if (m?.return_code !== undefined && m.return_code !== 0) {
        this.info(`rc=${m.return_code} ${m.return_msg ?? ''}`);
        return;
      }
      this.rows = this.normRows(m?.data);
      this.paintRows();
      this.info(`${this.rows.length}종목 포착 · 조건식 ${this.sel}`);
    } catch (e: any) {
      this.info(`검색 실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
    }
  }

  private async toggleLive(on: boolean): Promise<void> {
    if (!this.sel) { this.info('조건식을 먼저 선택하세요.'); return; }
    try {
      if (on) {
        const m: any = await this.ctx.rt.conditionSearch(this.sel, '1');
        this.live = true;
        const list = this.normRows(m?.data);
        if (list.length) { this.rows = list; this.paintRows(); }
        this.info(`실시간 등록됨 · 조건식 ${this.sel}`);
      } else {
        await this.ctx.rt.conditionClear(this.sel);
        this.live = false;
        this.info('실시간 해제됨');
      }
    } catch (e: any) {
      this.info(`실시간 처리 실패: ${e?.message ?? e}`);
    }
  }

  private paintRows(): void {
    const host = this.$('#kRows'); if (!host) return;
    if (!this.rows.length) { host.innerHTML = `<div class="tr-empty">포착된 종목이 없습니다.</div>`; return; }
    const cols = Array.from(new Set(this.rows.flatMap(r => Object.keys(r))));
    host.innerHTML = `<table class="grid">
      <thead><tr>${cols.map(c => `<th title="${this.esc(c)}">${this.esc(F[c] ?? c)}</th>`).join('')}</tr></thead>
      <tbody>${this.rows.map((r, i) => `<tr data-i="${i}" class="clickable">${cols.map(c => {
        const raw = String(r[c] ?? '');
        const n = Number(raw.replace(/,/g, ''));
        const isNum = raw !== '' && Number.isFinite(n) && !/^9001$|^302$/.test(c);
        const cls = /^(11|12)$/.test(c) ? (n > 0 ? 'up' : n < 0 ? 'dn' : '') : '';
        return `<td class="${cls}">${this.esc(isNum ? n.toLocaleString('ko-KR') : raw)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;

    this.$$('tr.clickable').forEach(tr => tr.addEventListener('click', () => {
      const r = this.rows[Number(tr.getAttribute('data-i'))];
      const code = String(r?.['9001'] ?? r?.stk_cd ?? '').replace(/^A/, '').trim();
      if (!code) return;
      this.ctx.bus.emit(Topics.SymbolSelected, {
        source: this.formKey, code, name: String(r?.['302'] ?? r?.stk_nm ?? ''),
      });
    }));
  }

  private paintEvents(): void {
    const el = this.$('#kEv'); if (!el) return;
    el.innerHTML = this.events.length
      ? this.events.map(s => `<div class="ev ${s.includes('[편입]') ? 'up' : 'dn'}">${this.esc(s)}</div>`).join('')
      : `<div class="tr-empty">대기중</div>`;
  }

  private info(s: string): void { const el = this.$('#kInfo'); if (el) el.textContent = s; }
}

export default ConditionForm;
