import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = typeof LEVELS[number];

export class LogForm extends ChildForm {
  private recs: any[] = [];
  private min: Level = 'debug';
  private q = '';
  private max = 3000;

  protected onInit(): void {
    this.setTitle('로그');
    this.html(`
      <div class="out-form">
        <div class="out-bar">
          <select id="lLv">${LEVELS.map(l => `<option value="${l}">${l.toUpperCase()} 이상</option>`).join('')}</select>
          <input id="lQ" class="c-code" style="width:160px" placeholder="필터…" spellcheck="false">
          <span class="tr-flex"></span>
          <button class="lnk" id="lClear">지우기</button>
        </div>
        <div class="out-body" id="lBody"></div>
      </div>`);

    this.$('#lLv')?.addEventListener('change', e => {
      this.min = (e.target as HTMLSelectElement).value as Level; this.paint();
    });
    this.$('#lQ')?.addEventListener('input', e => {
      this.q = (e.target as HTMLInputElement).value.toLowerCase(); this.paint();
    });
    this.$('#lClear')?.addEventListener('click', () => { this.recs = []; this.paint(); });

    const store: any = (this.ctx.log as any).records ?? (this.ctx.log as any).store?.records;
    if (Array.isArray(store)) this.recs = store.slice(-this.max);

    const off = this.ctx.bus.on(Topics.Log, (r: any) => {
      this.recs.push(r);
      if (this.recs.length > this.max) this.recs.shift();
      this.paint();
    });
    this.track(off);
    this.paint();
  }

  private paint(): void {
    const body = this.$('#lBody'); if (!body) return;
    const floor = LEVELS.indexOf(this.min);
    const rows = this.recs.filter(r => {
      const li = LEVELS.indexOf((r?.level ?? 'info') as Level);
      if (li >= 0 && li < floor) return false;
      if (!this.q) return true;
      return String(r?.msg ?? '').toLowerCase().includes(this.q)
          || String(r?.channel ?? '').toLowerCase().includes(this.q);
    });
    body.innerHTML = rows.map(r => {
      const t = new Date(r?.ts ?? Date.now()).toLocaleTimeString('ko-KR');
      const lv = String(r?.level ?? 'info');
      return `<div class="lg-row lv-${lv}"><span class="lg-t">${t}</span>` +
             `<span class="lg-l">${lv.toUpperCase()}</span>` +
             `<span class="lg-c">${this.esc(r?.channel ?? '')}</span>` +
             `<span class="lg-m">${this.esc(r?.msg ?? '')}</span></div>`;
    }).join('');
    body.scrollTop = body.scrollHeight;
  }
}

export default LogForm;
