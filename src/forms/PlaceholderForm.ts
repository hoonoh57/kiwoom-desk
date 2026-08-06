import { ChildForm } from './ChildForm';

const PLAN: Record<string, { title: string; note: string }> = {
  condition: { title: '조건검색', note: 'WebSocket CNSRLST / CNSRREQ / CNSRCLR 로 조건식 목록·포착·실시간 해제를 처리할 폼입니다.' },
  watchlist: { title: '관심종목', note: 'ka10095 관심종목정보요청 + 실시간 체결 구독으로 시세판을 구성할 폼입니다.' },
  autotrade: { title: '자동매매', note: '조건검색 포착 → 진입/청산 규칙 → 주문 실행 엔진을 붙일 폼입니다.' },
  settings:  { title: '설정',    note: '모의/실투자 전환, 유량 제한, 레이아웃 초기화를 다룰 폼입니다.' },
};

export class PlaceholderForm extends ChildForm {
  protected onInit(): void {
    const id = String(this.params.formId ?? this.params.id ?? 'unknown');
    const p = PLAN[id] ?? { title: id, note: '아직 구현되지 않은 폼입니다.' };
    this.setTitle(p.title);
    this.html(`
      <div class="ph">
        <div class="ph-ico">🚧</div>
        <div class="ph-t">${this.esc(p.title)} — 구현 예정</div>
        <div class="ph-d">${this.esc(p.note)}</div>
        <div class="ph-k">formId: <code>${this.esc(id)}</code></div>
      </div>`);
  }
}

export default PlaceholderForm;
