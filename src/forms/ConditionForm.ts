import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

interface Cond { seq: string; name: string; }

/** 조건검색 응답 필드 코드 → 라벨 */
const F: Record<string, string> = {
  '9001': '종목코드', '302': '종목명', '10': '현재가', '11': '전일대비',
  '12': '등락률', '13': '누적거래량', '16': '시가', '17': '고가', '18': '저가',
  '20': '시간', '25': '전일대비기호', '841': '조건식', '843': '편입이탈', '907': '매도수구분',
};

/** 표에 직접 찍지 않는 필드. 25 는 색상 판정용으로만 쓴다. */
const HIDE = new Set(['25', '841', '843', '907', 'jmcode']);

/** 이 순서로 먼저 배치한다. 나머지는 뒤에 원래 순서대로 붙는다. */
const ORDER = ['9001', '302', '10', '11', '12', '13', '16', '17', '18', '20'];

/** 부호가 방향 표시일 뿐이라 절대값으로 보여줘야 하는 가격 필드 */
const ABS = new Set(['10', '16', '17', '18']);

/** 우측 정렬할 숫자 필드 */
const NUM = new Set(['10', '11', '12', '13', '16', '17', '18']);

/** 주식체결(0B)에서 조건검색 그리드에 반영할 표준 필드 */
const QUOTE_FIELDS = ['10', '11', '12', '13', '16', '17', '18', '20', '25'] as const;

export class ConditionForm extends ChildForm {
  private conds: Cond[] = [];
  private sel = '';
  private rows: any[] = [];
  private liveSeq = '';
  private busy = false;
  private events: string[] = [];
  private selectedCode = '';

  private quoteGroup = '';
  private quoteCodes: string[] = [];
  private snapshotTimer?: number;
  private paintFrame?: number;

  protected onInit(): void {
    this.setTitle('조건검색');
    this.render();
    void this.loadList();

    // WS LOGIN이 폼 오픈보다 늦을 수 있다.
    // 연결이 끊기면 서버 측 실시간 등록과 시세 구독도 유효하지 않으므로
    // 로컬 상태와 체크박스를 함께 초기화한다.
    this.track(this.ctx.bus.on(Topics.WsChanged, (p: any) => {
      if (!p?.connected) {
        const wasLive = this.liveSeq !== '';
        this.liveSeq = '';
        this.quoteGroup = '';
        this.quoteCodes = [];
        this.cancelScheduledSnapshot();
        this.syncLiveCheck();

        if (wasLive) {
          this.info('WS 연결이 끊겨 실시간 등록 상태를 초기화했습니다.');
        }
        return;
      }

      if (!this.conds.length) {
        void this.loadList();
      }
    }));

    this.track(this.ctx.bus.on(Topics.RealtimeTick, (d: any) => {
      if (!this.liveSeq) return;

      const v = d?.values ?? d ?? {};
      const io = String(v['843'] ?? '').trim();

      if (io) {
        this.onConditionMembership(d, v, io);
        return;
      }

      if (String(d?.type ?? '') === '0B') {
        this.onRealtimeQuote(d, v);
      }
    }));

    // ChildForm.dispose()/setParams()에서 호출된다.
    // 현재 콤보박스 값이 아니라 실제 등록된 조건식 번호를 해제한다.
    this.track(() => {
      this.cancelScheduledSnapshot();

      if (this.paintFrame !== undefined) {
        cancelAnimationFrame(this.paintFrame);
        this.paintFrame = undefined;
      }

      this.clearQuoteRegistration();

      const seq = this.liveSeq;
      this.liveSeq = '';

      if (!seq || !this.ctx.rt.connected) return;

      void this.ctx.rt.conditionClear(seq)
        .then((m: any) => {
          if (Number(m?.return_code) !== 0) {
            this.ctx.log.warn(
              `조건검색 실시간 해제 실패(${seq}): `
              + `rc=${m?.return_code ?? '?'} ${m?.return_msg ?? ''}`,
            );
          }
        })
        .catch((e: any) => {
          this.ctx.log.warn(
            `조건검색 실시간 해제 예외(${seq}): ${e?.message ?? e}`,
          );
        });
    });
  }

  private render(): void {
    this.html(`
      <div class="cnd-form">
        <div class="cnd-bar">
          <select id="kSel" class="cnd-sel"><option value="">조건식 로딩중…</option></select>
          <button class="btn primary" id="kGo">검색</button>
          <label class="chk"><input type="checkbox" id="kLive"> 실시간 등록</label>
          <span class="tr-flex"></span>
          <span class="tr-badge">ka10171/2/3/4</span>
          <button class="lnk" id="kReload">목록 새로고침</button>
        </div>
        <div class="cnd-split">
          <div class="cnd-main">
            <div class="tr-sub2" id="kInfo">조건식을 선택하고 검색하세요.</div>
            <div class="grid-wrap" id="kRows"></div>
          </div>
          <div class="cnd-side">
            <div class="tr-sub2">실시간 편입/이탈</div>
            <div class="cnd-ev" id="kEv"><div class="tr-empty">대기중</div></div>
          </div>
        </div>
      </div>`);

    this.$('#kGo')?.addEventListener('click', () => void this.search());
    this.$('#kReload')?.addEventListener('click', () => void this.loadList());
    this.$<HTMLSelectElement>('#kSel')?.addEventListener('change', e => {
      const next = (e.target as HTMLSelectElement).value;
      const shouldMoveLive =
        this.liveSeq !== ''
        && this.liveSeq !== next;

      this.sel = next;

      if (shouldMoveLive) {
        void this.toggleLive(true);
      }
    });

    this.$<HTMLInputElement>('#kLive')?.addEventListener('change', e => {
      const box = e.target as HTMLInputElement;
      void this.toggleLive(box.checked);
    });
  }

  private setControlsBusy(on: boolean): void {
    const select = this.$<HTMLSelectElement>('#kSel');
    const live = this.$<HTMLInputElement>('#kLive');
    const search = this.$<HTMLButtonElement>('#kGo');
    const reload = this.$<HTMLButtonElement>('#kReload');

    if (select) select.disabled = on;
    if (live) live.disabled = on;
    if (search) search.disabled = on;
    if (reload) reload.disabled = on;
  }

  private syncLiveCheck(): void {
    const box = this.$<HTMLInputElement>('#kLive');
    if (box) box.checked = this.liveSeq !== '';
  }

  private assertOk(message: any, operation: string): void {
    const rc = Number(message?.return_code);

    if (Number.isFinite(rc) && rc === 0) {
      return;
    }

    const rawCode = message?.return_code ?? '?';
    const rawMessage = String(message?.return_msg ?? '').trim();

    throw new Error(
      `${operation} 실패 · rc=${rawCode}`
      + (rawMessage ? ` · ${rawMessage}` : ''),
    );
  }

  /** 시장구분 접두 문자 제거: A005930 → 005930 */
  private plain(code: string): string {
    return code.trim().replace(/^[A-Za-z]+/, '');
  }

  /** 숫자로 해석 가능하면 number, 아니면 null */
  private toNum(raw: string): number | null {
    const s = raw.replace(/,/g, '').trim();

    if (
      s === ''
      || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)
    ) {
      return null;
    }

    const value = Number(s);
    return Number.isFinite(value) ? value : null;
  }

  /** 25(전일대비기호)로 등락 방향 판정. 없으면 11 의 부호로 대체. */
  private dir(r: any): number {
    const s = String(r?.['25'] ?? '').trim();
    if (s === '1' || s === '2') return 1;
    if (s === '4' || s === '5') return -1;
    if (s === '3') return 0;
    const n = this.toNum(String(r?.['11'] ?? ''));
    return n === null ? 0 : Math.sign(n);
  }

  /**
   * 일반 조건검색의 FID 12는 소수점 둘째 자리를 생략한 정수 문자열이다.
   * 예: -00000130 → -1.30%. 실시간 주식체결(0B)은 -1.30처럼
   * 실제 소수 문자열이므로 이 정규화는 snapshot 입력에만 적용한다.
   */
  private normalizeSnapshotRate(raw: unknown): unknown {
    const text = String(raw ?? '').replace(/,/g, '').trim();
    if (!text || text.includes('.')) return raw;
    const value = this.toNum(text);
    return value === null ? raw : String(value / 100);
  }

  private normRows(data: any): any[] {
    if (!Array.isArray(data)) return [];

    return data
      .map((raw: any) => {
        if (!raw) return null;
        const row = Array.isArray(raw) ? { ...raw } : { ...raw };

        if (!row['9001'] && row.jmcode) {
          row['9001'] = row.jmcode;
        }

        if (Object.prototype.hasOwnProperty.call(row, '12')) {
          row['12'] = this.normalizeSnapshotRate(row['12']);
        }

        return row;
      })
      .filter(Boolean);
  }

  private rowCode(row: any): string {
    return this.plain(
      String(row?.['9001'] ?? row?.jmcode ?? row?.stk_cd ?? ''),
    );
  }

  private findRow(code: string): any | undefined {
    return this.rows.find(row => this.rowCode(row) === code);
  }

  private scheduleRowsPaint(): void {
    if (this.paintFrame !== undefined) return;

    this.paintFrame = requestAnimationFrame(() => {
      this.paintFrame = undefined;
      this.paintRows();
    });
  }

  private cancelScheduledSnapshot(): void {
    if (this.snapshotTimer !== undefined) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  private scheduleLiveSnapshot(): void {
    this.cancelScheduledSnapshot();
    const seq = this.liveSeq;
    if (!seq) return;

    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = undefined;
      void this.refreshLiveSnapshot(seq);
    }, 600);
  }

  private async refreshLiveSnapshot(seq: string): Promise<void> {
    if (
      !seq
      || this.liveSeq !== seq
      || !this.ctx.rt.connected
    ) {
      return;
    }

    try {
      const snapshot: any =
        await this.ctx.rt.conditionSearch(seq, '0');

      this.assertOk(snapshot, `조건식 ${seq} 실시간 동기화`);

      if (this.liveSeq !== seq) return;

      this.rows = this.normRows(snapshot?.data);
      this.syncQuoteRegistration();
      this.paintRows();
      this.info(`실시간 등록됨 · 조건식 ${seq} · ${this.rows.length}종목`);
    } catch (e: any) {
      this.ctx.log.warn(
        `조건식 ${seq} 실시간 화면 동기화 실패: ${e?.message ?? e}`,
      );
    }
  }

  private onConditionMembership(d: any, v: any, io: string): void {
    const code = this.plain(
      String(v['9001'] ?? d?.item ?? ''),
    );
    if (!code) return;

    if (io === 'I') {
      let row = this.findRow(code);
      if (!row) {
        row = { '9001': code };
        this.rows.push(row);
      }
      if (v['20'] !== undefined) row['20'] = v['20'];
    } else if (io === 'D') {
      this.rows = this.rows.filter(row => this.rowCode(row) !== code);
      if (this.selectedCode === code) this.selectedCode = '';
    }

    const tag =
      io === 'I'
        ? '편입'
        : io === 'D'
          ? '이탈'
          : io;

    this.events.unshift(
      `${new Date().toLocaleTimeString('ko-KR')} [${tag}] ${code}`,
    );

    this.events = this.events.slice(0, 200);
    this.paintEvents();
    this.scheduleRowsPaint();
    this.scheduleLiveSnapshot();
  }

  private onRealtimeQuote(d: any, v: any): void {
    const code = this.plain(
      String(d?.item ?? v['9001'] ?? ''),
    );
    if (!code || !this.quoteCodes.includes(code)) return;

    const row = this.findRow(code);
    if (!row) return;

    for (const field of QUOTE_FIELDS) {
      if (v[field] !== undefined && String(v[field]).trim() !== '') {
        row[field] = v[field];
      }
    }

    this.scheduleRowsPaint();
  }

  private clearQuoteRegistration(): void {
    const group = this.quoteGroup;
    const codes = [...this.quoteCodes];

    this.quoteGroup = '';
    this.quoteCodes = [];

    if (
      group
      && codes.length
      && this.ctx.rt.connected
    ) {
      this.ctx.rt.unregister(group, codes, ['0B']);
    }
  }

  private syncQuoteRegistration(): void {
    const codes = Array.from(new Set(
      this.rows.map(row => this.rowCode(row)).filter(Boolean),
    )).sort().slice(0, 100);

    const unchanged =
      this.quoteGroup !== ''
      && codes.length === this.quoteCodes.length
      && codes.every((code, index) => code === this.quoteCodes[index]);

    if (unchanged) return;

    this.clearQuoteRegistration();

    if (
      !this.liveSeq
      || !this.ctx.rt.connected
      || !codes.length
    ) {
      return;
    }

    this.quoteCodes = codes;
    this.quoteGroup = this.ctx.rt.register(codes, ['0B'], '1');
  }

  private async loadList(): Promise<void> {
    const selEl = this.$<HTMLSelectElement>('#kSel');

    if (!this.ctx.rt.connected) {
      if (selEl) {
        selEl.innerHTML =
          `<option value="">WS 연결 대기중…</option>`;
      }

      this.info(
        'WS LOGIN 대기중… 연결되면 자동으로 목록을 불러옵니다.',
      );
      return;
    }

    const previous = this.sel;

    try {
      const m: any = await this.ctx.rt.conditionList();
      this.assertOk(m, '조건식 목록 조회');

      const raw = m?.data ?? [];

      this.conds = raw
        .map((x: any) =>
          Array.isArray(x)
            ? {
                seq: String(x[0] ?? ''),
                name: String(x[1] ?? ''),
              }
            : {
                seq: String(x?.seq ?? ''),
                name: String(x?.name ?? ''),
              },
        )
        .filter((c: Cond) => c.seq !== '');

      const hasPrevious =
        this.conds.some(c => c.seq === previous);

      const hasLive =
        this.liveSeq !== ''
        && this.conds.some(c => c.seq === this.liveSeq);

      this.sel =
        hasPrevious
          ? previous
          : hasLive
            ? this.liveSeq
            : this.conds[0]?.seq ?? '';

      if (selEl) {
        selEl.innerHTML = this.conds.length
          ? this.conds.map(c =>
              `<option value="${this.esc(c.seq)}">`
              + `${this.esc(c.seq)} · ${this.esc(c.name)}`
              + `</option>`,
            ).join('')
          : `<option value="">`
            + `등록된 조건식이 없습니다 (영웅문4에서 생성)`
            + `</option>`;

        selEl.value = this.sel;
      }

      this.syncLiveCheck();
      this.info(`조건식 ${this.conds.length}개`);
    } catch (e: any) {
      this.info(`목록 조회 실패: ${e?.message ?? e}`);
    }
  }

  private async search(): Promise<void> {
    if (!this.sel) {
      this.info('조건식을 선택하세요.');
      return;
    }

    if (this.busy) return;

    const seq = this.sel;

    this.busy = true;
    this.setControlsBusy(true);
    this.info('검색중…');

    try {
      const m: any =
        await this.ctx.rt.conditionSearch(seq, '0');

      this.assertOk(m, '조건검색');

      this.rows = this.normRows(m?.data);
      this.paintRows();

      if (this.liveSeq === seq) {
        this.syncQuoteRegistration();
      }

      this.info(
        `${this.rows.length}종목 포착`
        + ` · 조건식 ${seq}`
        + ` · 행 클릭 시 차트 연동`,
      );
    } catch (e: any) {
      this.info(`검색 실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
      this.setControlsBusy(false);
      this.syncLiveCheck();
    }
  }

  private async toggleLive(on: boolean): Promise<void> {
    if (this.busy) {
      this.syncLiveCheck();
      return;
    }

    if (on && !this.sel) {
      this.info('조건식을 먼저 선택하세요.');
      this.syncLiveCheck();
      return;
    }

    this.busy = true;
    this.setControlsBusy(true);

    try {
      if (on) {
        const target = this.sel;

        if (this.liveSeq === target) {
          this.syncQuoteRegistration();
          this.info(`이미 실시간 등록됨 · 조건식 ${target}`);
          return;
        }

        // 다른 조건식이 등록돼 있으면 반드시 실제 등록 번호로 먼저 해제한다.
        if (this.liveSeq) {
          const previous = this.liveSeq;
          const clearMessage: any =
            await this.ctx.rt.conditionClear(previous);

          this.assertOk(
            clearMessage,
            `기존 실시간 조건식 ${previous} 해제`,
          );

          this.clearQuoteRegistration();
          this.cancelScheduledSnapshot();
          this.liveSeq = '';
        }

        const registration: any =
          await this.ctx.rt.conditionSearch(target, '1');

        this.assertOk(
          registration,
          `실시간 조건식 ${target} 등록`,
        );

        // 성공 응답을 받은 뒤에만 실제 등록 상태를 확정한다.
        this.liveSeq = target;

        /*
         * search_type=1의 최초 조회 데이터는 jmcode만 반환한다.
         * 실패 시 사용할 fallback으로 보관하고, 이어지는 일반검색으로
         * 종목명·현재가·등락률·거래량 등의 상세 snapshot을 받는다.
         */
        const fallbackRows =
          this.normRows(registration?.data);

        let detailError = '';

        try {
          const snapshot: any =
            await this.ctx.rt.conditionSearch(target, '0');

          this.assertOk(
            snapshot,
            `조건식 ${target} 상세조회`,
          );

          const detailRows =
            this.normRows(snapshot?.data);

          this.rows =
            detailRows.length
              ? detailRows
              : fallbackRows;

          this.syncQuoteRegistration();
          this.paintRows();
        } catch (e: any) {
          detailError = String(e?.message ?? e);

          this.rows = fallbackRows;
          this.syncQuoteRegistration();
          this.paintRows();

          this.ctx.log.warn(
            `조건식 ${target} 실시간 등록은 성공했지만 `
            + `상세 snapshot 조회에 실패했습니다: `
            + detailError,
          );
        }

        // 조건식이 바뀌었으므로 이전 편입·이탈 기록과 혼합하지 않는다.
        this.events = [];
        this.paintEvents();

        this.info(
          detailError
            ? `실시간 등록됨 · 조건식 ${target}`
              + ` · 상세조회 실패: ${detailError}`
            : `실시간 등록됨 · 조건식 ${target}`,
        );
      } else {
        const active = this.liveSeq;

        if (!active) {
          this.info('실시간 등록 상태가 아닙니다.');
          return;
        }

        const m: any =
          await this.ctx.rt.conditionClear(active);

        this.assertOk(m, `실시간 조건식 ${active} 해제`);

        this.clearQuoteRegistration();
        this.cancelScheduledSnapshot();
        this.liveSeq = '';
        this.info(`실시간 해제됨 · 조건식 ${active}`);
      }
    } catch (e: any) {
      this.info(`실시간 처리 실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
      this.setControlsBusy(false);
      this.syncLiveCheck();
    }
  }

  private colsOf(): string[] {
    const seen: string[] = [];
    for (const r of this.rows) {
      for (const k of Object.keys(r)) {
        if (!seen.includes(k)) seen.push(k);
      }
    }
    const head = ORDER.filter(c => seen.includes(c));
    const rest = seen.filter(c => !ORDER.includes(c) && !HIDE.has(c));
    return [...head, ...rest];
  }

  private cell(r: any, c: string, d: number): string {
    const raw = String(r[c] ?? '').trim();

    if (c === '9001') {
      return `<span class="mono">${this.esc(this.plain(raw))}</span>`;
    }

    const n = this.toNum(raw);
    if (n === null) return this.esc(raw);

    let v = ABS.has(c) ? Math.abs(n) : n;

    // 11/12는 FID 25가 있으면 그 방향을 우선한다.
    if ((c === '11' || c === '12') && d !== 0) {
      v = Math.abs(v) * d;
    }

    if (c === '12') {
      return this.esc(`${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
    }

    if (c === '11') {
      return this.esc(
        `${v > 0 ? '+' : ''}${v.toLocaleString('ko-KR')}`,
      );
    }

    return this.esc(v.toLocaleString('ko-KR'));
  }

  private paintRows(): void {
    const host = this.$('#kRows');
    if (!host) return;

    if (!this.rows.length) {
      host.innerHTML =
        `<div class="tr-empty">포착된 종목이 없습니다.</div>`;
      return;
    }

    const cols = this.colsOf();

    host.innerHTML = `
      <table class="grid">
        <thead>
          <tr>
            ${cols.map(c =>
              `<th title="${this.esc(c)}">${this.esc(F[c] ?? c)}</th>`,
            ).join('')}
          </tr>
        </thead>
        <tbody>
          ${this.rows.map((r, i) => {
            const d = this.dir(r);
            const tone = d > 0 ? 'up' : d < 0 ? 'dn' : '';
            const code = this.rowCode(r);
            const selected = code && code === this.selectedCode ? ' sel' : '';

            const cells = cols.map(c => {
              const cls = [
                NUM.has(c) ? 'num' : '',
                /^(10|11|12)$/.test(c) ? tone : '',
              ].filter(Boolean).join(' ');

              return `<td class="${cls}">${this.cell(r, c, d)}</td>`;
            }).join('');

            return `
              <tr data-i="${i}" class="clickable${selected}">
                ${cells}
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    this.$$('tr.clickable').forEach(tr => {
      tr.addEventListener('click', () => {
        const index = Number(tr.getAttribute('data-i'));

        if (
          !Number.isInteger(index)
          || index < 0
          || index >= this.rows.length
        ) {
          return;
        }

        const r = this.rows[index];
        const code = this.rowCode(r);

        if (!code) return;

        this.selectedCode = code;

        this.$$('tr.clickable').forEach(x => {
          x.classList.remove('sel');
        });

        tr.classList.add('sel');

        this.ctx.bus.emit(Topics.SymbolSelected, {
          source: this.formKey,
          code,
          name: String(r?.['302'] ?? r?.stk_nm ?? '').trim(),
        });
      });
    });
  }

  private paintEvents(): void {
    const el = this.$('#kEv'); if (!el) return;
    el.innerHTML = this.events.length
      ? this.events.map(s => `<div class="ev ${s.includes('[편입]') ? 'up' : 'dn'}">${this.esc(s)}</div>`).join('')
      : `<div class="tr-empty">대기중</div>`;
  }

  private info(s: string): void { const el = this.$('#kInfo'); if (el) el.textContent = s; }
}

export default ConditionForm;
