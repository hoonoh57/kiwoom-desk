import {
  createDockview,
  type DockviewApi,
  type IContentRenderer,
  type GroupPanelPartInitParameters,
  type IDockviewPanel,
  type IHeaderActionsRenderer,
  type IGroupHeaderProps,
} from 'dockview-core';
import type { AppContext } from '../core/context';
import {
  createForm,
  formTitle,
  formInstancePolicy,
  getFormMeta,
  type InstancePolicy,
} from '../forms/registry';
import type { ChildForm } from '../forms/ChildForm';
import '../styles/dockWindowControls.css';

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

type DockWindowLocation = 'grid' | 'floating' | 'popout';
type ManagedWindowMode = 'normal' | 'minimized' | 'maximized';

interface ChildWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserWindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FloatingState {
  mode: ManagedWindowMode;
  normalBounds: ChildWindowBounds;
}

interface PopoutState {
  mode: ManagedWindowMode;
  normalBounds: BrowserWindowBounds;
}

export interface DockWindowSnapshot {
  location: DockWindowLocation;
  minimized: boolean;
  maximized: boolean;
}

/**
 * Dockview 1.17.x에서 floating group은 native maximize가 no-op이므로
 * floating bounds를 재적용해 최소화/최대화/이전크기를 직접 구현한다.
 */
class DockWindowHeaderActions implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private props?: IGroupHeaderProps;
  private disposers: Array<{ dispose(): void }> = [];

  constructor(private readonly dock: DockService) {
    this.element.className = 'kw-window-actions';
    this.element.hidden = true;
  }

  init(props: IGroupHeaderProps): void {
    this.props = props;
    this.element.innerHTML = `
      <button type="button" class="kw-window-btn" data-win="min" title="최소화">—</button>
      <button type="button" class="kw-window-btn" data-win="max" title="최대화">□</button>
      <button type="button" class="kw-window-btn" data-win="detach" title="독립창">↗</button>
      <button type="button" class="kw-window-btn close" data-win="close" title="닫기">×</button>`;

    // floating drag handle까지 pointerdown이 전달되면 버튼 클릭이 창 이동으로 해석될 수 있다.
    for (const button of Array.from(this.element.querySelectorAll<HTMLButtonElement>('[data-win]'))) {
      button.addEventListener('pointerdown', e => e.stopPropagation());
      button.addEventListener('mousedown', e => e.stopPropagation());
      button.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        void this.run(String(button.dataset.win ?? ''));
      });
    }

    this.disposers.push(
      props.api.onDidLocationChange(() => this.render()),
      props.api.onDidActivePanelChange(() => this.render()),
    );
    this.render();
  }

  dispose(): void {
    for (const disposable of this.disposers.splice(0)) {
      try { disposable.dispose(); } catch { /* ignore */ }
    }
    this.element.remove();
    this.props = undefined;
  }

  private activePanel(): IDockviewPanel | undefined {
    return this.props?.group.activePanel;
  }

  private isChartPanel(panel: IDockviewPanel | undefined): boolean {
    return String((panel?.params as any)?.formId ?? '') === 'chart';
  }

  private async run(action: string): Promise<void> {
    const panel = this.activePanel();
    if (!panel || !this.isChartPanel(panel)) return;

    switch (action) {
      case 'min':
        this.dock.toggleMinimize(panel.id);
        break;
      case 'max':
        this.dock.toggleMaximize(panel.id);
        break;
      case 'detach':
        await this.dock.togglePopout(panel.id);
        break;
      case 'close':
        this.dock.close(panel.id);
        break;
    }

    requestAnimationFrame(() => this.render());
  }

  private render(): void {
    const panel = this.activePanel();
    if (!panel || !this.isChartPanel(panel)) {
      this.element.hidden = true;
      return;
    }

    const state = this.dock.windowState(panel.id);
    // 일반 grid tab에서는 기존 Dockview 탭 UI를 유지하고,
    // 키움식 창 제어는 floating child / 독립 popout에만 표시한다.
    this.element.hidden = state.location === 'grid';
    if (this.element.hidden) return;

    const min = this.element.querySelector<HTMLButtonElement>('[data-win="min"]');
    const max = this.element.querySelector<HTMLButtonElement>('[data-win="max"]');
    const detach = this.element.querySelector<HTMLButtonElement>('[data-win="detach"]');

    if (min) {
      min.textContent = state.minimized ? '▱' : '—';
      min.title = state.minimized ? '이전 크기' : '최소화';
    }
    if (max) {
      max.textContent = state.maximized ? '❐' : '□';
      max.title = state.maximized ? '이전 크기' : '최대화';
    }
    if (detach) {
      detach.textContent = state.location === 'popout' ? '↙' : '↗';
      detach.title = state.location === 'popout' ? '자식창으로 복귀' : '독립창으로 분리';
    }
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

const LAYOUT_KEY = 'kiwoom-desk.layout.v3';
const MINIMIZED_HEIGHT = 38;
const MINIMIZED_WIDTH = 360;

export class DockService {
  private api!: DockviewApi;
  private host!: HTMLElement;
  private seq = 0;
  private readonly floatingStates = new Map<string, FloatingState>();
  private readonly childBounds = new Map<string, ChildWindowBounds>();
  private readonly popoutStates = new Map<string, PopoutState>();

  constructor(private ctx: AppContext) {}

  mount(host: HTMLElement): void {
    this.host = host;
    host.classList.add('dockview-theme-dark');
    this.api = createDockview(host, {
      createComponent: () => new FormRenderer(this.ctx),
      createRightHeaderActionComponent: () => new DockWindowHeaderActions(this),
      disableFloatingGroups: false,
      floatingGroupBounds: 'boundedWithinViewport',
      popoutUrl: '/popout.html',
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

    // 메타 기본값을 항상 먼저 채워 singleton 재사용 시 이전 호출의 옵션이 남지 않게 한다.
    const resolvedParams = {
      ...(getFormMeta(formId).defaultParams ?? {}),
      ...params,
    };

    // 패널 키는 폼의 인스턴스 정책에 따라 DockService 한 곳에서만 생성한다.
    const policy = formInstancePolicy(formId);
    const key = this.keyFor(formId, resolvedParams, policy, opts);
    const title = opts.title ?? formTitle(formId, resolvedParams);

    const exist = this.api.getPanel(key);
    if (exist) {
      // ★ 핵심: 기존 패널이면 완전한 기본값+호출 파라미터로 폼을 다시 초기화한다.
      exist.api.updateParameters({ formId, ...resolvedParams });
      exist.api.setTitle(title);
      if (!opts.inactive) exist.api.setActive();
      return exist;
    }

    const panel = this.api.addPanel({
      id: key,
      component: 'form',
      title,
      params: { formId, ...resolvedParams },
      inactive: opts.inactive,
      floating: opts.floating,
      position: this.resolvePosition(opts),
    });
    return panel;
  }

  /** 폼 인스턴스 정책에 따른 패널 키 생성 */
  private keyFor(
    formId: string,
    params: Record<string, any>,
    policy: InstancePolicy,
    opts: OpenOptions,
  ): string {
    // singleton은 호출자가 opts.key 또는 unique:false를 지정해도 복제하지 않는다.
    if (policy === 'singleton') return formId;

    const baseKey = opts.key
      ?? (params.apiId ? `${formId}:${params.apiId}` : formId);

    // multi는 항상 새 패널을 만들고,
    // per-api도 unique:false가 명시되면 새 패널을 만든다.
    // 레이아웃 복원 뒤 seq가 0으로 시작해도 기존 chart#N을 절대 재사용하지 않는다.
    if (policy === 'multi' || opts.unique === false) {
      let key = '';
      do {
        key = `${baseKey}#${++this.seq}`;
      } while (this.api.getPanel(key));
      return key;
    }

    return baseKey;
  }

  private resolvePosition(opts: OpenOptions): any {
    if (opts.floating) return undefined;
    if (!opts.direction) return undefined;
    const ref = opts.referencePanel ?? this.api.activePanel?.id;
    if (!ref) return undefined;
    return { referencePanel: ref, direction: opts.direction };
  }

  close(key: string): void {
    this.clearWindowState(key);
    this.api?.getPanel(key)?.api.close();
  }

  closeAll(): void {
    this.floatingStates.clear();
    this.childBounds.clear();
    this.popoutStates.clear();
    this.api?.panels.slice().forEach(p => p.api.close());
  }

  focus(key: string): void {
    this.api?.getPanel(key)?.api.setActive();
  }

  windowState(key: string): DockWindowSnapshot {
    const panel = this.api?.getPanel(key);
    if (!panel) return { location: 'grid', minimized: false, maximized: false };

    const location = this.locationOf(panel);
    if (location === 'grid') {
      return {
        location,
        minimized: false,
        maximized: panel.api.isMaximized?.() === true,
      };
    }
    if (location === 'floating') {
      const mode = this.floatingStates.get(key)?.mode ?? 'normal';
      return { location, minimized: mode === 'minimized', maximized: mode === 'maximized' };
    }

    const mode = this.popoutStates.get(key)?.mode ?? 'normal';
    return { location, minimized: mode === 'minimized', maximized: mode === 'maximized' };
  }

  /** floating child 또는 popout 창 최소화/이전크기 */
  toggleMinimize(key: string): boolean {
    const panel = this.api?.getPanel(key);
    if (!panel) return false;

    const location = this.locationOf(panel);
    if (location === 'floating') return this.toggleFloatingMinimize(key, panel);
    if (location === 'popout') return this.toggleBrowserMinimize(key, panel);
    return false;
  }

  /** grid는 Dockview native, floating/popout은 실제 창 bounds를 저장/복원한다. */
  toggleMaximize(key: string): boolean {
    const panel = this.api?.getPanel(key);
    if (!panel) return false;

    const location = this.locationOf(panel);
    if (location === 'grid') {
      if (panel.api.isMaximized?.()) panel.api.exitMaximized?.();
      else panel.api.maximize?.();
      return true;
    }
    if (location === 'floating') return this.toggleFloatingMaximize(key, panel);
    return this.toggleBrowserMaximize(key, panel);
  }

  /**
   * floating child ↔ 독립 browser popout 토글.
   * Dockview 1.17.1의 public API 계약대로 group 자체를 전달한다.
   */
  async togglePopout(key: string): Promise<boolean> {
    let panel = this.api?.getPanel(key);
    if (!panel) return false;

    const location = this.locationOf(panel);
    if (location === 'popout') {
      const bounds = this.childBounds.get(key) ?? this.defaultChildBounds();
      this.popoutStates.delete(key);
      this.api.addFloatingGroup(panel.group, bounds);
      panel = this.api.getPanel(key);
      if (!panel || this.locationOf(panel) !== 'floating') return false;
      this.floatingStates.set(key, { mode: 'normal', normalBounds: bounds });
      this.setMinimizedClass(panel, false);
      return true;
    }

    if (location === 'floating') {
      const state = this.floatingStates.get(key);
      const normal = state?.mode === 'normal'
        ? this.captureChildBounds(panel)
        : state?.normalBounds ?? this.captureChildBounds(panel);
      this.childBounds.set(key, normal);

      // 최소화/최대화 상태에서 독립창으로 전환할 때는 정상 크기로 먼저 복원한다.
      if (state?.mode && state.mode !== 'normal') {
        this.applyFloating(panel, normal);
        panel = this.api.getPanel(key) ?? panel;
      }
      this.setMinimizedClass(panel, false);
      this.floatingStates.set(key, { mode: 'normal', normalBounds: normal });
    } else {
      this.childBounds.set(key, this.defaultChildBounds());
    }

    try {
      await this.api.addPopoutGroup(panel.group, {
        popoutUrl: '/popout.html',
        onWillClose: () => {
          this.popoutStates.delete(key);
        },
      });
    } catch (e: any) {
      this.ctx.log.warn(`독립창 전환 실패(${key}): ${e?.message ?? e}`);
      return false;
    }

    panel = this.api.getPanel(key);
    const changed = !!panel && this.locationOf(panel) === 'popout';
    if (!changed) this.ctx.log.warn(`독립창 전환이 완료되지 않았습니다. 팝업 차단 여부를 확인하세요: ${key}`);
    return changed;
  }

  isPopout(key: string): boolean {
    const panel = this.api?.getPanel(key);
    return !!panel && this.locationOf(panel) === 'popout';
  }

  private toggleFloatingMinimize(key: string, panel: IDockviewPanel): boolean {
    const current = this.floatingStates.get(key);
    if (current?.mode === 'minimized') {
      this.applyFloating(panel, current.normalBounds);
      const moved = this.api.getPanel(key) ?? panel;
      this.setMinimizedClass(moved, false);
      this.floatingStates.set(key, { mode: 'normal', normalBounds: current.normalBounds });
      return true;
    }

    const normal = current?.mode === 'maximized'
      ? current.normalBounds
      : this.captureChildBounds(panel);
    const hostWidth = Math.max(1, this.host.clientWidth);
    const hostHeight = Math.max(1, this.host.clientHeight);
    const width = Math.min(hostWidth, Math.max(240, Math.min(MINIMIZED_WIDTH, normal.width)));
    const minimized: ChildWindowBounds = {
      x: Math.max(0, Math.min(normal.x, hostWidth - width)),
      y: Math.max(0, hostHeight - MINIMIZED_HEIGHT),
      width,
      height: MINIMIZED_HEIGHT,
    };

    this.applyFloating(panel, minimized);
    const moved = this.api.getPanel(key) ?? panel;
    this.setMinimizedClass(moved, true);
    this.floatingStates.set(key, { mode: 'minimized', normalBounds: normal });
    return true;
  }

  private toggleFloatingMaximize(key: string, panel: IDockviewPanel): boolean {
    const current = this.floatingStates.get(key);
    if (current?.mode === 'maximized') {
      this.applyFloating(panel, current.normalBounds);
      const moved = this.api.getPanel(key) ?? panel;
      this.setMinimizedClass(moved, false);
      this.floatingStates.set(key, { mode: 'normal', normalBounds: current.normalBounds });
      return true;
    }

    const normal = current?.mode === 'minimized'
      ? current.normalBounds
      : this.captureChildBounds(panel);
    const maximized: ChildWindowBounds = {
      x: 0,
      y: 0,
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
    };

    this.applyFloating(panel, maximized);
    const moved = this.api.getPanel(key) ?? panel;
    this.setMinimizedClass(moved, false);
    this.floatingStates.set(key, { mode: 'maximized', normalBounds: normal });
    return true;
  }

  private toggleBrowserMinimize(key: string, panel: IDockviewPanel): boolean {
    const win = panel.api.getWindow?.();
    if (!win || win.closed) return false;

    const current = this.popoutStates.get(key);
    if (current?.mode === 'minimized') {
      const ok = this.applyBrowserBounds(win, current.normalBounds);
      if (ok) this.popoutStates.set(key, { mode: 'normal', normalBounds: current.normalBounds });
      return ok;
    }

    const normal = current?.mode === 'maximized'
      ? current.normalBounds
      : this.captureBrowserBounds(win);
    const screenInfo: any = win.screen;
    const width = Math.max(320, Math.min(480, normal.width));
    const height = 120;
    const compact: BrowserWindowBounds = {
      left: Math.max(0, normal.left),
      top: (Number(screenInfo?.availTop) || 0) + Math.max(0, (Number(screenInfo?.availHeight) || normal.height) - height),
      width,
      height,
    };
    const ok = this.applyBrowserBounds(win, compact);
    if (ok) {
      this.popoutStates.set(key, { mode: 'minimized', normalBounds: normal });
      try { win.blur(); window.focus(); } catch { /* ignore */ }
    }
    return ok;
  }

  private toggleBrowserMaximize(key: string, panel: IDockviewPanel): boolean {
    const win = panel.api.getWindow?.();
    if (!win || win.closed) return false;

    const current = this.popoutStates.get(key);
    if (current?.mode === 'maximized') {
      const ok = this.applyBrowserBounds(win, current.normalBounds);
      if (ok) this.popoutStates.set(key, { mode: 'normal', normalBounds: current.normalBounds });
      return ok;
    }

    const normal = current?.mode === 'minimized'
      ? current.normalBounds
      : this.captureBrowserBounds(win);
    const screenInfo: any = win.screen;
    const maximized: BrowserWindowBounds = {
      left: Number(screenInfo?.availLeft) || 0,
      top: Number(screenInfo?.availTop) || 0,
      width: Math.max(320, Number(screenInfo?.availWidth) || normal.width),
      height: Math.max(240, Number(screenInfo?.availHeight) || normal.height),
    };
    const ok = this.applyBrowserBounds(win, maximized);
    if (ok) this.popoutStates.set(key, { mode: 'maximized', normalBounds: normal });
    return ok;
  }

  private applyFloating(panel: IDockviewPanel, bounds: ChildWindowBounds): void {
    this.api.addFloatingGroup(panel.group, {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    });
  }

  private captureChildBounds(panel: IDockviewPanel): ChildWindowBounds {
    const rect = panel.group.element.getBoundingClientRect();
    const root = this.host.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left - root.left),
      y: Math.max(0, rect.top - root.top),
      width: Math.max(240, rect.width),
      height: Math.max(120, rect.height),
    };
  }

  private defaultChildBounds(): ChildWindowBounds {
    const hostWidth = Math.max(640, this.host.clientWidth || 640);
    const hostHeight = Math.max(420, this.host.clientHeight || 420);
    const width = Math.min(960, Math.max(520, Math.round(hostWidth * 0.72)));
    const height = Math.min(720, Math.max(360, Math.round(hostHeight * 0.72)));
    return {
      x: Math.max(0, Math.round((hostWidth - width) / 2)),
      y: Math.max(0, Math.round((hostHeight - height) / 2)),
      width,
      height,
    };
  }

  private captureBrowserBounds(win: Window): BrowserWindowBounds {
    return {
      left: Number(win.screenX) || 0,
      top: Number(win.screenY) || 0,
      width: Math.max(320, Number(win.outerWidth) || 900),
      height: Math.max(240, Number(win.outerHeight) || 650),
    };
  }

  private applyBrowserBounds(win: Window, bounds: BrowserWindowBounds): boolean {
    try {
      win.moveTo(Math.round(bounds.left), Math.round(bounds.top));
      win.resizeTo(Math.round(bounds.width), Math.round(bounds.height));
      win.focus();
      return true;
    } catch (e: any) {
      this.ctx.log.warn(`독립창 크기 변경 실패: ${e?.message ?? e}`);
      return false;
    }
  }

  private setMinimizedClass(panel: IDockviewPanel, minimized: boolean): void {
    const overlay = panel.group.element.closest<HTMLElement>('.dv-resize-container');
    overlay?.classList.toggle('kw-window-minimized', minimized);
  }

  private locationOf(panel: IDockviewPanel): DockWindowLocation {
    const location = String((panel.api as any)?.location?.type ?? panel.group?.api?.location?.type ?? 'grid');
    if (location === 'floating' || location === 'popout') return location;
    return 'grid';
  }

  private clearWindowState(key: string): void {
    this.floatingStates.delete(key);
    this.childBounds.delete(key);
    this.popoutStates.delete(key);
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
