# VWAP chart add-on contract

## Calculation source

Kiwoom Desk VWAP follows the verified ChartKit `indicator.vwap` Legacy-parity contract from ChartKit PR #20.

For every bar:

```text
typicalPrice = (High + Low + Close) / 3
priceVolume += typicalPrice * Volume
volume += Volume
priceSquaredVolume += typicalPrice^2 * Volume

VWAP = priceVolume / volume
variance = max(0, priceSquaredVolume / volume - VWAP^2)
deviation = sqrt(variance)

Upper1 = VWAP + stdDev1 * deviation
Lower1 = VWAP - stdDev1 * deviation
Upper2 = VWAP + stdDev2 * deviation
Lower2 = VWAP - stdDev2 * deviation
```

Defaults:

```text
stdDev1 = 1
stdDev2 = 2
```

## Session boundary

VWAP is cumulative only inside one trading date. On a trading-date change the cumulative price-volume, volume, and squared-price-volume state is reset before the first bar of the new session is consumed.

`ChartBar` now has an optional provider-neutral `tradingDate` (`YYYY-MM-DD`) field. VWAP always prefers that explicit field. The current chart compatibility path also preserves the provider date in `bar.time`, so when an older bar has no explicit field the add-on derives the same date from `time` rather than from sequence, visible-window position, or bar count.

Synthetic tick aggregation uses the explicit trading date when present and never combines bars across trading dates.

## Visual policy

VWAP is the primary line and remains visually strong:

```text
VWAP       #00E5FF  width 2
```

Bands are deliberately subordinate so multiple overlays do not obscure candles:

```text
Upper1/Lower1  rgba yellow, opacity .32
Upper2/Lower2  rgba orange, opacity .20
```

Each VWAP output can be shown or hidden independently from the generic indicator parameter UI:

```text
showValue
showUpper1
showLower1
showUpper2
showLower2
```

These booleans are ordinary indicator parameters, therefore they are persisted and restored through the existing indicator JSON/localStorage contract without adding VWAP-specific code to `ChartForm` or `IndicatorHost`.

## Incremental contract

Initial load / historical prepend may call `reset(allBars)`.

Live processing uses only:

```text
append  -> calculate the new last bar from the previous cumulative state
replace -> recalculate the current last bar from the previous bar state
```

VWAP is included in both its dedicated multi-session parity test and the global shipped-indicator append/replace parity gate.

## Verification

Run:

```powershell
.\scripts\pull_and_verify.ps1 -SkipPull
```

Manual chart check:

1. Add `VWAP` on an intraday chart.
2. Confirm the cyan VWAP line is visually dominant and four bands are faint.
3. Toggle Upper/Lower lines individually in the indicator panel.
4. Reload the page and confirm the same visibility settings restore from JSON/localStorage.
5. On a multi-day intraday chart, confirm the VWAP restarts at each trading-date boundary.

Actual live incremental behavior remains a market-hours verification item together with the existing chart diagnostics add-on.
