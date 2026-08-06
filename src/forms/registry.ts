import type { AppContext } from '../core/context';
import type { ChildForm } from './ChildForm';
import { getSpec } from '../api/trSchema';

import { WelcomeForm } from './WelcomeForm';
import { OutputForm } from './OutputForm';
import { LogForm } from './LogForm';
import { StockInfoForm } from './StockInfoForm';
import { TrRunnerForm } from './TrRunnerForm';
import { ChartForm } from './ChartForm';
import { AccountForm } from './AccountForm';
import { OrderForm } from './OrderForm';
import { PlaceholderForm } from './PlaceholderForm';
import { ConditionForm } from './ConditionForm';

export type FormFactory = (ctx: AppContext, params: Record<string, any>) => ChildForm;

/**
 * 패널 인스턴스 정책
 *  singleton : 파라미터와 무관하게 앱 전체에서 1개 (WS 구독·타이머 등 상태 보유 폼)
 *  per-api   : apiId 별로 1개 (같은 TR 재클릭 시 재사용)
 *  multi     : 열 때마다 새 패널
 */
export type InstancePolicy = 'singleton' | 'per-api' | 'multi';

export interface FormMeta {
  instance?: InstancePolicy;
  title: string;
  icon?: string;
  category?: string;
  hidden?: boolean;
  defaultParams?: Record<string, any>;
}

/** 팩토리 함수에 메타가 붙은 형태 — 예전 코드의 def.title / def.create 도 동작 */
export type FormDef = FormFactory & {
  id: string; formId: string; title: string; icon?: string; category?: string;
  hidden: boolean; instance: InstancePolicy; defaultParams: Record<string, any>; meta: FormMeta;
  create: FormFactory; factory: FormFactory;
};

/* ---------- 메타 (팩토리보다 먼저 정의) ---------- */
export const FORM_META: Record<string, FormMeta> = {
  welcome:   { title: '시작',      icon: 'home',         category: '보기', instance: 'singleton' },
  output:    { title: '출력',      icon: 'output',       category: '보기', instance: 'singleton' },
  log:       { title: '로그',      icon: 'list-flat',    category: '보기', instance: 'singleton' },
  stockInfo: { title: '종목정보',  icon: 'symbol-class', category: '조회', instance: 'per-api', defaultParams: { apiId: 'ka10001' } },
  trRunner:  { title: 'TR 실행기', icon: 'run-all',      category: '조회', instance: 'per-api', hidden: true },
  chart:     { title: '차트',      icon: 'graph-line',   category: '조회', instance: 'per-api', defaultParams: { apiId: 'ka10081' } },
  account:   { title: '계좌',      icon: 'account',      category: '거래', instance: 'singleton', defaultParams: { tab: 'balance' } },
  order:     { title: '주문',      icon: 'credit-card',  category: '거래', instance: 'singleton', defaultParams: { side: 'buy' } },
  condition: { title: '조건검색',  icon: 'filter',       category: '거래', instance: 'singleton' },
  watchlist: { title: '관심종목',  icon: 'star',         category: '조회', instance: 'singleton' },
  autotrade: { title: '자동매매',  icon: 'rocket',       category: '거래', instance: 'singleton' },
  settings:  { title: '설정',      icon: 'gear',         category: '보기', instance: 'singleton' },
};

const ph = (id: string): FormFactory => (c, p) => new PlaceholderForm(c, { ...p, formId: id });

function decorate(id: string, f: FormFactory): FormDef {
  const meta = FORM_META[id] ?? (FORM_META[id] = { title: id });
  return Object.assign(f, {
    id, formId: id,
    title: meta.title, icon: meta.icon, category: meta.category,
    hidden: !!meta.hidden, instance: meta.instance ?? 'per-api', defaultParams: meta.defaultParams ?? {},
    meta, create: f, factory: f,
  }) as FormDef;
}

const RAW: Record<string, FormFactory> = {
  welcome:   (c, p) => new WelcomeForm(c, p),
  output:    (c, p) => new OutputForm(c, p),
  log:       (c, p) => new LogForm(c, p),
  stockInfo: (c, p) => new StockInfoForm(c, p),
  trRunner:  (c, p) => new TrRunnerForm(c, p),
  chart:     (c, p) => new ChartForm(c, p),
  account:   (c, p) => new AccountForm(c, p),
  order:     (c, p) => new OrderForm(c, p),
  condition: (c, p) => new ConditionForm(c, p),
  watchlist: ph('watchlist'),
  autotrade: ph('autotrade'),
  settings:  ph('settings'),
};

/* ---------- Map 호환 레지스트리 ---------- */
const RESERVED = new Set(['entries', 'keys', 'values', 'get', 'set', 'has', 'delete', 'forEach', 'size']);

export interface FormRegistry extends Record<string, any> {
  entries(): IterableIterator<[string, FormDef]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<FormDef>;
  get(id: string): FormDef | undefined;
  set(id: string, f: FormFactory, meta?: FormMeta): void;
  has(id: string): boolean;
  delete(id: string): boolean;
  forEach(cb: (f: FormDef, id: string) => void): void;
  readonly size: number;
}

function makeRegistry(): FormRegistry {
  const reg = {} as FormRegistry;
  for (const [id, f] of Object.entries(RAW)) (reg as any)[id] = decorate(id, f);

  const ids = () => Object.keys(reg).filter(k => !RESERVED.has(k) && typeof (reg as any)[k] === 'function');
  const def = (name: string, value: any) =>
    Object.defineProperty(reg, name, { value, enumerable: false, writable: true, configurable: true });

  def('entries', function* () { for (const k of ids()) yield [k, (reg as any)[k]] as [string, FormDef]; });
  def('keys',    function* () { for (const k of ids()) yield k; });
  def('values',  function* () { for (const k of ids()) yield (reg as any)[k] as FormDef; });
  def('get', (id: string) => (reg as any)[id] as FormDef | undefined);
  def('set', (id: string, f: FormFactory, meta?: FormMeta) => {
    if (meta) FORM_META[id] = meta;
    (reg as any)[id] = decorate(id, f);
  });
  def('has', (id: string) => typeof (reg as any)[id] === 'function');
  def('delete', (id: string) => delete (reg as any)[id]);
  def('forEach', (cb: (f: FormDef, id: string) => void) => { for (const k of ids()) cb((reg as any)[k], k); });
  Object.defineProperty(reg, 'size', { get: () => ids().length, enumerable: false, configurable: true });
  Object.defineProperty(reg, Symbol.iterator, {
    value: function* () { for (const k of ids()) yield [k, (reg as any)[k]] as [string, FormDef]; },
    enumerable: false, configurable: true,
  });
  return reg;
}

export const formRegistry: FormRegistry = makeRegistry();

/* ---------- API ---------- */
export function registerForm(formId: string, factory: FormFactory, meta?: FormMeta): void {
  formRegistry.set(formId, factory, meta);
}
export function hasForm(formId: string): boolean { return formRegistry.has(formId); }
export function listForms(): string[] { return Array.from(formRegistry.keys()); }
export function formDefs(): FormDef[] { return Array.from(formRegistry.values()); }
export function formEntries(): Array<[string, FormDef]> { return Array.from(formRegistry.entries()); }
export function formInstancePolicy(formId: string): InstancePolicy {
  return FORM_META[formId]?.instance ?? 'per-api';
}
export function getFormMeta(formId: string): FormMeta {
  return FORM_META[formId] ?? { title: formId };
}
export function registerBuiltinForms(_ctx?: AppContext): FormRegistry { return formRegistry; }

export function createForm(formId: string, ctx: AppContext, params: Record<string, any> = {}): ChildForm {
  const f = formRegistry.get(formId);
  if (f) return f(ctx, params);
  if (params?.apiId) return formRegistry.get('trRunner')!(ctx, params);
  return new PlaceholderForm(ctx, { ...params, formId });
}

export function formTitle(formId: string, params: Record<string, any> = {}): string {
  if (params?.title) return String(params.title);
  const apiId = params?.apiId as string | undefined;
  if (apiId) {
    const spec = getSpec(apiId);
    if (spec) return spec.name;
  }
  return getFormMeta(formId).title;
}

export default formRegistry;
