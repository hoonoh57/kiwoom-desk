// 스타일은 반드시 dockview → codicon → 앱 순서로 임포트
import 'dockview-core/dist/styles/dockview.css';
import '@vscode/codicons/dist/codicon.css';
import './styles/layout.css';

import { AppContext } from './core/context';
import { Workbench } from './shell/Workbench';

const host = document.getElementById('workbench');
if (!host) throw new Error('#workbench 엘리먼트를 찾을 수 없습니다.');

const ctx = new AppContext();
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

(window as any).__ctx = ctx;
