import type { AppContext } from '../core/context';
import { TR_CATALOG } from '../api/endpoints';
import { formRegistry } from '../forms/registry';

export function registerCommands(ctx: AppContext) {
  const c = ctx.commands;
  c.register({ id: 'palette.show', title: '명령 팔레트 표시', category: '보기',
    keybinding: 'ctrl+shift+p', run: () => ctx.bus.emit('palette.toggle', null) });

  c.register({ id: 'form.open', title: '폼 열기', category: '보기',
    run: (formId: string, args?: any) => ctx.dock.open(formId, { args }) });

  c.register({ id: 'layout.save', title: '레이아웃 저장', category: '파일',
    run: () => { localStorage.setItem('kd.layout', ctx.dock.saveLayout()); ctx.log.info('레이아웃 저장됨'); } });

  c.register({ id: 'layout.reset', title: '레이아웃 초기화', category: '파일',
    run: () => { localStorage.removeItem('kd.layout'); location.reload(); } });

  c.register({ id: 'rt.connect', title: '실시간(WS) 연결', category: '연결',
    run: () => ctx.rt.connect() });

  // 등록된 모든 폼과 모든 TR 을 팔레트에서 바로 열 수 있게 확장
  for (const [id, e] of formRegistry.entries())
    c.register({ id: `open.${id}`, title: `열기: ${e.meta.title}`, category: '폼', run: () => ctx.dock.open(id) });

  for (const g of TR_CATALOG)
    for (const t of g.items)
      c.register({ id: `tr.${t.id}`, title: `${t.name} (${t.id})`, category: g.label,
        run: () => ctx.dock.open('trRunner', { args: { trId: t.id, path: t.path, title: t.name } }) });
}
