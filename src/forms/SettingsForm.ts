import { ChildForm } from './ChildForm';
import {
  defaultWorkbenchSettings,
  exportWorkbenchSettings,
  importWorkbenchSettings,
  loadWorkbenchSettings,
  normalizeWorkbenchSettings,
  resetWorkbenchSettings,
  saveWorkbenchSettings,
  type SettingsChartPeriod,
  type WorkbenchSettings,
} from '../settings';
import './SettingsForm.css';

const PERIODS: Array<{ v: SettingsChartPeriod; t: string }> = [
  { v: 'tick', t: '틱' }, { v: 'min', t: '분' }, { v: 'day', t: '일' },
  { v: 'week', t: '주' }, { v: 'month', t: '월' }, { v: 'year', t: '년' },
];
const MINUTE_SCOPES = ['1', '3', '5', '10', '15', '30', '60'];
const TICK_SCOPES = ['1', '3', '5', '10', '30', '60', '120', '240', '360', '480', '540', '720'];
const ORDER_TYPES = [
  { v: '0', t: '보통(지정가)' }, { v: '3', t: '시장가' }, { v: '5', t: '조건부지정가' },
  { v: '6', t: '최유리지정가' }, { v: '7', t: '최우선지정가' }, { v: '10', t: '보통(IOC)' },
  { v: '13', t: '시장가(IOC)' }, { v: '20', t: '보통(FOK)' }, { v: '23', t: '시장가(FOK)' },
];

export class SettingsForm extends ChildForm {
  private settings: WorkbenchSettings = loadWorkbenchSettings();
  private statusText = '서버 상태 확인중…';
  private message = '';

  protected onInit(): void {
    this.setTitle('설정');
    this.settings = loadWorkbenchSettings();
    this.render();
    void this.loadStatus();
  }

  private async loadStatus(): Promise<void> {
    try {
      const status = await this.ctx.api.status();
      this.statusText = `${status.mode ?? '미접속'} · 토큰 ${status.tokenValid ? '유효' : '무효'}`;
    } catch (error: any) {
      this.statusText = `상태 조회 실패: ${error?.message ?? error}`;
    }
    this.render();
  }

  private render(): void {
    const s = this.settings;
    this.html(`
      <div class="settings-form">
        <div class="settings-head">
          <div>
            <div class="settings-title">Kiwoom Desk 사용자 설정</div>
            <div class="settings-sub">API Key / Secret / PORT는 서버 .env 영역이며 이 화면에서 읽거나 수정하지 않습니다.</div>
          </div>
          <span class="tr-flex"></span>
          <span class="settings-status">${this.esc(this.statusText)}</span>
        </div>

        <div class="settings-scroll">
          <section class="settings-card">
            <h3>일반</h3>
            <label class="settings-row"><span>기본 종목</span>
              <input class="input mono" id="sSymbol" value="${this.esc(s.general.defaultSymbol)}" maxlength="20">
            </label>
            <label class="settings-check">
              <input type="checkbox" id="sRestore" ${s.general.restoreLayout ? 'checked' : ''}>
              <span>시작할 때 마지막 Dock 레이아웃 자동 복원</span>
            </label>
          </section>

          <section class="settings-card">
            <h3>차트</h3>
            <label class="settings-row"><span>기본 주기</span>
              <select class="input" id="sPeriod">${this.periodOptions(s.chart.defaultPeriod)}</select>
            </label>
            <label class="settings-row"><span>분봉 기본 단위</span>
              <select class="input" id="sMinute">${MINUTE_SCOPES.map(v => `<option value="${v}" ${v === s.chart.defaultMinuteScope ? 'selected' : ''}>${v}분</option>`).join('')}</select>
            </label>
            <label class="settings-row"><span>틱봉 기본 단위</span>
              <select class="input" id="sTick">${TICK_SCOPES.map(v => `<option value="${v}" ${v === s.chart.defaultTickScope ? 'selected' : ''}>${v}틱</option>`).join('')}</select>
            </label>
            <label class="settings-row"><span>관심종목 더블클릭</span>
              <select class="input" id="sWatchPeriod">${this.periodOptions(s.chart.watchlistOpenPeriod)}</select>
            </label>
            <label class="settings-check"><input type="checkbox" id="sAdjusted" ${s.chart.adjustedPrice ? 'checked' : ''}><span>새 차트는 수정주가 사용</span></label>
            <label class="settings-check"><input type="checkbox" id="sVolumeRaw" ${s.chart.volumeRaw ? 'checked' : ''}><span>새 차트는 거래량 원본 축 사용</span></label>
          </section>

          <section class="settings-card">
            <h3>주문 기본값</h3>
            <label class="settings-row"><span>거래소</span>
              <select class="input" id="sExchange">${['KRX', 'NXT', 'SOR'].map(v => `<option value="${v}" ${v === s.order.defaultExchange ? 'selected' : ''}>${v}</option>`).join('')}</select>
            </label>
            <label class="settings-row"><span>수량</span>
              <input class="input" id="sQty" value="${s.order.defaultQuantity}" inputmode="numeric" maxlength="12">
            </label>
            <label class="settings-row"><span>매매구분</span>
              <select class="input" id="sOrderType">${ORDER_TYPES.map(x => `<option value="${x.v}" ${x.v === s.order.defaultOrderType ? 'selected' : ''}>${x.v}:${x.t}</option>`).join('')}</select>
            </label>
            <div class="settings-note">실제 주문 전 확인창은 안전장치이므로 설정으로 해제할 수 없습니다.</div>
          </section>

          <section class="settings-card">
            <h3>JSON 가져오기 / 내보내기</h3>
            <textarea class="settings-json mono" id="sJson" spellcheck="false" placeholder="설정 JSON"></textarea>
            <div class="settings-actions compact">
              <button class="btn" id="sExport">현재 설정 JSON</button>
              <button class="btn" id="sImport">JSON 적용</button>
            </div>
          </section>
        </div>

        <div class="settings-footer">
          <span class="settings-message">${this.esc(this.message)}</span>
          <span class="tr-flex"></span>
          <button class="btn" id="sReset">기본값 복원</button>
          <button class="btn primary" id="sSave">저장</button>
        </div>
      </div>`);

    this.$('#sSave')?.addEventListener('click', () => this.save());
    this.$('#sReset')?.addEventListener('click', () => this.reset());
    this.$('#sExport')?.addEventListener('click', () => this.exportJson());
    this.$('#sImport')?.addEventListener('click', () => this.importJson());
  }

  private periodOptions(selected: SettingsChartPeriod): string {
    return PERIODS.map(p => `<option value="${p.v}" ${p.v === selected ? 'selected' : ''}>${p.t}</option>`).join('');
  }

  private readForm(): WorkbenchSettings {
    return normalizeWorkbenchSettings({
      schemaVersion: 1,
      general: {
        defaultSymbol: this.$<HTMLInputElement>('#sSymbol')?.value,
        restoreLayout: !!this.$<HTMLInputElement>('#sRestore')?.checked,
      },
      chart: {
        defaultPeriod: this.$<HTMLSelectElement>('#sPeriod')?.value,
        defaultMinuteScope: this.$<HTMLSelectElement>('#sMinute')?.value,
        defaultTickScope: this.$<HTMLSelectElement>('#sTick')?.value,
        watchlistOpenPeriod: this.$<HTMLSelectElement>('#sWatchPeriod')?.value,
        adjustedPrice: !!this.$<HTMLInputElement>('#sAdjusted')?.checked,
        volumeRaw: !!this.$<HTMLInputElement>('#sVolumeRaw')?.checked,
      },
      order: {
        defaultExchange: this.$<HTMLSelectElement>('#sExchange')?.value,
        defaultQuantity: this.$<HTMLInputElement>('#sQty')?.value,
        defaultOrderType: this.$<HTMLSelectElement>('#sOrderType')?.value,
      },
    });
  }

  private save(): void {
    this.settings = saveWorkbenchSettings(this.readForm());
    this.message = '저장했습니다. 새 차트/주문에는 즉시 적용되며 레이아웃 복원 설정은 다음 시작부터 적용됩니다.';
    this.render();
  }

  private reset(): void {
    if (!confirm('Workbench 사용자 설정을 기본값으로 복원할까요?')) return;
    this.settings = resetWorkbenchSettings();
    this.message = '기본값으로 복원했습니다.';
    this.render();
  }

  private exportJson(): void {
    const value = this.readForm();
    const area = this.$<HTMLTextAreaElement>('#sJson');
    if (area) area.value = exportWorkbenchSettings(value);
  }

  private importJson(): void {
    const area = this.$<HTMLTextAreaElement>('#sJson');
    if (!area?.value.trim()) return;
    try {
      this.settings = saveWorkbenchSettings(importWorkbenchSettings(area.value));
      this.message = 'JSON 설정을 정규화해 저장했습니다.';
      this.render();
    } catch (error: any) {
      this.message = `JSON 적용 실패: ${error?.message ?? error}`;
      this.render();
    }
  }
}

export default SettingsForm;
