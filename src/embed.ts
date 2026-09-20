import '@vscode/codicons/dist/codicon.css';
import './styles/layout.css';
import './styles/embed.css';

import { AppContext } from './core/context';
import { Topics, type SymbolPayload } from './core/events';
import { createForm, getFormMeta } from './forms/registry';
import type { ChildForm } from './forms/ChildForm';

function querySpec(): { formIds: string[]; params: Record<string, any> } {
  const q = new URLSearchParams(location.search);
  const forms = String(q.get('forms') || '').split(',').map(v => v.trim()).filter(Boolean);
  const single = String(q.get('form') || '').trim();
  const formIds = forms.length ? forms : [single || 'welcome'];
  const params: Record<string, any> = {};
  for (const [key, value] of q.entries()) {
    if (key === 'form' || key === 'forms') continue;
    params[key] = value;
  }
  return { formIds, params };
}

async function bootstrap(): Promise<void> {
  const host = document.getElementById('embed-root');
  if (!host) throw new Error('#embed-root not found');

  const { formIds, params } = querySpec();
  const ctx = new AppContext();
  if (params.code) {
    ctx.state.symbol = {
      code: String(params.code),
      name: String(params.name ?? ''),
    };
  }
  let activeForm: ChildForm | undefined;
  let activeFormId = '';

  host.innerHTML = '<div class="embed-shell"><div class="embed-tabs"></div><div class="embed-form-host"></div></div>';
  const tabs = host.querySelector<HTMLElement>('.embed-tabs')!;
  const formHost = host.querySelector<HTMLElement>('.embed-form-host')!;

  ctx.bus.on<SymbolPayload>(Topics.SymbolSelected, payload => {
    if (!payload?.code) return;
    ctx.state.symbol = {
      code: String(payload.code),
      name: String(payload.name ?? ''),
    };
    window.parent.postMessage({
      type: 'kiwoom-desk-symbol-selected',
      code: String(payload.code),
      name: String(payload.name ?? ''),
      source: String(payload.source ?? ''),
    }, '*');
  });

  (ctx as any).dock = {
    open(nextFormId: string, nextParams: Record<string, any> = {}) {
      if (formIds.includes(nextFormId)) {
        mount(nextFormId, nextParams);
      } else {
        window.parent.postMessage({
          type: 'kiwoom-desk-open',
          formId: nextFormId,
          params: nextParams,
        }, '*');
      }
      return undefined;
    },
  };

  function mount(formId: string, nextParams: Record<string, any> = {}): void {
    activeForm?.dispose();
    activeForm = undefined;
    activeFormId = formId;
    formHost.replaceChildren();

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

    activeForm = createForm(formId, ctx, { ...params, ...nextParams });
    activeForm.attach(formHost, panelApi);
    document.title = getFormMeta(formId).title;

    tabs.querySelectorAll<HTMLButtonElement>('[data-form]').forEach(button => {
      button.classList.toggle('on', button.dataset.form === formId);
    });
  }

  if (formIds.length > 1) {
    for (const formId of formIds) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'embed-tab';
      button.dataset.form = formId;
      button.textContent = getFormMeta(formId).title;
      button.addEventListener('click', () => mount(formId));
      tabs.appendChild(button);
    }
  } else {
    tabs.hidden = true;
  }

  mount(formIds[0]);

  try {
    const status = await ctx.api.status();
    ctx.state.mode = status.mode as any;
    ctx.api.setMode?.(String(status.mode).includes('모의'));
    ctx.bus.emit('conn.changed', {
      mode: status.mode,
      tokenValid: status.tokenValid,
    });
    const needsRealtime = formIds.some(formId => formId === 'condition' || formId === 'watchlist');
    if (status.tokenValid && needsRealtime) ctx.rt.connect();
  } catch (error: any) {
    ctx.log.error('임베드 연결 상태 확인 실패: ' + String(error?.message ?? error));
  }

  window.addEventListener('beforeunload', () => {
    activeForm?.dispose();
    activeForm = undefined;
    ctx.rt.dispose();
    ctx.bus.dispose();
    ctx.commands.dispose();
  });
}

void bootstrap();
