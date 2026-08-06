import type { AppContext } from '../core/context';

let __formSeq = 0;

export abstract class ChildForm {
  readonly formKey = `form#${++__formSeq}`;
  protected root!: HTMLElement;
  protected panelApi: any;
  protected params: Record<string, any>;
  private disposers: Array<() => void> = [];
  private mounted = false;

  constructor(protected ctx: AppContext, params: Record<string, any> = {}) {
    this.params = { ...params };
  }

  /** DockHost 가 호출 */
  attach(host: HTMLElement, panelApi?: any): void {
    this.panelApi = panelApi;
    this.root = document.createElement('div');
    this.root.className = 'form-root';
    this.root.tabIndex = 0;
    host.appendChild(this.root);
    this.mounted = true;

    if (panelApi?.onDidDimensionsChange) {
      const d = panelApi.onDidDimensionsChange((e: any) =>
        this.onResize(e?.width ?? this.root.clientWidth, e?.height ?? this.root.clientHeight));
      this.track(() => d.dispose());
    }
    if (panelApi?.onDidVisibilityChange) {
      const d = panelApi.onDidVisibilityChange((e: any) => this.onVisibility(!!e?.isVisible));
      this.track(() => d.dispose());
    }

    this.onInit();
  }

  /** 같은 패널에 다른 파라미터가 들어오면 폼을 재초기화 */
  setParams(params: Record<string, any>): void {
    const next = { ...this.params, ...params };
    const changed = JSON.stringify(next) !== JSON.stringify(this.params);
    this.params = next;
    if (!changed || !this.mounted) return;
    this.releaseTracked();
    this.root.innerHTML = '';
    this.onInit();
  }

  protected track(dispose: (() => void) | { dispose(): void }): void {
    this.disposers.push(typeof dispose === 'function' ? dispose : () => dispose.dispose());
  }

  private releaseTracked(): void {
    for (const d of this.disposers.splice(0)) { try { d(); } catch { /* ignore */ } }
    this.onRelease();
  }

  dispose(): void {
    this.releaseTracked();
    this.mounted = false;
  }

  /* ---------- 하위 클래스 훅 ---------- */
  protected abstract onInit(): void;
  protected onResize(_w: number, _h: number): void {}
  protected onVisibility(_visible: boolean): void {}
  protected onRelease(): void {}

  /* ---------- 유틸 ---------- */
  protected setTitle(t: string): void { this.panelApi?.setTitle?.(t); }
  protected closeSelf(): void { this.panelApi?.close?.(); }
  protected html(s: string): void { this.root.innerHTML = s; }
  protected $<T extends HTMLElement = HTMLElement>(sel: string): T | null {
    return this.root.querySelector<T>(sel);
  }
  protected $$<T extends HTMLElement = HTMLElement>(sel: string): T[] {
    return Array.from(this.root.querySelectorAll<T>(sel));
  }
  protected esc(s: any): string {
    return String(s ?? '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  }
  /** 키움 응답 숫자 정규화 (+000123 / -1,234 → 123 / -1234) */
  protected num(v: any): number {
    const s = String(v ?? '').replace(/[,\s]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  protected abs(v: any): number { return Math.abs(this.num(v)); }
  protected fmt(v: any, digits = 0): string {
    const n = this.num(v);
    return n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  /** 응답 래퍼 벗기기 */
  protected payload(res: any): any { return res?.data ?? res?.body ?? res ?? {}; }
}

export default ChildForm;
