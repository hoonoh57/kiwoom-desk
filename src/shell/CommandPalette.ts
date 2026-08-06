// CommandPalette.ts
import type { AppContext } from '../core/context';

export class CommandPalette {
  private el!: HTMLElement;
  constructor(private ctx: AppContext) {}

  mount(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'palette hidden';
    this.el.innerHTML = `<div class="palette-box">
      <input id="palInput" placeholder="명령 입력 (예: 주식기본정보)" />
      <div class="palette-list" id="palList"></div></div>`;
    root.appendChild(this.el);

    const input = this.el.querySelector<HTMLInputElement>('#palInput')!;
    const list = this.el.querySelector<HTMLElement>('#palList')!;
    const render = () => {
      const q = input.value.toLowerCase();
      const items = this.ctx.commands.all()
        .filter(c => !q || `${c.category ?? ''} ${c.title}`.toLowerCase().includes(q)).slice(0, 40);
      list.innerHTML = items.map((c, i) =>
        `<div class="pal-item ${i === 0 ? 'sel' : ''}" data-id="${c.id}">
           <span class="pal-cat">${c.category ?? ''}</span>${c.title}
           <span class="pal-key">${c.keybinding ?? ''}</span></div>`).join('');
    };
    input.addEventListener('input', render);
    this.el.addEventListener('click', e => {
      const it = (e.target as HTMLElement).closest<HTMLElement>('.pal-item');
      if (it) { this.hide(); void this.ctx.commands.execute(it.dataset.id!); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.hide();
      if (e.key === 'Enter') {
        const sel = list.querySelector<HTMLElement>('.pal-item.sel') ?? list.firstElementChild as HTMLElement;
        if (sel) { this.hide(); void this.ctx.commands.execute(sel.dataset.id!); }
      }
    });
    this.ctx.bus.on('palette.toggle', () => { this.el.classList.contains('hidden') ? this.show(render, input) : this.hide(); });
  }
  private show(render: () => void, input: HTMLInputElement) {
    this.el.classList.remove('hidden'); input.value = ''; render(); input.focus();
  }
  hide() { this.el.classList.add('hidden'); }
}
