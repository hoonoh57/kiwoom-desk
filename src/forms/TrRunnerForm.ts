import { ChildForm } from './ChildForm';
import { getSpec, buildDefaultBody, validateBody, cleanBody, TrSpec, TrField } from '../api/trSchema';

type ViewMode = 'table' | 'json';

export class TrRunnerForm extends ChildForm {
  private apiId = 'ka10001';
  private spec?: TrSpec;
  private body: Record<string, string> = {};
  private view: ViewMode = 'table';
  private lastResult: any = null;
  private contYn = '';
  private nextKey = '';
  private busy = false;
  private rawEdit = false;

  protected onInit(): void {
    const p: any = (this as any).params ?? {};
    this.apiId = p.apiId ?? p.tr ?? this.apiId;
    this.spec = getSpec(this.apiId);

    if (!this.spec) {
      this.html(`<div class="err">알 수 없는 TR: ${this.esc(this.apiId)}<br>src/api/trSchema.ts 에 스키마를 추가하세요.</div>`);
      return;
    }

    this.setTitle(`${this.spec.name} (${this.apiId})`);
    this.body = buildDefaultBody(this.spec, (this.ctx as any).state?.symbol?.code);
    this.render();
  }

  /* ---------- 렌더 ---------- */
  private render(): void {
    const s = this.spec!;
    this.html(`
      <div class="tr-form">
        <div class="tr-head">
          <span class="tr-badge">${this.esc(s.id)}</span>
          <span class="tr-path">${this.esc(s.path)}</span>
          <span class="tr-flex"></span>
          ${s.cont ? `<label class="chk"><input type="checkbox" id="contAll"> 연속조회 전체</label>` : ''}
          <label class="chk"><input type="checkbox" id="rawTgl" ${this.rawEdit ? 'checked' : ''}> JSON 직접편집</label>
          <button class="btn primary" id="run">${this.busy ? '조회중…' : '조회 (F5)'}</button>
        </div>
        ${s.danger ? `<div class="tr-warn">⚠ 실제 주문 TR 입니다. 모의투자 모드인지 확인하세요.</div>` : ''}
        <div class="tr-params" id="params">${this.rawEdit ? this.renderRaw() : this.renderFields(s.fields)}</div>
        <div class="tr-split">
          <div class="tr-req">
            <div class="tr-sub">요청 Body</div>
            <pre id="reqView">${this.esc(JSON.stringify(this.body, null, 2))}</pre>
          </div>
          <div class="tr-res">
            <div class="tr-sub">
              응답
              <span class="tr-flex"></span>
              <button class="lnk ${this.view === 'table' ? 'on' : ''}" id="vTable">표</button>
              <button class="lnk ${this.view === 'json' ? 'on' : ''}" id="vJson">JSON</button>
              ${this.contYn === 'Y' ? `<button class="lnk" id="more">다음 ▸</button>` : ''}
            </div>
            <div class="tr-out" id="out">${this.renderResult()}</div>
          </div>
        </div>
      </div>`);

    this.bind();
  }

  private renderFields(fields: TrField[]): string {
    if (!fields.length) return `<div class="tr-empty">요청 파라미터가 없습니다.</div>`;
    return fields.map(f => {
      const v = this.body[f.key] ?? '';
      const req = f.required ? `<i class="req">*</i>` : '';
      let input: string;
      if (f.kind === 'select') {
        input = `<select data-k="${f.key}">
          ${!f.required ? `<option value="">(선택안함)</option>` : ''}
          ${(f.options ?? []).map(o =>
            `<option value="${this.esc(o.v)}" ${o.v === v ? 'selected' : ''}>${this.esc(o.t)}</option>`).join('')}
        </select>`;
      } else if (f.kind === 'symbol') {
        input = `<span class="fld-sym">
          <input data-k="${f.key}" value="${this.esc(v)}" maxlength="${f.maxLength ?? 20}"
                 placeholder="${this.esc(f.placeholder ?? '')}">
          <button class="mini" data-sym="${f.key}" title="현재 선택종목 적용">⤵</button>
        </span>`;
      } else if (f.kind === 'date') {
        input = `<input data-k="${f.key}" value="${this.esc(v)}" maxlength="8" inputmode="numeric"
                        placeholder="YYYYMMDD" class="w-date">`;
      } else {
        input = `<input data-k="${f.key}" value="${this.esc(v)}" maxlength="${f.maxLength ?? 40}"
                        placeholder="${this.esc(f.placeholder ?? '')}"
                        ${f.kind === 'number' ? 'inputmode="numeric"' : ''}>`;
      }
      return `<div class="fld ${f.required ? 'is-req' : ''}" title="${this.esc(f.help ?? '')}">
        <label>${this.esc(f.label)}${req}<em>${this.esc(f.key)}</em></label>
        ${input}
      </div>`;
    }).join('');
  }

  private renderRaw(): string {
    return `<textarea id="rawBody" class="tr-raw" spellcheck="false">${this.esc(JSON.stringify(this.body, null, 2))}</textarea>`;
  }

  private renderResult(): string {
    const r = this.lastResult;
    if (!r) return `<div class="tr-empty">조회 버튼을 눌러 실행하세요.</div>`;
    if (this.view === 'json') return `<pre>${this.esc(JSON.stringify(r, null, 2))}</pre>`;

    const listKey = this.spec?.listKey;
    const arrKey = listKey && Array.isArray(r[listKey])
      ? listKey
      : Object.keys(r).find(k => Array.isArray(r[k]) && r[k].length && typeof r[k][0] === 'object');

    const scalars = Object.entries(r)
      .filter(([k, v]) => k !== arrKey && typeof v !== 'object')
      .filter(([k]) => k !== 'return_code' && k !== 'return_msg');

    let html = '';
    if (scalars.length) {
      html += `<table class="kv">${scalars.map(([k, v]) =>
        `<tr><th>${this.esc(k)}</th><td>${this.esc(String(v))}</td></tr>`).join('')}</table>`;
    }
    if (arrKey) {
      const rows: any[] = r[arrKey];
      const cols = Object.keys(rows[0] ?? {});
      html += `<div class="tr-sub2">${this.esc(arrKey)} · ${rows.length}건</div>
        <div class="grid-wrap"><table class="grid">
          <thead><tr>${cols.map(c => `<th>${this.esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 500).map(row =>
            `<tr>${cols.map(c => `<td>${this.esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')}
          </tbody></table></div>`;
    }
    return html || `<pre>${this.esc(JSON.stringify(r, null, 2))}</pre>`;
  }

  /* ---------- 이벤트 ---------- */
  private bind(): void {
    this.$('#run')?.addEventListener('click', () => void this.run(false));
    this.$('#more')?.addEventListener('click', () => void this.run(true));
    this.$('#vTable')?.addEventListener('click', () => { this.view = 'table'; this.render(); });
    this.$('#vJson')?.addEventListener('click', () => { this.view = 'json'; this.render(); });

    this.$('#rawTgl')?.addEventListener('change', (e) => {
      this.rawEdit = (e.target as HTMLInputElement).checked;
      this.render();
    });

    this.$('#rawBody')?.addEventListener('input', (e) => {
      try {
        this.body = JSON.parse((e.target as HTMLTextAreaElement).value);
        const rv = this.$('#reqView'); if (rv) rv.textContent = JSON.stringify(this.body, null, 2);
      } catch { /* 편집중 */ }
    });

    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(el => {
      el.addEventListener('input', () => this.pull(el));
      el.addEventListener('change', () => this.pull(el));
    });

    this.root.querySelectorAll<HTMLElement>('[data-sym]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-sym')!;
        const code = (this.ctx as any).state?.symbol?.code ?? '';
        if (!code) return;
        this.body[key] = code;
        this.render();
      });
    });

    this.root.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'F5' || (ke.key === 'Enter' && ke.ctrlKey)) { ke.preventDefault(); void this.run(false); }
    });
  }

  private pull(el: HTMLElement): void {
    const k = el.getAttribute('data-k')!;
    this.body[k] = (el as HTMLInputElement | HTMLSelectElement).value;
    const rv = this.$('#reqView');
    if (rv) rv.textContent = JSON.stringify(this.body, null, 2);
  }

  /* ---------- 실행 ---------- */
  private async run(next: boolean): Promise<void> {
    const s = this.spec!;
    if (this.busy) return;

    const miss = validateBody(s, this.body);
    if (miss.length) {
      this.lastResult = null;
      const out = this.$('#out');
      if (out) out.innerHTML = `<div class="err">필수입력 파라미터 누락\n\n${miss.map(m => ' • ' + m).join('\n')}\n\n※ 전송하지 않았습니다 (API 유량 절약).</div>`;
      this.ctx.log.warn(`${s.id} 필수값 누락: ${miss.join(', ')}`);
      return;
    }

    if (s.danger) {
      const mode = (this.ctx as any).state?.mode ?? '';
      const ok = confirm(`[${mode}] ${s.name}\n\n${JSON.stringify(this.body, null, 2)}\n\n실행하시겠습니까?`);
      if (!ok) return;
    }

    this.busy = true;
    const out = this.$('#out');
    if (out) out.innerHTML = `<div class="loading">요청중…</div>`;

    try {
      const res: any = await this.ctx.api.call(s.id, s.path, cleanBody(s, this.body), {
        contYn: next ? 'Y' : undefined,
        nextKey: next ? this.nextKey : undefined,
      });

      const payload = res?.data ?? res?.body ?? res;
      this.contYn = res?.contYn ? 'Y' : '';
      this.nextKey = res?.nextKey ?? '';

      if (next && this.lastResult && s.listKey && Array.isArray(payload?.[s.listKey])) {
        this.lastResult[s.listKey] = [...(this.lastResult[s.listKey] ?? []), ...payload[s.listKey]];
      } else {
        this.lastResult = payload;
      }
    } catch (e: any) {
      this.lastResult = { return_code: -1, return_msg: String(e?.message ?? e) };
    } finally {
      this.busy = false;
      this.render();
    }
  }

}

