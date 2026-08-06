import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';

type PeriodId = 'tick' | 'min' | 'day' | 'week' | 'month' | 'year';

interface PeriodDef {
  id: PeriodId; label: string; apiId: string; listKey: string;
  scopes?: { v: string; t: string }[]; timeField: 'cntr_tm' | 'dt'; intraday: boolean;
}

const PERIODS: PeriodDef[] = [
  { id: 'tick',  label: '틱',  apiId: 'ka10079', listKey: 'stk_tic_chart_qry',      timeField: 'cntr_tm', intraday: true,
    scopes: [{ v: '1', t: '1틱' }, { v: '3', t: '3틱' }, { v: '5', t: '5틱' }, { v: '10', t: '10틱' }, { v: '30', t: '30틱' }] },
  { id: 'min',   label: '분',  apiId: 'ka10080', listKey: 'stk_min_pole_chart_qry', timeField: 'cntr_tm', intraday: true,
    scopes: [{ v: '1', t: '1분' }, { v: '3', t: '3분' }, { v: '5', t: '5분' }, { v: '10', t: '10분' },
             { v: '15', t: '15분' }, { v: '30', t: '30분' }, { v: '60', t: '60분' }] },
  { id: 'day',   label: '일',  apiId: 'ka10081', listKey: 'stk_dt_pole_chart_qry',  timeField: 'dt', intraday: false },
  { id: 'week',  label: '주',  apiId: 'ka10082', listKey: 'stk_stk_pole_chart_qry', timeField: 'dt', intraday: false },
  { id: 'month', label: '월',  apiId: 'ka10083', listKey: 'stk_mth_pole_chart_qry', timeField: 'dt', intraday: false },
  { id: 'year',  label: '년',  apiId: 'ka10094', listKey: 'stk_yr_pole_chart_qry',  timeField: 'dt', intraday: false },
];

interface Bar { time: any; open: number; high: number; low: number; close: number; volume: number; }

const RED = '#e34a4a';
const BLUE = '#3f7fd6';

export class ChartForm extends ChildForm {
  private code = '005930';
  private name = '';
  private period: PeriodDef = PERIODS[2];
  private scope = '1';
  private upd = '1';
  private bars: Bar[] = [];
  private contYn = ''; private nextKey = '';
  private busy = false;

  private volCap = 0;
  private volRaw = false;

  private chart: any;
  private candles: any;
  private volume: any;
  private ma5: any; private ma20: any; private ma60: any;
  private ro?: ResizeObserver;

  protected onInit(): void {
    const p = this.params;
    this.code = p.code ?? (this.ctx as any).state?.symbol?.code ?? '005930';
    if (p.apiId) {
      const hit = PERIODS.find(x => x.apiId === p.apiId);
      if (hit) this.period = hit;
    }
    if (p.period) {
      const hit = PERIODS.find(x => x.id === p.period);
      if (hit) this.period = hit;
    }
    this.scope = this.period.id === 'min' ? '5' : (this.period.scopes?.[0]?.v ?? '1');

    this.renderShell();
    void this.boot();

    const off = this.ctx.bus.onExcept(Topics.SymbolSelected, this.formKey, (msg: any) => {
      if (!msg?.code || msg.code === this.code) return;
      this.code = msg.code; this.name = msg.name ?? '';
      const inp = this.$<HTMLInputElement>('#cCode'); if (inp) inp.value = this.code;
      void this.load(false);
    });
    this.track(off);
  }

  private renderShell(): void {
    this.html(`
      <div class="chart-form">
        <div class="chart-bar">
          <input id="cCode" class="c-code" value="${this.esc(this.code)}" maxlength="20" spellcheck="false">
          <button class="btn primary" id="cGo">조회</button>
          <span class="c-nm" id="cName">${this.esc(this.name)}</span>
          <span class="tr-flex"></span>
          <span class="c-periods">
            ${PERIODS.map(p => `<button class="lnk ${p.id === this.period.id ? 'on' : ''}" data-p="${p.id}">${p.label}</button>`).join('')}
          </span>
          <select id="cScope" class="c-scope" ${this.period.scopes ? '' : 'disabled'}>
            ${(this.period.scopes ?? [{ v: '1', t: '-' }]).map(s =>
              `<option value="${s.v}" ${s.v === this.scope ? 'selected' : ''}>${s.t}</option>`).join('')}
          </select>
          <label class="chk"><input type="checkbox" id="cUpd" ${this.upd === '1' ? 'checked' : ''}> 수정주가</label>
          <label class="chk" title="체크하면 거래량 축을 실제 최댓값으로 씁니다"><input type="checkbox" id="cVolRaw" ${this.volRaw ? 'checked' : ''}> 거래량 원본</label>
          <button class="lnk" id="cMore" title="과거 데이터 이어붙이기">◂ 더보기</button>
          <button class="lnk" id="cFit" title="전체보기">⤢</button>
        </div>
        <div class="chart-legend" id="cLegend"></div>
        <div class="chart-canvas" id="cCanvas"></div>
        <div class="chart-status" id="cStatus">준비중…</div>
      </div>`);

    this.$('#cGo')?.addEventListener('click', () => {
      this.code = (this.$<HTMLInputElement>('#cCode')!.value || '').trim();
      void this.load(false);
    });
    this.$<HTMLInputElement>('#cCode')?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') this.$('#cGo')!.dispatchEvent(new Event('click'));
    });
    this.$$('[data-p]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-p') as PeriodId;
      const def = PERIODS.find(p => p.id === id)!;
      this.period = def;
      this.scope = def.id === 'min' ? '5' : (def.scopes?.[0]?.v ?? '1');
      this.disposeChart();
      this.renderShell();
      void this.boot();
    }));
    this.$('#cScope')?.addEventListener('change', e => {
      this.scope = (e.target as HTMLSelectElement).value;
      void this.load(false);
    });
    this.$('#cUpd')?.addEventListener('change', e => {
      this.upd = (e.target as HTMLInputElement).checked ? '1' : '0';
      void this.load(false);
    });
    this.$('#cVolRaw')?.addEventListener('change', e => {
      this.volRaw = (e.target as HTMLInputElement).checked;
      this.computeVolCap();
      this.volume?.applyOptions({});
    });
    this.$('#cMore')?.addEventListener('click', () => void this.load(true));
    this.$('#cFit')?.addEventListener('click', () => this.chart?.timeScale().fitContent());
  }

  private async boot(): Promise<void> {
    if (!this.chart) await this.initChart();
    await this.load(false);
  }

  /** 거래량 오토스케일 상한. 동시호가 대량체결 1건이 축을 잡아먹는 것을 막는다. */
  private computeVolCap(): void {
    if (this.volRaw) { this.volCap = 0; return; }
    const v = this.bars.map(b => b.volume).filter(x => x > 0).sort((a, b) => a - b);
    if (v.length < 5) { this.volCap = 0; return; }
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    this.volCap = Math.max(q(0.95) * 1.2, q(0.5) * 4);
  }

  /** lightweight-charts v5 (addSeries + 시리즈 정의 객체) */
  private async initChart(): Promise<void> {
    const host = this.$('#cCanvas')!;
    let LC: any;
    try {
      LC = await import('lightweight-charts');
    } catch (e: any) {
      host.innerHTML = `<div class="err">lightweight-charts 로드 실패\n${String(e?.message ?? e)}</div>`;
      return;
    }

    const { createChart, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode } = LC;

    this.chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { color: '#1e1e1e' },
        textColor: '#cccccc',
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: '#3a3a3a', separatorHoverColor: '#4a5a6a', enableResize: true },
      },
      grid: { vertLines: { color: '#2a2a2a' }, horzLines: { color: '#2a2a2a' } },
      rightPriceScale: { borderColor: '#3a3a3a', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#3a3a3a', timeVisible: this.period.intraday, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: 'ko-KR',
        priceFormatter: (p: number) => p.toLocaleString('ko-KR'),
      },
    });

    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: RED, downColor: BLUE,
      borderUpColor: RED, borderDownColor: BLUE,
      wickUpColor: RED, wickDownColor: BLUE,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    }, 0);

    const maOpt = (color: string) => ({
      color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    this.ma5  = this.chart.addSeries(LineSeries, maOpt('#e5c07b'), 0);
    this.ma20 = this.chart.addSeries(LineSeries, maOpt('#98c379'), 0);
    this.ma60 = this.chart.addSeries(LineSeries, maOpt('#c678dd'), 0);

    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: (orig: () => any) => {
        if (this.volCap <= 0) return orig();
        return { priceRange: { minValue: 0, maxValue: this.volCap }, margins: { above: 8, below: 0 } };
      },
    }, 1);
    try { this.chart.panes()[1]?.setHeight(120); } catch { /* v5 초기버전 호환 */ }

    this.chart.subscribeCrosshairMove((p: any) => this.paintLegend(p));

    this.ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && this.bars.length === 0) {
        this.chart?.timeScale().fitContent();
      }
    });
    this.ro.observe(host);
    this.track(() => this.disposeChart());
  }

  private disposeChart(): void {
    this.ro?.disconnect(); this.ro = undefined;
    try { this.chart?.remove(); } catch { /* ignore */ }
    this.chart = undefined;
    this.candles = this.volume = this.ma5 = this.ma20 = this.ma60 = undefined;
  }

  private async load(more: boolean): Promise<void> {
    if (this.busy || !this.candles) return;
    if (!/^[0-9A-Za-z_]{4,20}$/.test(this.code)) { this.status('종목코드를 확인하세요.'); return; }
    if (more && this.contYn !== 'Y') { this.status('더 불러올 과거 데이터가 없습니다.'); return; }

    this.busy = true;
    this.status(more ? '이전 데이터 조회중…' : '조회중…');

    const def = this.period;
    const body: Record<string, string> = { stk_cd: this.code, upd_stkpc_tp: this.upd };
    if (def.scopes) body.tic_scope = this.scope;
    else body.base_dt = this.todayYmd();

    try {
      const res: any = await this.ctx.api.call(def.apiId, '/api/dostk/chart', body, {
        contYn: more ? 'Y' : undefined,
        nextKey: more ? this.nextKey : undefined,
      });
      const data = this.payload(res);
      // KiwoomClient.contYn 은 boolean 이다. 문자열로 정규화한다.
      this.contYn = res?.contYn ? 'Y' : '';
      this.nextKey = res?.nextKey ?? '';

      if (data?.return_code !== undefined && data.return_code !== 0) {
        this.status(`오류 rc=${data.return_code} ${data.return_msg ?? ''}`);
        return;
      }

      const rows: any[] = data?.[def.listKey] ?? [];
      const parsed = rows.map(r => this.toBar(r, def)).filter(Boolean) as Bar[];
      if (!parsed.length && !more) { this.status('데이터가 없습니다.'); return; }
      this.bars = this.merge(parsed, more ? this.bars : []);
      this.computeVolCap();

      this.candles.setData(this.bars.map(b => ({
        time: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
      })));
      this.volume.setData(this.bars.map(b => ({
        time: b.time, value: b.volume,
        color: b.close >= b.open ? 'rgba(227,74,74,.45)' : 'rgba(63,127,214,.45)',
      })));
      this.ma5.setData(this.sma(5));
      this.ma20.setData(this.sma(20));
      this.ma60.setData(this.sma(60));
      if (!more) this.chart.timeScale().fitContent();

      const nm = data?.stk_nm ?? '';
      if (nm) { this.name = String(nm); const el = this.$('#cName'); if (el) el.textContent = this.name; }
      this.setTitle(`차트 ${this.code}${this.name ? ' ' + this.name : ''} · ${def.label}`);
      this.status(`${this.bars.length}봉 · ${def.apiId}${this.contYn === 'Y' ? ' · 과거 데이터 더 있음' : ''}`);
      this.paintLegend(null);

      this.ctx.bus.emit(Topics.SymbolSelected, { source: this.formKey, code: this.code, name: this.name });
    } catch (e: any) {
      this.status(`실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
    }
  }

  private sma(n: number): any[] {
    const out: any[] = [];
    let sum = 0;
    for (let i = 0; i < this.bars.length; i++) {
      sum += this.bars[i].close;
      if (i >= n) sum -= this.bars[i - n].close;
      if (i >= n - 1) out.push({ time: this.bars[i].time, value: +(sum / n).toFixed(2) });
    }
    return out;
  }

  private toBar(r: any, def: PeriodDef): Bar | null {
    const raw = String(r[def.timeField] ?? '');
    if (!raw) return null;
    let time: any;
    if (def.intraday) {
      const y = +raw.slice(0, 4), mo = +raw.slice(4, 6) - 1, d = +raw.slice(6, 8);
      const h = +(raw.slice(8, 10) || 0), mi = +(raw.slice(10, 12) || 0), s = +(raw.slice(12, 14) || 0);
      time = Math.floor(Date.UTC(y, mo, d, h, mi, s) / 1000);
    } else {
      time = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    const close = this.abs(r.cur_prc);
    if (!close) return null;
    return {
      time,
      open: this.abs(r.open_pric) || close,
      high: this.abs(r.high_pric) || close,
      low: this.abs(r.low_pric) || close,
      close,
      volume: this.abs(r.trde_qty),
    };
  }

  private merge(incoming: Bar[], existing: Bar[]): Bar[] {
    const map = new Map<string, Bar>();
    [...existing, ...incoming].forEach(x => map.set(String(x.time), x));
    const key = (t: any) => (typeof t === 'number' ? t : Date.parse(t));
    return Array.from(map.values()).sort((a, b) => key(a.time) - key(b.time));
  }

  private paintLegend(p: any): void {
    const el = this.$('#cLegend'); if (!el) return;
    const d = p?.seriesData?.get?.(this.candles);
    if (d) {
      const v = p.seriesData.get(this.volume)?.value ?? 0;
      el.innerHTML = this.legendHtml(d.open, d.high, d.low, d.close, v);
      return;
    }
    const last = this.bars[this.bars.length - 1];
    el.innerHTML = last ? this.legendHtml(last.open, last.high, last.low, last.close, last.volume) : '';
  }

  private legendHtml(o: number, h: number, l: number, c: number, v: number): string {
    const cls = c >= o ? 'up' : 'dn';
    const rt = o ? ((c - o) / o * 100).toFixed(2) : '0.00';
    return `<span class="lg">시 ${this.fmt(o)}</span><span class="lg">고 ${this.fmt(h)}</span>
            <span class="lg">저 ${this.fmt(l)}</span>
            <span class="lg ${cls}">종 ${this.fmt(c)} (${rt}%)</span>
            <span class="lg">거래량 ${this.fmt(v)}</span>
            <span class="lg ma5">MA5</span><span class="lg ma20">MA20</span><span class="lg ma60">MA60</span>`;
  }

  private status(s: string): void { const el = this.$('#cStatus'); if (el) el.textContent = s; }
  private todayYmd(): string {
    return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
  }

  protected onVisibility(visible: boolean): void {
    if (visible && this.chart) {
      requestAnimationFrame(() => this.chart?.timeScale().fitContent());
    }
  }
}
