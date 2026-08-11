// 스타일은 반드시 dockview → codicon → 앱 순서로 임포트
import 'dockview-core/dist/styles/dockview.css';
import '@vscode/codicons/dist/codicon.css';
import './styles/layout.css';

import { AppContext } from './core/context';
import { Workbench } from './shell/Workbench';
import { installTradeProtectionRuntime } from './trading/TradeProtectionRuntime';

type OptionalStrategyAddonModule = {
  installChartStrategyAddon?: (ctx: AppContext) => { dispose?: () => void };
};

async function loadOptionalIndicatorAddon(): Promise<void> {
  // glob은 파일이 물리적으로 없으면 빈 객체가 된다. 따라서 add-on 폴더를 제거해도
  // base Workbench production build가 모듈 resolve 때문에 깨지지 않는다.
  const loaders = import.meta.glob('../addons/chart-indicators/register.ts') as Record<
    string,
    () => Promise<unknown>
  >;
  const load = Object.values(loaders)[0];
  if (!load) return;
  await load().catch(e => {
    console.warn('차트 지표 추가기능 로드 실패. 기본 차트로 계속합니다.', e);
  });
}

async function loadOptionalStrategyAddon(): Promise<OptionalStrategyAddonModule | undefined> {
  const loaders = import.meta.glob('../addons/chart-strategies/register.ts') as Record<
    string,
    () => Promise<OptionalStrategyAddonModule>
  >;
  const load = Object.values(loaders)[0];
  if (!load) return undefined;
  return load().catch(e => {
    console.warn('차트 전략 추가기능 로드 실패. 전략 없이 계속합니다.', e);
    return undefined;
  });
}

async function loadOptionalDiagnosticsAddon(): Promise<void> {
  const loaders = import.meta.glob('../addons/chart-diagnostics/register.ts') as Record<
    string,
    () => Promise<unknown>
  >;
  const load = Object.values(loaders)[0];
  if (!load) return;
  await load().catch(e => {
    console.warn('차트 런타임 진단 추가기능 로드 실패. 기본 차트로 계속합니다.', e);
  });
}

async function bootstrap(): Promise<void> {
  // 선택적 차트 추가기능. 폴더가 없거나 로드에 실패해도 기본 ChartForm은 계속 동작한다.
  await loadOptionalIndicatorAddon();

  // 전략 add-on은 전략 catalog/신호 marker/주문 실행기를 한 묶음으로 설치한다.
  // 폴더가 없거나 로드에 실패해도 기본 ChartForm/지표 add-on은 그대로 동작한다.
  const strategyAddon = await loadOptionalStrategyAddon();

  // 개발 중에는 실시간 증분 계측을 자동 로드한다.
  // production/preview에서는 ?chartDiag=1 일 때만 로드한다.
  const chartDiagnosticsEnabled = import.meta.env.DEV
    || new URLSearchParams(window.location.search).get('chartDiag') === '1';
  if (chartDiagnosticsEnabled) await loadOptionalDiagnosticsAddon();

  const host = document.getElementById('workbench');
  if (!host) throw new Error('#workbench 엘리먼트를 찾을 수 없습니다.');

  const ctx = new AppContext();
  // 일반 주문/계좌 잔고 보호는 기본 Workbench 안전계층으로 항상 설치한다.
  const tradeProtectionRuntime = installTradeProtectionRuntime(ctx);
  // 선택 add-on도 Workbench가 차트를 만들기 전에 동일 AppContext를 사용한다.
  const strategyRuntime = strategyAddon?.installChartStrategyAddon?.(ctx);
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

  window.addEventListener('beforeunload', () => {
    strategyRuntime?.dispose?.();
    tradeProtectionRuntime.dispose();
  });
}

void bootstrap();
