import '@vscode/codicons/dist/codicon.css';
import './styles/layout.css';

import { AppContext } from './core/context';
import { createForm, getFormMeta } from './forms/registry';

function queryParams(): { formId: string; params: Record<string, any> } {
  const q = new URLSearchParams(location.search);
  const formId = String(q.get('form') || 'welcome').trim();
  const params: Record<string, any> = {};
  for (const [key, value] of q.entries()) {
    if (key === 'form') continue;
    params[key] = value;
  }
  return { formId, params };
}

async function bootstrap(): Promise<void> {
  const host = document.getElementById('embed-root');
  if (!host) throw new Error('#embed-root not found');
  host.style.width = '100vw';
  host.style.height = '100vh';
  host.style.overflow = 'hidden';

  const { formId, params } = queryParams();
  const ctx = new AppContext();

  (ctx as any).dock = {
    open(nextFormId: string, nextParams: Record<string, any> = {}) {
      window.parent.postMessage({
        type: 'kiwoom-desk-open',
        formId: nextFormId,
        params: nextParams,
      }, '*');
      return undefined;
    },
  };

  const panelApi = {
    setTitle(title: string) {
      document.title = title;
      window.parent.postMessage({
        type: 'kiwoom-desk-title',
        formId,
        title,
      }, '*');
    },
    close() {
      window.parent.postMessage({
        type: 'kiwoom-desk-close',
        formId,
      }, '*');
    },
  };

  const form = createForm(formId, ctx, params);
  form.attach(host, panelApi);
  document.title = getFormMeta(formId).title;

  try {
    const status = await ctx.api.status();
    ctx.state.mode = status.mode as any;
    ctx.api.setMode?.(String(status.mode).includes('모의'));
    ctx.bus.emit('conn.changed', {
      mode: status.mode,
      tokenValid: status.tokenValid,
    });
    if (status.tokenValid) ctx.rt.connect();
  } catch (error: any) {
    ctx.log.error('임베드 연결 상태 확인 실패: ' + String(error?.message ?? error));
  }

  window.addEventListener('beforeunload', () => {
    form.dispose();
    ctx.rt.dispose();
    ctx.bus.dispose();
    ctx.commands.dispose();
  });
}

void bootstrap();
