import type {
  ChartBar,
  ChartBarChange,
  ChartExtension,
  ChartExtensionContext,
} from '../../src/chart/extensions';
import { ChartRuntimeProbe, type DiagnosticSnapshot } from './probe';

export class RuntimeDiagnostics implements ChartExtension {
  private readonly probe: ChartRuntimeProbe;
  private readonly root = document.createElement('span');
  private readonly button = document.createElement('button');
  private readonly badge = document.createElement('span');
  private readonly panel = document.createElement('div');
  private opened = false;
  private disposed = false;
  private renderFrame?: number;

  constructor(private readonly context: ChartExtensionContext) {
    this.probe = new ChartRuntimeProbe(context.chart);
    this.probe.install();

    this.root.className = 'chart-runtime-diagnostics';
    this.button.type = 'button';
    this.button.className = 'lnk chart-diagnostics-button';
    this.button.textContent = '진단';
    this.badge.className = 'chart-diagnostics-badge';
    this.panel.className = 'chart-diagnostics-panel';
    this.panel.hidden = true;

    this.root.append(this.button, this.badge, this.panel);
    context.toolbar.appendChild(this.root);

    this.button.addEventListener('click', this.onToggle);
    this.panel.addEventListener('click', this.onPanelClick);
    this.render();
  }

  onBarsReset(_bars: readonly ChartBar[]): void {
    this.probe.recordBarsReset();
    this.scheduleRender();
  }

  onBarChanged(
    _bar: ChartBar,
    change: ChartBarChange,
    _bars: readonly ChartBar[],
  ): void {
    this.probe.recordBarChange(change);
    this.scheduleRender();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.renderFrame !== undefined) cancelAnimationFrame(this.renderFrame);
    this.button.removeEventListener('click', this.onToggle);
    this.panel.removeEventListener('click', this.onPanelClick);
    this.probe.dispose();
    this.root.remove();
  }

  private readonly onToggle = (): void => {
    this.opened = !this.opened;
    this.panel.hidden = !this.opened;
    this.button.classList.toggle('on', this.opened);
    this.probe.scanSeries();
    this.render();
  };

  private readonly onPanelClick = (event: Event): void => {
    const target = event.target as HTMLElement;
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'start') {
      this.probe.scanSeries();
      this.probe.start();
      this.render();
      return;
    }

    if (action === 'stop') {
      this.probe.stop();
      this.render();
      return;
    }

    if (action === 'json') {
      const area = this.panel.querySelector<HTMLTextAreaElement>('[data-role="json"]');
      if (!area) return;
      area.value = JSON.stringify(this.probe.snapshot(), null, 2);
      area.focus();
      area.select();
    }
  };

  private scheduleRender(): void {
    if (this.renderFrame !== undefined || this.disposed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = undefined;
      this.render();
    });
  }

  private render(): void {
    const snapshot = this.probe.snapshot();
    const liveBars = snapshot.barAppend + snapshot.barReplace;
    const violation = snapshot.barsReset > 0 || snapshot.setData > 0;
    const status = !snapshot.measuring
      ? 'IDLE'
      : violation
        ? 'RESET'
        : liveBars > 0
          ? 'PASS'
          : 'WAIT';

    this.badge.textContent = status;
    this.badge.dataset.status = status.toLowerCase();
    this.badge.title = this.statusText(snapshot);

    if (!this.opened) return;

    const elapsed = snapshot.startedAt
      ? Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000))
      : 0;

    const rows = snapshot.series
      .filter(row => row.setData > 0 || row.update > 0 || !snapshot.measuring)
      .slice(0, 30)
      .map(row => `
        <tr>
          <td title="${this.esc(row.label)}">${this.esc(row.label)}</td>
          <td>${row.update.toLocaleString()}</td>
          <td class="${row.setData ? 'bad' : ''}">${row.setData.toLocaleString()}</td>
        </tr>`)
      .join('');

    this.panel.innerHTML = `
      <div class="diag-title">실시간 증분 진단</div>
      <div class="diag-state ${status.toLowerCase()}">${this.esc(this.statusText(snapshot))}</div>
      <div class="diag-actions">
        <button type="button" class="btn primary" data-action="start">측정 시작 / 초기화</button>
        <button type="button" class="btn" data-action="stop">중지</button>
        <button type="button" class="lnk" data-action="json">JSON</button>
      </div>
      <div class="diag-help">차트 조회가 끝난 뒤 측정을 시작하고 장중 체결을 관찰하세요. 정상 실시간 경로에서는 bars.reset=0, setData=0을 유지합니다.</div>
      <div class="diag-grid">
        <span>측정</span><b>${snapshot.measuring ? `${elapsed}s` : '중지'}</b>
        <span>bar.replace</span><b>${snapshot.barReplace.toLocaleString()}</b>
        <span>bar.append</span><b>${snapshot.barAppend.toLocaleString()}</b>
        <span>bars.reset</span><b class="${snapshot.barsReset ? 'bad' : ''}">${snapshot.barsReset.toLocaleString()}</b>
        <span>series.update</span><b>${snapshot.update.toLocaleString()}</b>
        <span>series.setData</span><b class="${snapshot.setData ? 'bad' : ''}">${snapshot.setData.toLocaleString()}</b>
        <span>계측 series</span><b>${snapshot.patchedSeries.toLocaleString()}</b>
        <span>patch 실패</span><b class="${snapshot.patchFailures ? 'bad' : ''}">${snapshot.patchFailures.toLocaleString()}</b>
      </div>
      <table class="diag-series">
        <thead><tr><th>series</th><th>update</th><th>setData</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">측정된 series 호출이 없습니다.</td></tr>'}</tbody>
      </table>
      <textarea data-role="json" class="diag-json" spellcheck="false" placeholder="JSON 버튼을 누르면 현재 계측값을 표시합니다."></textarea>`;
  }

  private statusText(snapshot: DiagnosticSnapshot): string {
    if (!snapshot.measuring) return '대기 · 측정 시작 버튼을 누르세요.';
    if (snapshot.patchFailures > 0) {
      return `주의 · series patch 실패 ${snapshot.patchFailures}건`;
    }
    if (snapshot.barsReset > 0 || snapshot.setData > 0) {
      return `재설정 감지 · bars.reset=${snapshot.barsReset}, setData=${snapshot.setData}`;
    }
    const liveBars = snapshot.barAppend + snapshot.barReplace;
    if (!liveBars) return '측정중 · 실시간 bar 이벤트 대기';
    return `PASS · ${liveBars.toLocaleString()}개 실시간 bar, setData 0`;
  }

  private esc(value: unknown): string {
    return String(value ?? '').replace(/[&<>\"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
    })[char] ?? char);
  }
}
