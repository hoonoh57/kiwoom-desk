import {
  createDockview,
  type DockviewApi,
  type IContentRenderer,
  type GroupPanelPartInitParameters,
  type IDockviewPanel,
} from 'dockview-core';
import type { AppContext } from '../core/context';
import { createForm, formTitle } from '../forms/registry';
import type { ChildForm } from '../forms/ChildForm';

/** dockview 패널 1개 = ChildForm 1개 */
class FormRenderer implements IContentRenderer {
  private _el: HTMLElement;
  private form?: ChildForm;

  constructor(private ctx: AppContext) {
    this._el = document.createElement('div');
    this._el.className = 'form-host';
  }

  get element(): HTMLElement { return this._el; }

  init(p: GroupPanelPartInitParameters): void {
    const params: any = p.params ?? {};
    const formId: string = params.formId ?? 'welcome';
    try {
      this.form = createForm(formId, this.ctx, params);
      this.form.attach(this._el, p.api as any);
    } catch (e: any) {
      this._el.innerHTML = `<div class="err">폼 생성 실패 (${formId})\n${String(e?.message ?? e)}</div>`;
      this.ctx.log.error(`폼 생성 실패: ${formId} — ${e?.message ?? e}`);
    }
  }

  /** updateParameters() 호출 시 진입 — 같은 패널에 다른 TR 을 태울 때 사용 */
  update(event: any): void {
    const params = event?.params ?? event;
    if (this.form && params && typeof this.form.setParams === 'function') {
      this.form.setParams(params);
    }
  }

  dispose(): void {
    this.form?.dispose();
    this.form = undefined;
  }
}

export interface OpenPosition {
  direction?: 'left' | 'right' | 'above' | 'below' | 'within';
  referencePanel?: string;
  floating?: boolean;
}

export interface OpenOptions extends OpenPosition {
  key?: string;        // 패널 고유 ID (미지정시 formId[:apiId])
  title?: string;
  unique?: boolean;    // false 면 항상 새 패널 생성
  inactive?: boolean;  // 열되 포커스 주지 않음
}

const LAYOUT_KEY = 'kiwoom-desk.layout.v2';

export class DockService {
  private api!: DockviewApi;
  private seq = 0;

  constructor(private ctx: AppContext) {}

  mount(host: HTMLElement): void {
    host.classList.add('dockview-theme-dark');
    this.api = createDockview(host, {
      createComponent: () => new FormRenderer(this.ctx),
      disableFloatingGroups: false,
    });

    this.api.onDidActivePanelChange((panel) => {
      if (!panel) return;
      const p: any = panel.params ?? {};
      this.ctx.bus.emit('panel.active', { id: panel.id, formId: p.formId, apiId: p.apiId });
    });
  }

  get dockApi(): DockviewApi { return this.api; }

  /** 패널 열기 (같은 key 는 재사용하며 파라미터만 교체) */
  open(formId: string, params: Record<string, any> = {}, opts: OpenOptions = {}): IDockviewPanel | undefined {
    if (!this.api) { this.ctx.log.error('DockService 가 아직 mount 되지 않았습니다.'); return; }

    const unique = opts.unique !== false;
    const baseKey = opts.key ?? (params.apiId ? `${formId}:${params.apiId}` : formId);
    const key = unique ? baseKey : `${baseKey}#${++this.seq}`;
    const title = opts.title ?? formTitle(formId, params);

    const exist = this.api.getPanel(key);
    if (exist) {
      // ★ 핵심: 기존 패널이면 파라미터를 갱신해 폼을 다시 그린다
      exist.api.updateParameters({ formId, ...params });
      exist.api.setTitle(title);
      if (!opts.inactive) exist.api.setActive();
      return exist;
    }

    const panel = this.api.addPanel({
      id: key,
      component: 'form',
      title,
      params: { formId, ...params },
      inactive: opts.inactive,
      floating: opts.floating,
      position: this.resolvePosition(opts),
    });
    return panel;
  }

  private resolvePosition(opts: OpenOptions): any {
    if (opts.floating) return undefined;
    if (!opts.direction) return undefined;
    const ref = opts.referencePanel ?? this.api.activePanel?.id;
    if (!ref) return undefined;
    return { referencePanel: ref, direction: opts.direction };
  }

  close(key: string): void {
    this.api?.getPanel(key)?.api.close();
  }

  closeAll(): void {
    this.api?.panels.slice().forEach(p => p.api.close());
  }

  focus(key: string): void {
    this.api?.getPanel(key)?.api.setActive();
  }

  get panelKeys(): string[] {
    return this.api ? this.api.panels.map(p => p.id) : [];
  }

  saveLayout(): void {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.api.toJSON()));
    } catch (e: any) {
      this.ctx.log.warn(`레이아웃 저장 실패: ${e?.message ?? e}`);
    }
  }

  restoreLayout(): boolean {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return false;
    try {
      this.api.fromJSON(JSON.parse(raw));
      return this.api.panels.length > 0;
    } catch (e: any) {
      this.ctx.log.warn(`레이아웃 복원 실패: ${e?.message ?? e}`);
      localStorage.removeItem(LAYOUT_KEY);
      return false;
    }
  }

  resetLayout(): void {
    localStorage.removeItem(LAYOUT_KEY);
    this.closeAll();
  }
}

export default DockService;
