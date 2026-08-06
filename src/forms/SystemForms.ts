// SystemForms.ts
import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

export class OutputForm extends ChildForm {
  protected onInit() {
    this.html(`<pre id="out" class="output"></pre>`);
    const out = this.$('#out');
    const write = (r: any) => {
      const t = new Date(r.ts).toLocaleTimeString('ko-KR');
      out.insertAdjacentHTML('beforeend', `<div class="l-${r.level}">[${t}] [${r.channel}] ${escapeHtml(r.message)}</div>`);
      out.scrollTop = out.scrollHeight;
    };
    this.ctx.log.buffer.slice(-300).forEach(write);
    this.track(this.ctx.bus.on(Topics.Log, write));
  }
}

export class LogForm extends ChildForm {
  protected onInit() {
    this.html(`<div class="rt-log"><table><thead><tr><th>시각</th><th>타입</th><th>종목</th><th>내용</th></tr></thead>
      <tbody id="tb"></tbody></table></div>`);
    const tb = this.$('#tb');
    this.track(this.ctx.bus.on(Topics.RealtimeTick, (d: any) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${new Date().toLocaleTimeString('ko-KR')}</td><td>${d.type ?? ''}</td>
                      <td>${d.item ?? ''}</td><td>${escapeHtml(JSON.stringify(d.values ?? d).slice(0, 160))}</td>`;
      tb.prepend(tr);
      while (tb.childElementCount > 500) tb.lastElementChild?.remove();
    }));
  }
}

export class WelcomeForm extends ChildForm {
  protected onInit() {
    this.html(`
      <div class="welcome">
        <h1>Kiwoom Desk</h1>
        <p class="sub">키움 REST API 멀티 도큐먼트 트레이딩 워크벤치</p>
        <div class="wcols">
          <div><h3>시작</h3>
            <a data-cmd="form.open" data-arg="stockInfo">주식기본정보 조회</a>
            <a data-cmd="form.open" data-arg="chart">차트 열기</a>
            <a data-cmd="form.open" data-arg="condition">조건검색 열기</a>
            <a data-cmd="rt.connect">실시간(WS) 연결</a></div>
          <div><h3>도움말</h3>
            <p>Ctrl+Shift+P 로 모든 TR 을 이름으로 검색해 실행할 수 있습니다.</p>
            <p>탭을 드래그해 좌우/상하로 분할하면 여러 종목을 동시에 볼 수 있습니다.</p></div>
        </div>
      </div>`);
    this.root.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
      if (a) void this.ctx.commands.execute(a.dataset.cmd!, a.dataset.arg);
    });
  }
}
const escapeHtml = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
