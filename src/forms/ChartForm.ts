import { ChildForm } from './ChildForm';
import { Topics } from '../core/events';
import {
  createChartExtensions,
  type ChartBarChange,
  type ChartExtensionGroup,
} from '../chart/extensions';
import {
  CHART_TICK_SCOPES,
  TICK_SOURCE_SCOPE,
  aggregateSyntheticTickBars,
  isSyntheticTickScope,
  reconcileTickProgress,
  requestTickScope,
  syntheticTickFactor,
  type OhlcvBar,
} from '../chart/tickAggregation';

type PeriodId = 'tick' | 'min' | 'day' | 'week' | 'month' | 'year';

interface PeriodDef {
  id: PeriodId;
  label: string;
  apiId: string;
  listKey: string;
  scopes?: { v: string; t: string }[];
  timeField: 'cntr_tm' | 'dt';
  intraday: boolean;
}

const PERIODS: PeriodDef[] = [
  {
    id: 'tick', label: '틱', apiId: 'ka10079', listKey: 'stk_tic_chart_qry',
    timeField: 'cntr_tm', intraday: true, scopes: CHART_TICK_SCOPES,
  },
  {
    id: 'min', label: '분', apiId: 'ka10080', listKey: 'stk_min_pole_chart_qry',
    timeField: 'cntr_tm', intraday: true,
    scopes: [
      { v: '1', t: '1분' }, { v: '3', t: '3분' }, { v: '5', t: '5분' },
      { v: '10', t: '10분' }, { v: '15', t: '15분' }, { v: '30', t: '30분' },
      { v: '60', t: '60분' },
    ],
  },
  { id: 'day', label: '일', apiId: 'ka10081', listKey: 'stk_dt_pole_chart_qry', timeField: 'dt', intraday: false },
  { id: 'week', label: '주', apiId: 'ka10082', listKey: 'stk_stk_pole_chart_qry', timeField: 'dt', intraday: false },
  { id: 'month', label: '월', apiId: 'ka10083', listKey: 'stk_mth_pole_chart_qry', timeField: 'dt', intraday: false },
  { id: 'year', label: '년', apiId: 'ka10094', listKey: 'stk_yr_pole_chart_qry', timeField: 'dt', intraday: false },
];

type Bar = OhlcvBar;

const RED = '#e34a4a';
const BLUE = '#3f7fd6';

export class ChartForm extends ChildForm {
  private code = '005930';
  private name = '';
  private period: PeriodDef = PERIODS[2];
  private scope = '1';
  private upd = '1';
  private bars: Bar[] = [];
  private sourceTickBars: Bar[] = [];
  private syntheticLiveBars: Bar[] = [];
  private contYn = '';
  private nextKey = '';
  private busy = false;
  private reloadPending = false;

  private volCap = 0;
  private volRaw = false;

  private chart: any;
  private candles: any;
  private volume: any;
  private extensions?: ChartExtensionGroup;
  private ro?: ResizeObserver;

  private quoteGroup = '';
  private quoteCode = '';
  private liveFrame?: number;
  private liveTickCount = 0;
  private liveTickSynced = false;

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
    this.resetSyntheticState();

    this.renderShell();
    void this.boot();

    this.track(this.ctx.bus.onExcept(Topics.SymbolSelected, this.formKey, (msg: any) => {
      if (!msg?.code || msg.code === this.code) return;
      this.clearRealtimeRegistration();
      this.code = this.plainCode(msg.code);
      this.name = msg.name ?? '';
      const inp = this.$<HTMLInputElement>('#cCode');
      if (inp) inp.value = this.code;
      const nm = this.$('#cName');
      if (nm) nm.textContent = this.name;
      void this.load(false);
    }));

    this.track(this.ctx.bus.on(Topics.WsChanged, (p: any) => {
      if (!p?.connected) {
        this.quoteGroup = '';
        this.quoteCode = '';
        return;
      }
      if (this.bars.length) this.syncRealtimeRegistration();
    }));

    this.track(this.ctx.bus.on(Topics.RealtimeTick, (d: any) => {
      if (String(d?.type ?? '') !== '0B') return;
      this.onRealtimeTrade(d);
    }));

    this.track(() => {
      this.clearRealtimeRegistration();
      if (this.liveFrame !== undefined) {
        cancelAnimationFrame(this.liveFrame);
        this.liveFrame = undefined;
      }
    });
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
          <span id="cExt" class="chart-ext-slot"></span>
          <button class="lnk" id="cMore" title="과거 데이터 이어붙이기">◂ 더보기</button>
          <button class="lnk" id="cFit" title="전체보기">⤢</button>
        </div>
        <div class="chart-legend" id="cLegend"></div>
        <div class="chart-canvas" id="cCanvas"></div>
        <div class="chart-status" id="cStatus">준비중…</div>
      </div>`);

    this.$('#cGo')?.addEventListener('click', () => {
      const next = this.plainCode((this.$<HTMLInputElement>('#cCode')!.value || '').trim());
      if (next !== this.code) this.clearRealtimeRegistration();
      this.code = next;
      void this.load(false);
    });

    this.$<HTMLInputElement>('#cCode')?.addEventListener('keydown', e => {
      if ((e as KeyboardEvent).key === 'Enter') this.$('#cGo')!.dispatchEvent(new Event('click'));
    });

    this.$$('[data-p]').forEach(b => b.addEventListener('click', () => {
      const id = b.getAttribute('data-p') as PeriodId;
      const def = PERIODS.find(p => p.id === id)!;
      this.clearRealtimeRegistration();
      this.period = def;
      this.scope = def.id === 'min' ? '5' : (def.scopes?.[0]?.v ?? '1');
      this.bars = [];
      this.resetSyntheticState();
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

  private computeVolCap(): void {
    if (this.volRaw) {
      this.volCap = 0;
      return;
    }
    const v = this.bars.map(b => b.volume).filter(x => x > 0).sort((a, b) => a - b);
    if (v.length < 5) {
      this.volCap = 0;
      return;
    }
    const q = (p: number) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    this.volCap = Math.max(q(0.95) * 1.2, q(0.5) * 4);
  }

  private async initChart(): Promise<void> {
    const host = this.$('#cCanvas')!;
    let LC: any;
    try {
      LC = await import('lightweight-charts');
    } catch (e: any) {
      host.innerHTML = `<div class="err">lightweight-charts 로드 실패\n${String(e?.message ?? e)}</div>`;
      return;
    }

    const { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } = LC;

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
      upColor: RED,
      downColor: BLUE,
      borderUpColor: RED,
      borderDownColor: BLUE,
      wickUpColor: RED,
      wickDownColor: BLUE,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    }, 0);

    this.volume = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
      autoscaleInfoProvider: (orig: () => any) => {
        if (this.volCap <= 0) return orig();
        return { priceRange: { minValue: 0, maxValue: this.volCap }, margins: { above: 8, below: 0 } };
      },
    }, 1);

    try {
      this.chart.panes()[1]?.setHeight(120);
    } catch {
      // lightweight-charts v5 초기버전 호환
    }

    const extensionToolbar = this.$('#cExt');
    if (extensionToolbar) {
      this.extensions = createChartExtensions({
        chart: this.chart,
        lc: LC,
        toolbar: extensionToolbar,
        firstAddonPane: 2,
        reportError: message => {
          this.ctx.log.warn(message);
          this.status(message);
        },
      });
    }

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
    this.ro?.disconnect();
    this.ro = undefined;
    this.extensions?.dispose();
    this.extensions = undefined;
    try {
      this.chart?.remove();
    } catch {
      // ignore
    }
    this.chart = undefined;
    this.candles = undefined;
    this.volume = undefined;
  }

  private async load(more: boolean): Promise<void> {
    if (this.busy) {
      if (!more) this.reloadPending = true;
      return;
    }
    if (!this.candles) return;
    if (!/^[0-9A-Za-z_]{4,20}$/.test(this.code)) {
      this.status('종목코드를 확인하세요.');
      return;
    }
    if (more && this.contYn !== 'Y') {
      this.status('더 불러올 과거 데이터가 없습니다.');
      return;
    }

    const requestedCode = this.code;
    const requestedScope = this.scope;
    const def = this.period;
    const syntheticTicks = def.id === 'tick' && isSyntheticTickScope(requestedScope);

    if (!more) {
      this.clearRealtimeRegistration();
      this.liveTickCount = 0;
      this.liveTickSynced = false;
      this.sourceTickBars = [];
      this.syntheticLiveBars = [];
    }

    this.busy = true;
    this.status(more ? '이전 데이터 조회중…' : '조회중…');

    const body: Record<string, string> = {
      stk_cd: requestedCode,
      upd_stkpc_tp: this.upd,
    };
    if (def.scopes) {
      body.tic_scope = def.id === 'tick' ? requestTickScope(requestedScope) : requestedScope;
    } else {
      body.base_dt = this.todayYmd();
    }

    try {
      const res: any = await this.ctx.api.call(def.apiId, '/api/dostk/chart', body, {
        contYn: more ? 'Y' : undefined,
        nextKey: more ? this.nextKey : undefined,
      });
      const data = this.payload(res);

      if (requestedCode !== this.code || def !== this.period || requestedScope !== this.scope) return;

      this.contYn = res?.contYn ? 'Y' : '';
      this.nextKey = res?.nextKey ?? '';

      if (data?.return_code !== undefined && data.return_code !== 0) {
        this.status(`오류 rc=${data.return_code} ${data.return_msg ?? ''}`);
        return;
      }

      const rows: any[] = data?.[def.listKey] ?? [];
      const parsed = rows.map(r => this.toBar(r, def)).filter(Boolean) as Bar[];
      if (!parsed.length && !more) {
        this.status('데이터가 없습니다.');
        return;
      }

      if (syntheticTicks) {
        const page = this.toChronologicalPage(parsed);
        this.sourceTickBars = more ? [...page, ...this.sourceTickBars] : page;
        const historical = aggregateSyntheticTickBars(this.sourceTickBars, requestedScope);
        this.bars = this.merge(this.syntheticLiveBars, historical);
      } else {
        this.sourceTickBars = [];
        this.syntheticLiveBars = [];
        this.bars = this.merge(parsed, more ? this.bars : []);
      }

      this.refreshSeries(!more);

      const nm = data?.stk_nm ?? '';
      if (nm) {
        this.name = String(nm);
        const el = this.$('#cName');
        if (el) el.textContent = this.name;
      }

      if (!more && def.id === 'tick' && this.bars.length) {
        this.status(`틱 경계 동기화중… · ${this.periodCaption(def, requestedScope)}`);
        this.liveTickSynced = await this.bootstrapTickProgress(requestedCode, requestedScope);
        if (requestedCode !== this.code || def !== this.period || requestedScope !== this.scope) return;
      }

      this.setTitle(`차트 ${this.code}${this.name ? ' ' + this.name : ''} · ${this.periodCaption(def, requestedScope)}`);
      this.status(this.loadedStatus(def, requestedScope, syntheticTicks));
      this.paintLegend(null);

      this.syncRealtimeRegistration();
      this.ctx.bus.emit(Topics.SymbolSelected, {
        source: this.formKey,
        code: this.code,
        name: this.name,
      });
    } catch (e: any) {
      this.status(`실패: ${e?.message ?? e}`);
    } finally {
      this.busy = false;
      if (this.reloadPending) {
        this.reloadPending = false;
        void this.load(false);
      }
    }
  }

  private async bootstrapTickProgress(code: string, scope: string): Promise<boolean> {
    const target = this.bars[this.bars.length - 1];
    if (!target) return false;

    if (isSyntheticTickScope(scope)) {
      // 더보기로 30틱 원본을 다시 조립해도 현재 실시간 봉이 우선하도록 overlay를 보존한다.
      this.syntheticLiveBars = [target];
    }

    try {
      const scopeTicks = Math.max(1, Number(scope) || 1);
      const oneTickBars = await this.fetchRecentOneTickBars(
        code,
        Math.max(1000, scopeTicks * 2),
      );
      if (code !== this.code || this.period.id !== 'tick' || scope !== this.scope) return false;

      const match = reconcileTickProgress(oneTickBars, target, scope);
      if (!match) {
        this.liveTickCount = 0;
        return false;
      }

      this.liveTickCount = match.progress;
      for (const tick of match.catchup) {
        const time = Number(tick.time);
        if (!Number.isFinite(time)) continue;
        this.upsertTickBarAt(time, tick.close, tick.volume);
      }

      if (match.catchup.length) this.refreshSeries(false);
      return true;
    } catch {
      this.liveTickCount = 0;
      return false;
    }
  }

  private async fetchRecentOneTickBars(code: string, maxTicks: number): Promise<Bar[]> {
    const tickDef = PERIODS.find(p => p.id === 'tick')!;
    const wanted = Math.max(1, Math.trunc(maxTicks));
    let result: Bar[] = [];
    let contYn = '';
    let nextKey = '';
    let pages = 0;

    do {
      const res: any = await this.ctx.api.call('ka10079', '/api/dostk/chart', {
        stk_cd: code,
        tic_scope: '1',
        upd_stkpc_tp: this.upd,
      }, {
        contYn: contYn === 'Y' ? 'Y' : undefined,
        nextKey: contYn === 'Y' ? nextKey : undefined,
      });
      const data = this.payload(res);

      if (data?.return_code !== undefined && data.return_code !== 0) {
        throw new Error(`1틱 동기화 rc=${data.return_code} ${data.return_msg ?? ''}`);
      }

      const rows: any[] = data?.[tickDef.listKey] ?? [];
      const parsed = rows.map(r => this.toBar(r, tickDef)).filter(Boolean) as Bar[];
      const page = this.toChronologicalPage(parsed);
      result = [...page, ...result];

      contYn = res?.contYn ? 'Y' : '';
      nextKey = res?.nextKey ?? '';
      pages++;
    } while (result.length < wanted && contYn === 'Y' && pages < 8);

    return result.slice(-wanted);
  }

  private refreshSeries(fit: boolean): void {
    this.computeVolCap();
    this.candles.setData(this.bars.map(b => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
    })));
    this.volume.setData(this.bars.map(b => this.volumePoint(b)));
    this.extensions?.onBarsReset(this.bars);
    if (fit) this.chart.timeScale().fitContent();
  }

  private loadedStatus(def: PeriodDef, scope: string, syntheticTicks: boolean): string {
    const source = syntheticTicks
      ? ` · ${TICK_SOURCE_SCOPE}틱×${syntheticTickFactor(scope)} 조립`
      : '';
    const tickSync = def.id === 'tick'
      ? (this.liveTickSynced ? ' · 틱경계 동기화' : ' · 틱경계 미확정')
      : '';
    return `${this.bars.length}봉 · ${this.periodCaption(def, scope)} · ${def.apiId}${source}${tickSync}${this.contYn === 'Y' ? ' · 과거 데이터 더 있음' : ''} · 실시간 대기`;
  }

  private periodCaption(def: PeriodDef, scope = this.scope): string {
    if (def.id === 'tick') return `${scope}틱`;
    if (def.id === 'min') return `${scope}분`;
    return def.label;
  }

  private resetSyntheticState(): void {
    this.sourceTickBars = [];
    this.syntheticLiveBars = [];
    this.liveTickCount = 0;
    this.liveTickSynced = false;
  }

  private plainCode(code: string): string {
    return String(code ?? '').trim().replace(/^[A-Za-z]+/, '');
  }

  private clearRealtimeRegistration(): void {
    const group = this.quoteGroup;
    const code = this.quoteCode;
    this.quoteGroup = '';
    this.quoteCode = '';

    if (group && code && this.ctx.rt.connected) {
      this.ctx.rt.unregister(group, [code], ['0B']);
    }
  }

  private syncRealtimeRegistration(): void {
    const code = this.plainCode(this.code);
    if (this.quoteGroup && this.quoteCode === code) return;

    this.clearRealtimeRegistration();
    if (!code || !this.ctx.rt.connected || !this.bars.length) return;

    this.quoteCode = code;
    this.quoteGroup = this.ctx.rt.register([code], ['0B'], '1');
  }

  private onRealtimeTrade(d: any): void {
    if (!this.quoteGroup || !this.candles) return;

    const values = d?.values ?? {};
    const code = this.plainCode(d?.item ?? values['9001'] ?? '');
    if (!code || code !== this.quoteCode || code !== this.plainCode(this.code)) return;

    const price = this.abs(values['10']);
    if (!price) return;

    const hhmmss = String(values['20'] ?? '').replace(/\D/g, '').padStart(6, '0').slice(-6);
    const tradeQty = this.abs(values['15']);
    const beforeLength = this.bars.length;
    const changed = this.applyRealtimeTrade(price, tradeQty, hhmmss, values);
    if (!changed) return;

    const change: ChartBarChange = this.bars.length > beforeLength ? 'append' : 'replace';

    this.candles.update({
      time: changed.time,
      open: changed.open,
      high: changed.high,
      low: changed.low,
      close: changed.close,
    });
    this.volume.update(this.volumePoint(changed));
    this.extensions?.onBarChanged(changed, change, this.bars);
    this.paintLegend(null);
    this.scheduleLiveStatus();
  }

  private applyRealtimeTrade(
    price: number,
    tradeQty: number,
    hhmmss: string,
    values: any,
  ): Bar | null {
    if (!this.bars.length) return null;

    if (this.period.id === 'min') {
      const minutes = Math.max(1, Number(this.scope) || 1);
      const time = this.liveIntradayTime(hhmmss, minutes);
      return this.upsertIntradayBar(time, price, tradeQty);
    }

    if (this.period.id === 'tick') {
      return this.upsertTickBar(hhmmss, price, tradeQty);
    }

    if (this.period.id === 'day') {
      const time = this.todayIso();
      const cumulativeVolume = this.abs(values['13']);
      const open = this.abs(values['16']) || price;
      const high = this.abs(values['17']) || price;
      const low = this.abs(values['18']) || price;
      const last = this.bars[this.bars.length - 1];

      if (String(last.time) === time) {
        last.open = open || last.open;
        last.high = Math.max(last.high, high, price);
        last.low = Math.min(last.low, low, price);
        last.close = price;
        last.volume = cumulativeVolume || last.volume + tradeQty;
        return last;
      }

      const bar: Bar = {
        time,
        open,
        high: Math.max(open, high, price),
        low: Math.min(open, low, price),
        close: price,
        volume: cumulativeVolume || tradeQty,
      };
      this.bars.push(bar);
      return bar;
    }

    const last = this.bars[this.bars.length - 1];
    const dayHigh = this.abs(values['17']) || price;
    const dayLow = this.abs(values['18']) || price;
    last.high = Math.max(last.high, dayHigh, price);
    last.low = Math.min(last.low, dayLow, price);
    last.close = price;
    last.volume += tradeQty;
    return last;
  }

  private upsertIntradayBar(time: number, price: number, tradeQty: number): Bar | null {
    const last = this.bars[this.bars.length - 1];
    const lastTime = Number(last.time);

    if (Number.isFinite(lastTime) && time < lastTime) return null;

    if (lastTime === time) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += tradeQty;
      return last;
    }

    const bar: Bar = {
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: tradeQty,
    };
    this.bars.push(bar);
    return bar;
  }

  private upsertTickBar(hhmmss: string, price: number, tradeQty: number): Bar | null {
    return this.upsertTickBarAt(this.liveIntradayTime(hhmmss, 0), price, tradeQty);
  }

  private upsertTickBarAt(time: number, price: number, tradeQty: number): Bar | null {
    const scope = Math.max(1, Number(this.scope) || 1);
    const last = this.bars[this.bars.length - 1];

    if (this.liveTickCount === 0) {
      const lastTime = Number(last.time);
      if (Number.isFinite(lastTime) && time <= lastTime) time = lastTime + 1;

      const bar: Bar = {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: tradeQty,
      };
      this.bars.push(bar);
      if (isSyntheticTickScope(this.scope)) this.syntheticLiveBars.push(bar);
      this.liveTickCount = 1 % scope;
      return bar;
    }

    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.volume += tradeQty;
    this.liveTickCount = (this.liveTickCount + 1) % scope;
    return last;
  }

  private liveIntradayTime(hhmmss: string, bucketMinutes: number): number {
    const now = new Date(Date.now() + 9 * 3600_000);
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const d = now.getUTCDate();
    const h = Number(hhmmss.slice(0, 2)) || 0;
    let mi = Number(hhmmss.slice(2, 4)) || 0;
    const s = Number(hhmmss.slice(4, 6)) || 0;

    if (bucketMinutes > 0) mi = Math.floor(mi / bucketMinutes) * bucketMinutes;

    return Math.floor(
      Date.UTC(y, mo, d, h, mi, bucketMinutes > 0 ? 0 : s) / 1000,
    );
  }

  private scheduleLiveStatus(): void {
    if (this.liveFrame !== undefined) return;

    this.liveFrame = requestAnimationFrame(() => {
      this.liveFrame = undefined;

      const synthetic = this.period.id === 'tick' && isSyntheticTickScope(this.scope)
        ? ` · ${TICK_SOURCE_SCOPE}틱 조립`
        : '';
      const tickSync = this.period.id === 'tick'
        ? (this.liveTickSynced ? ' · 경계동기화' : ' · 경계미확정')
        : '';
      this.status(
        `${this.bars.length}봉 · ${this.periodCaption(this.period)} · ${this.period.apiId}${synthetic}${tickSync} · 실시간 ${new Date().toLocaleTimeString('ko-KR')}`,
      );
    });
  }

  private volumePoint(b: Bar): any {
    return {
      time: b.time,
      value: b.volume,
      color: b.close >= b.open
        ? 'rgba(227,74,74,.45)'
        : 'rgba(63,127,214,.45)',
    };
  }

  private toBar(r: any, def: PeriodDef): Bar | null {
    const raw = String(r[def.timeField] ?? '');
    if (!raw) return null;

    let time: any;
    if (def.intraday) {
      const y = +raw.slice(0, 4);
      const mo = +raw.slice(4, 6) - 1;
      const d = +raw.slice(6, 8);
      const h = +(raw.slice(8, 10) || 0);
      const mi = +(raw.slice(10, 12) || 0);
      const s = +(raw.slice(12, 14) || 0);
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

  private toChronologicalPage(incoming: Bar[]): Bar[] {
    const page = incoming.slice();
    if (page.length < 2) return page;

    const first = this.timeKey(page[0].time);
    const last = this.timeKey(page[page.length - 1].time);
    if (first > last) page.reverse();
    return page;
  }

  private merge(incoming: Bar[], existing: Bar[]): Bar[] {
    const map = new Map<string, Bar>();
    [...existing, ...incoming].forEach(x => map.set(String(x.time), x));
    return Array.from(map.values()).sort((a, b) => this.timeKey(a.time) - this.timeKey(b.time));
  }

  private timeKey(time: any): number {
    return typeof time === 'number' ? time : Date.parse(time);
  }

  private paintLegend(p: any): void {
    const el = this.$('#cLegend');
    if (!el) return;

    const d = p?.seriesData?.get?.(this.candles);
    if (d) {
      const v = p.seriesData.get(this.volume)?.value ?? 0;
      el.innerHTML = this.legendHtml(d.open, d.high, d.low, d.close, v);
      return;
    }

    const last = this.bars[this.bars.length - 1];
    el.innerHTML = last
      ? this.legendHtml(last.open, last.high, last.low, last.close, last.volume)
      : '';
  }

  private legendHtml(o: number, h: number, l: number, c: number, v: number): string {
    const cls = c >= o ? 'up' : 'dn';
    const rt = o ? ((c - o) / o * 100).toFixed(2) : '0.00';
    return `<span class="lg">시 ${this.fmt(o)}</span><span class="lg">고 ${this.fmt(h)}</span>
            <span class="lg">저 ${this.fmt(l)}</span>
            <span class="lg ${cls}">종 ${this.fmt(c)} (${rt}%)</span>
            <span class="lg">거래량 ${this.fmt(v)}</span>`;
  }

  private status(s: string): void {
    const el = this.$('#cStatus');
    if (el) el.textContent = s;
  }

  private todayYmd(): string {
    return new Date(Date.now() + 9 * 3600_000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');
  }

  private todayIso(): string {
    return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  }

  protected onVisibility(visible: boolean): void {
    if (visible && this.chart) {
      requestAnimationFrame(() => this.chart?.timeScale().fitContent());
    }
  }
}
