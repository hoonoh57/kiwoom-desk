import type { AppContext } from './context';
import { formEntries, getFormMeta } from '../forms/registry';
import { TR_FLAT } from '../api/endpoints';

export interface Command {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;   // 'ctrl+shift+p', 'f5', 'ctrl+s' …
  when?: () => boolean;
  run: (...args: any[]) => any;
}

function normalizeCombo(e: KeyboardEvent): string {
  const key = (e.key ?? '').toLowerCase();
  return [
    e.ctrlKey || e.metaKey ? 'ctrl' : '',
    e.shiftKey ? 'shift' : '',
    e.altKey ? 'alt' : '',
    key === ' ' ? 'space' : key,
  ].filter(Boolean).join('+');
}

export class CommandRegistry {
  private map = new Map<string, Command>();
  private listeners = new Set<() => void>();
  private detachers: Array<() => void> = [];

  /* ---------- 등록 ---------- */
  register(cmd: Command): () => void;
  register(id: string, title: string, run: (...a: any[]) => any, category?: string, keybinding?: string): () => void;
  register(a: Command | string, title?: string, run?: (...x: any[]) => any, category?: string, keybinding?: string): () => void {
    const cmd: Command = typeof a === 'string'
      ? { id: a, title: title ?? a, run: run ?? (() => {}), category, keybinding }
      : a;
    if (!cmd?.id) return () => {};
    this.map.set(cmd.id, cmd);
    this.changed();
    return () => { this.map.delete(cmd.id); this.changed(); };
  }

  add(cmd: Command): () => void { return this.register(cmd); }
  unregister(id: string): void { this.map.delete(id); this.changed(); }
  has(id: string): boolean { return this.map.has(id); }
  get(id: string): Command | undefined { return this.map.get(id); }

  /* ---------- 열거 (여러 이름 호환) ---------- */
  list(): Command[] { return Array.from(this.map.values()); }
  all(): Command[] { return this.list(); }
  getAll(): Command[] { return this.list(); }
  getCommands(): Command[] { return this.list(); }
  get commands(): Command[] { return this.list(); }
  get size(): number { return this.map.size; }
  entries(): IterableIterator<[string, Command]> { return this.map.entries(); }
  keys(): IterableIterator<string> { return this.map.keys(); }
  values(): IterableIterator<Command> { return this.map.values(); }
  [Symbol.iterator]() { return this.map.entries(); }

  /* ---------- 실행 ---------- */
  execute(id: string, ...args: any[]): any {
    const c = this.map.get(id);
    if (!c) { console.warn(`[commands] 없는 커맨드: ${id}`); return; }
    if (c.when && !c.when()) return;
    try { return c.run(...args); }
    catch (e: any) { console.error(`[commands] ${id} 실행 오류`, e); }
  }
  run(id: string, ...args: any[]): any { return this.execute(id, ...args); }
  exec(id: string, ...args: any[]): any { return this.execute(id, ...args); }

  search(q: string): Command[] {
    const s = (q ?? '').trim().toLowerCase();
    if (!s) return this.list();
    return this.list().filter(c =>
      c.title.toLowerCase().includes(s) ||
      c.id.toLowerCase().includes(s) ||
      (c.category ?? '').toLowerCase().includes(s));
  }

  onDidChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private changed(): void { this.listeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }

  /* ---------- 키보드 바인딩 ---------- */
  /** 전역 키 핸들러 부착. Workbench.render() 에서 호출. */
  attachKeyboard(target: HTMLElement | Document | Window = document): () => void {
    const handler = (ev: Event) => {
      const e = ev as KeyboardEvent;
      if (!e.key) return;

      // 입력 중에는 단축키를 가로채지 않음 (Ctrl/Alt 조합은 예외)
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const combo = normalizeCombo(e);
      if (typing && !e.ctrlKey && !e.metaKey && !e.altKey && !/^f\d+$/.test(combo)) return;

      const hit = this.list().find(c => c.keybinding && c.keybinding.toLowerCase() === combo);
      if (!hit) return;
      if (hit.when && !hit.when()) return;
      e.preventDefault();
      e.stopPropagation();
      this.execute(hit.id);
    };

    (target as any).addEventListener('keydown', handler, true);
    const detach = () => (target as any).removeEventListener('keydown', handler, true);
    this.detachers.push(detach);
    return detach;
  }

  /** 별칭 */
  attachKeybindings(target?: HTMLElement | Document | Window): () => void { return this.attachKeyboard(target); }
  bindKeys(target?: HTMLElement | Document | Window): () => void { return this.attachKeyboard(target); }

  detachKeyboard(): void {
    this.detachers.splice(0).forEach(d => { try { d(); } catch { /* ignore */ } });
  }

  dispose(): void {
    this.detachKeyboard();
    this.map.clear();
    this.listeners.clear();
  }
}

/* ---------- 기본 커맨드 ---------- */
export function registerCommands(ctx: AppContext): void {
  const reg = ctx.commands;
  const dock = () => (ctx as any).dock;

  // 폼 열기
  for (const [formId] of formEntries()) {
    const meta = getFormMeta(formId);
    if (meta.hidden) continue;
    reg.register({
      id: `view.open.${formId}`,
      title: `열기: ${meta.title}`,
      category: meta.category ?? '보기',
      run: () => dock()?.open(formId, { ...(meta.defaultParams ?? {}) }, {}),
    });
  }

  // TR 실행
  for (const tr of TR_FLAT) {
    reg.register({
      id: `tr.${tr.apiId}`,
      title: `${tr.apiId} ${tr.name}`,
      category: `TR · ${tr.group}`,
      run: () => dock()?.open(tr.formId, { apiId: tr.apiId }, {}),
    });
  }

  // 자주 쓰는 폼 단축키
  reg.register({ id: 'view.chart', title: '차트 열기', category: '보기', keybinding: 'ctrl+1',
    run: () => dock()?.open('chart', { apiId: 'ka10081' }, {}) });
  reg.register({ id: 'view.stockInfo', title: '종목정보 열기', category: '보기', keybinding: 'ctrl+2',
    run: () => dock()?.open('stockInfo', { apiId: 'ka10001' }, {}) });
  reg.register({ id: 'view.account', title: '계좌 열기', category: '보기', keybinding: 'ctrl+3',
    run: () => dock()?.open('account', { tab: 'balance' }, {}) });
  reg.register({ id: 'view.order', title: '주문 열기', category: '보기', keybinding: 'ctrl+4',
    run: () => dock()?.open('order', { side: 'buy' }, {}) });
  reg.register({ id: 'view.output', title: '출력 패널 열기', category: '보기', keybinding: 'ctrl+`',
    run: () => dock()?.open('output', {}, { direction: 'below' }) });

  // 레이아웃
  reg.register({ id: 'layout.save', title: '레이아웃 저장', category: '레이아웃', keybinding: 'ctrl+s',
    run: () => { dock()?.saveLayout(); ctx.log.info('레이아웃 저장됨'); } });
  reg.register({ id: 'layout.reset', title: '레이아웃 초기화', category: '레이아웃',
    run: () => {
      if (!confirm('레이아웃을 초기화하고 모든 패널을 닫을까요?')) return;
      dock()?.resetLayout();
      dock()?.open('welcome', {}, {});
    } });
  reg.register({ id: 'layout.closeAll', title: '모든 패널 닫기', category: '레이아웃',
    run: () => dock()?.closeAll() });

  // 연결
  reg.register({ id: 'conn.status', title: '연결 상태 확인', category: '연결',
    run: async () => {
      try {
        const s = await ctx.api.status();
        ctx.log.info(`모드=${s.mode} 토큰=${s.tokenValid ? '유효' : '무효'}`);
      } catch (e: any) { ctx.log.error(`상태 조회 실패: ${e?.message ?? e}`); }
    } });
  reg.register({ id: 'conn.wsReconnect', title: 'WebSocket 재연결', category: '연결',
    run: () => { const rt: any = (ctx as any).rt; rt?.reconnect ? rt.reconnect() : rt?.connect?.(); } });

  ctx.log.debug(`커맨드 ${reg.size}개 등록`);
}

/** 함수형 호출도 계속 지원 */
export function attachKeybindings(ctx: AppContext, target: HTMLElement | Document = document): () => void {
  return ctx.commands.attachKeyboard(target);
}

export default CommandRegistry;
