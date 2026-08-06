import { ChildForm } from './ChildForm';
import { TR_FLAT } from '../api/endpoints';

interface Shortcut { formId: string; params?: Record<string, any>; icon: string; title: string; desc: string; }

const SHORTCUTS: Shortcut[] = [
  { formId: 'chart',     params: { apiId: 'ka10081' }, icon: '📈', title: '일봉 차트',   desc: 'ka10081 · 틱/분/일/주/월/년 전환' },
  { formId: 'chart',     params: { apiId: 'ka10080' }, icon: '⏱',  title: '분봉 차트',   desc: 'ka10080 · 기본 5분봉' },
  { formId: 'stockInfo', params: { apiId: 'ka10001' }, icon: '🔍', title: '종목 기본정보', desc: 'ka10001 · 현재가/시총/PER' },
  { formId: 'account',   params: { tab: 'balance' },   icon: '💼', title: '계좌 잔고',   desc: 'kt00018 · 평가손익/수익률' },
  { formId: 'account',   params: { tab: 'pending' },   icon: '📋', title: '미체결',      desc: 'ka10075 · 주문 현황' },
  { formId: 'order',     params: { side: 'buy' },      icon: '🧾', title: '주문',        desc: 'kt10000/kt10001 · 매수/매도' },
  { formId: 'trRunner',  params: { apiId: 'ka10032' }, icon: '🏆', title: '거래대금 상위', desc: 'ka10032 · 순위정보' },
  { formId: 'output',                                  icon: '🖥', title: '출력 로그',    desc: 'REST/WS 호출 기록' },
];

export class WelcomeForm extends ChildForm {
  protected onInit(): void {
    this.setTitle('시작');
    const st: any = (this.ctx as any).state ?? {};

    this.html(`
      <div class="wc">
        <div class="wc-hero">
          <h1>Kiwoom Desk</h1>
          <p class="wc-sub">키움 REST API 멀티 도큐먼트 트레이딩 워크벤치</p>
          <div class="wc-status">
            <span class="wc-pill" id="wcMode">${this.esc(st.mode ?? '미접속')}</span>
            <span class="wc-pill ${st.wsConnected ? 'ok' : 'off'}" id="wcWs">
              ${st.wsConnected ? 'WS 연결됨' : 'WS 대기'}
            </span>
            <span class="wc-pill">TR ${TR_FLAT.length}종</span>
          </div>
        </div>

        <div class="wc-sec">바로 열기</div>
        <div class="wc-cards">
          ${SHORTCUTS.map((s, i) => `
            <button class="wc-card" data-i="${i}">
              <span class="wc-ico">${s.icon}</span>
              <span class="wc-t">${this.esc(s.title)}</span>
              <span class="wc-d">${this.esc(s.desc)}</span>
            </button>`).join('')}
        </div>

        <div class="wc-sec">사용법</div>
        <ul class="wc-tips">
          <li>왼쪽 탐색기에서 TR 을 클릭하면 파라미터 폼이 있는 패널이 열립니다.</li>
          <li>탐색기 상단 검색창에 <code>ka10081</code> 또는 <code>일봉</code> 처럼 입력해 바로 찾을 수 있습니다.</li>
          <li>패널 탭을 드래그해 좌우/상하로 분할하거나 띄울 수 있고, 배치는 자동 저장됩니다.</li>
          <li>한 폼에서 종목을 선택하면 다른 폼(차트·주문·종목정보)이 같은 종목으로 따라옵니다.</li>
          <li>모의투자는 초당 2건 제한이 있으니 자동갱신 패널을 여러 개 켜지 마세요.</li>
        </ul>
      </div>`);

    this.$$('[data-i]').forEach(btn => btn.addEventListener('click', () => {
      const s = SHORTCUTS[Number(btn.getAttribute('data-i'))];
      const dock: any = (this.ctx as any).dock;
      dock?.open(s.formId, s.params ?? {}, {});
    }));
  }
}

export default WelcomeForm;
