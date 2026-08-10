// 스타일은 반드시 dockview → codicon → 앱 순서로 임포트
import 'dockview-core/dist/styles/dockview.css';
import '@vscode/codicons/dist/codicon.css';
import './styles/layout.css';

import { AppContext } from './core/context';
import { Workbench } from './shell/Workbench';

async function bootstrap(): Promise<void> {
  // 선택적 차트 추가기능. 이 import를 제거하면 기본 차트만 남는다.
  await import('../addons/chart-indicators/register')
    .catch(e => console.warn('차트 지표 추가기능 로드 실패. 기본 차트로 계속합니다.', e));

  // 전략 add-on은 전략 catalog/신호 marker/주문 실행기를 한 묶음으로 설치한다.
  // import가 실패하거나 이 블록을 제거해도 기본 ChartForm/지표 add-on은 그대로 동작한다.
  const strategyAddon = await import('../addons/chart-strategies/register')
    .catch(e => {
      console.warn('차트 전략 추가기능 로드 실패. 전략 없이 계속합니다.', e);
      return undefined;
    });

  // 개발 중에는 실시간 증분 계측을 자동 로드한다.
  // production/preview에서는 ?chartDiag=1 일 때만 로드하며, import를 제거하면 완전히 빠진다.
  const chartDiagnosticsEnabled = import.meta.env.DEV
    || new URLSearchParams(window.location.search).get('chartDiag') === '1';
  if (chartDiagnosticsEnabled) {
    await import('../addons/chart-diagnostics/register')
      .catch(e => console.warn('차트 런타임 진단 추가기능 로드 실패. 기본 차트로 계속합니다.', e));
  }

  const host = document.getElementById('workbench');
  if (!host) throw new Error('#workbench 엘리먼트를 찾을 수 없습니다.');

  const ctx = new AppContext();
  // 선택 add-on도 Workbench가 차트를 만들기 전에 동일 AppContext를 사용한다.
  const strategyRuntime = strategyAddon?.installChartStrategyAddon(ctx);
  (window as any).__ctx = ctx;

  const wb = new Workbench(ctx);
  wb.render(host);

  ctx.api.status()
    .then(s => {
      (ctx as any).state.mode = s.mode;
      ctx.api.setMode?.(String(s.mode).includes('모의'));
      ctx.log.info(`API 연결됨 · 모드=${s.mode} · 토큰=${s.tokenValid ? '유효' : '무효'}`);
      ctx.bus.emit('conn.changed', { mode: s.mode, tokenValid: s.tokenValid });
      if (s.tokenValid) (ctx as any).rt?.connect?.();
    })
    .catch(e => ctx.log.error(`프록시 서버 연결 실패: ${e?.message ?? e}`));

  window.addEventListener('beforeunload', () => strategyRuntime?.dispose?.());
}

void bootstrap();
