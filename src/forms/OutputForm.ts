import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

export class OutputForm extends ChildForm {
  private lines: string[] = [];
  private max = 2000;
  private follow = true;

  protected onInit(): void {
    this.setTitle('출력');
    this.html(`
      <div class="out-form">
        <div class="out-bar">
          <span class="tr-flex"></span>
          <label class="chk"><input type="checkbox" id="oFollow" checked> 자동 스크롤</label>
          <button class="lnk" id="oClear">지우기</button>
        </div>
        <div class="out-body" id="oBody"></div>
      </div>`);

    this.$('#oClear')?.addEventListener('click', () => { this.lines = []; this.paint(); });
    this.$('#oFollow')?.addEventListener('change', e => {
      this.follow = (e.target as HTMLInputElement).checked;
    });

    const store: any = (this.ctx.log as any).records ?? (this.ctx.log as any).store?.records;
    if (Array.isArray(store)) store.slice(-this.max).forEach((r: any) => this.push(r));

    const off = this.ctx.bus.on(Topics.Log, (r: any) => { this.push(r); this.paint(); });
    this.track(off);
    this.paint();
  }

  private push(r: any): void {
    const t = new Date(r?.ts ?? Date.now()).toLocaleTimeString('ko-KR');
    const ch = r?.channel ? `[${r.channel}]` : '';
    this.lines.push(`[${t}] ${ch} ${r?.msg ?? r?.message ?? String(r)}`);
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
  }

  private paint(): void {
    const body = this.$('#oBody'); if (!body) return;
    body.textContent = this.lines.join('\n');
    if (this.follow) body.scrollTop = body.scrollHeight;
  }
}

export default OutputForm;
