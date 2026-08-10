# Kiwoom Desk Standard Workbench Audit

Date: 2026-08-10

## 1. Project role

`kiwoom-desk` is a **standard/reference Kiwoom REST trading Workbench**, not a project for optimizing one trading strategy.

The repository should remain useful as a base for other projects that need:

- Kiwoom REST/TR access
- WebSocket real-time data
- charting and multiple timeframes
- removable indicator add-ons
- removable strategy add-ons
- watchlists
- account/order/condition-search forms
- user Workbench settings
- a central strategy execution monitor

Application-specific leader selection, entry/exit optimization, condition formulas, portfolio logic, and production strategies belong in derived projects/add-ons.

---

## 2. Standard Workbench completion status

### Workbench shell — DONE

- Dockview-based multi-panel shell
- singleton / per-api / multi form instance policy
- command palette and keyboard commands
- activity bar and menus
- layout save/restore
- connection/status bar

All standard registered forms are concrete implementations:

- Welcome
- Output
- Log
- StockInfo
- generic TR Runner
- Chart
- Account
- Order
- Condition Search
- Watchlist
- AutoTrade Monitor
- Settings

`PlaceholderForm` remains only as a fallback for unknown/nonstandard form IDs; no standard form is intentionally backed by it.

### Kiwoom REST client — DONE for standard client behavior

- generic TR proxy path
- response normalization
- duplicate in-flight request reuse where safe
- rate-limit detection for Kiwoom code/message variants
- API-specific adaptive cooldown after 1700 flow-limit responses
- callAll continuation helper
- read-only connection status

Live server limits can still vary; runtime behavior remains subject to market-hour validation.

### Chart core — DONE for standard framework

- tick / minute / day / week / month / year chart paths
- NXT/all-market symbol support already used by `_AL` data
- synthetic tick aggregation for larger tick bars
- last-bar incremental `update()` path instead of full redraw for live changes
- extension context for removable chart features
- main candlestick/volume drawing remains strategy/indicator agnostic

### Indicator add-on — DONE / FROZEN AS FRAMEWORK

Current reference plugins include the implemented and tested indicator family such as:

- SMA / EMA
- Bollinger Bands
- RSI + signal
- OBV + signal
- MACD
- SuperTrend
- JMA
- DMI / ADX
- Disparity
- Session VWAP with optional bands

Important contract:

- indicator calculations do not belong in `ChartForm`
- parameters and styles are persisted by the add-on
- live append/replace parity is regression-tested
- the whole indicator add-on is physically optional

### Strategy add-on — DONE / REFERENCE ONLY

The Strategy Add-on framework supports:

- plugin discovery/registration
- independent strategy parameters
- JSON persistence/migration
- chart markers
- signal / paper / broker execution modes
- central `TradeIntent` contract
- broker session lock/arm gate
- central portfolio snapshots

`VWAP-JMA Reclaim` is a **reference/validation strategy**, not a production strategy and not a reason to expand the base project with strategy-specific rules.

Trading-strategy research belongs in a derived strategy-lab/application project.

### Runtime diagnostics add-on — DONE

- counts chart `update()` and `setData()` behavior
- detects reset/full-redraw regressions
- optional in production (`?chartDiag=1`)
- automatically useful during development
- physically removable from the base project

### Watchlist — DONE for standard/reference scope

- persistent local-server watchlist storage
- groups and item ordering
- add/remove/rename/reorder
- explicit quote refresh rather than automatic REST flooding
- chart navigation
- schema v2 provenance (`origins[]`)
- registration timestamp/price
- derived return-since-added
- column catalog and display/sort properties
- display settings separated from persistent watchlist data
- reusable `WatchlistCandidate` / upsert contract

Condition-search auto-insertion is intentionally not hardcoded into the standard project. Derived projects can feed condition/ranking/strategy candidates through the common watchlist contract.

### Settings — DONE for standard/reference scope

Workbench settings own only common user behavior:

- default symbol
- layout restore policy
- default chart period
- default order exchange/quantity/order type
- JSON import/export

Security boundary:

- API key/secret
- token cache
- server port/runtime secrets

remain server `.env` responsibilities and must not enter DOM/localStorage/settings JSON.

### Account / Order / Condition Search — DONE for standard UI scope

- standard account tabs and generic account calls
- order form with explicit confirmation gate
- condition-search form
- strategy portfolio shown separately from real account holdings

### AutoTrade monitor — DONE for central monitoring scope

`AutoTradeForm` is intentionally **not** a strategy editor and does not call order APIs directly.

It observes/controls the common event contracts for:

- runtime online/wait state
- broker locked/armed state
- PAPER/BROKER positions
- pending/open/error states
- entry/current price and P/L
- order number
- recent live strategy signals
- opening the central account view

Actual order execution remains owned by the optional Strategy Execution Runtime.

---

## 3. Add-on physical-removal contract

All chart add-ons must be removable without breaking the base Workbench production build:

```text
addons/chart-indicators/
addons/chart-strategies/
addons/chart-diagnostics/
```

`src/main.ts` discovers each optional `register.ts` through `import.meta.glob(...)` rather than a literal module import.

The base TypeScript roots remain `src` and `server`; `addons` is not a required base compilation root.

Removing an add-on may remove that feature, but must not remove:

- the base Workbench
- ChartForm
- REST forms
- Watchlist
- Settings
- Account / Order / Condition Search

---

## 4. Architecture invariants

Do not violate these during later work.

1. **ChartForm is a chart host, not an indicator/strategy catalog.**
2. **Indicator/strategy calculations stay in removable add-ons.**
3. **AutoTradeForm monitors; it does not own broker execution.**
4. **AccountForm distinguishes real account data from strategy PAPER/BROKER runtime state.**
5. **Settings never expose Kiwoom secrets.**
6. **Watchlist persistence and view preferences remain separate.**
7. **Condition/ranking/strategy sources feed Watchlist through a neutral candidate/provenance contract.**
8. **REST polling is explicit/conservative; opening a panel must not create uncontrolled API request loops.**
9. **Live chart/indicator/strategy changes use incremental append/replace paths.**
10. **Broker execution starts LOCKED after every app restart.**

---

## 5. What is deliberately NOT complete

The following require market-hour or real execution validation and must not be marked complete merely because unit/build tests pass.

### Live market validation — PENDING

- real-time WebSocket ticks during active market
- current candle replace behavior
- next candle append behavior
- no full-history redraw during normal ticks
- NXT 08:00 data/session behavior
- `_AL` all-market continuity
- 1/3/5/10/30/60/120 tick base behavior
- synthetic 240/360/480/540/720 tick aggregation with live ticks
- indicator incremental updates on real incoming bars
- strategy marker incremental updates
- reconnect and catch-up behavior
- duplicate/missing tick checks around reconnect

### Soak/reconnect — PENDING

- long-running intraday session
- physical network disconnect/reconnect
- browser/API server restart combinations
- memory/CPU growth
- stale subscriptions
- duplicate subscriptions

### Broker strategy execution — NOT PRODUCTION-VALIDATED

The broker execution path has safety gates and contract tests, but production use requires separate controlled validation of:

- order acceptance
- partial fills
- fill reconciliation
- cancel/modify interaction where applicable
- disconnect during pending order
- restart with an existing broker position/order
- real account risk policy

Do not treat the reference VWAP-JMA strategy as production-ready.

---

## 6. Verification gate

Normal local verification is performed by:

```powershell
.\scripts\pull_and_verify.ps1 -SkipPull
```

The gate covers the standard modules, optional add-ons when installed, production build, whitespace, repository cleanliness, and local `main == origin/main`.

`test:audit` additionally guards the completion boundary:

- no standard form falls back to Placeholder
- all three chart add-ons use physically optional bootstrap loading
- base TypeScript roots exclude add-ons
- AutoTrade monitor does not call broker APIs
- Settings contract contains no Kiwoom secrets
- completion/handoff documents exist

---

## 7. Next work order

Do not add more standard features merely because they are possible.

Recommended next sequence:

1. run the full local verification gate on the audit commit
2. visually verify AutoTradeForm opens and remains REST-passive
3. freeze standard Workbench feature development
4. during market hours run the live incremental/reconnect checklist
5. record failures as framework defects only
6. implement strategy research/condition-specific automation in derived projects, not in the base Workbench

When live validation passes, tag or otherwise mark a stable standard/reference baseline before application-specific forks expand it.
