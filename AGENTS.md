# Warehouse Brain PWA — Agent Guide

Vue 3 (`<script setup>` + Composition API), Pinia, Dexie (IndexedDB), Tailwind (dark-only), Vite. Fully client-side — no backend, no API; `.env` is a stub. No TypeScript, no tests.

## Commands

```sh
npm run dev          # Vite dev server (host:true for LAN; no fixed port in vite.config.js)
npm run lint         # eslint . --fix — MUTATES files; use `npx eslint .` for check-only
npm run build        # base '/ShippingDefects2.0/' for GitHub Pages; `npm run deploy` pushes dist via gh-pages
```

## Architecture

- Entrypoints: `src/main.js` (Pinia + router + global UI registration + `ensureDbReady()` + `initializeApp()`), `src/router/index.js`, `src/lib/db.js` (all persistence, `dbStore` facade — no network layer).
- Routes (lazy-loaded, 9 total): `/`, `/upload`, `/mix-view`, `/pallet-view`, `/boxes`, `/separate`, `/mix/:boxId?`, `/pallet/:palletId?`, `/import`. There is no `/login` or `/user`.
- `src/components/ContainerView.vue` — shared scanner-modal + item-list + status-bar shell used by Mix/Pallet views.
- `src/stores/`: `boxes.js`, `separate.js`, `brain.js`, `pallet.js` + `pallet/` (`crud.js`, `loading.js`, `sync.js`). Undo = in-memory action history (max 50) in boxes/separate/pallet-sync; boxes store sets `{ persist: false }` — business data lives only in IndexedDB, Pinia persist is session/UI state only.
- `@/` → `src/`. UI components globally registered from `@/components/ui` barrel — but barrel omits `Picker.vue`, `Tab.vue`, `Tabs.vue`; import those directly. Vant is icons only (`VanIcon`); `preflight: false` in `tailwind.config.js` is required — do not re-enable (breaks Vant).
- `VitePWA` plugin is commented out in `vite.config.js` — PWA installability comes from hand-written `public/manifest.webmanifest`. GitHub Pages SPA routing: `public/404.html` stashes path in `sessionStorage.redirect_path`, `main.js` restores it via `router.replace()`.

## IndexedDB (Dexie, `src/lib/db.js`) — read before touching

- Current schema v4: PKs are UUID strings (`id`), e.g. `boxes: 'id, status, box_number'`. `collector_id` was removed (single-user mode; `config.js isAdmin()` always true). `box_items: '[boxId+barcode], &barcode'` — `&barcode` is **globally unique**.
- `ensureDbReady()` MUST run before any DB read/write (main.js does this). It migrates legacy v1/v2 DBs (PK was `status`) via export → `Dexie.delete()` → reimport; concurrent tabs during migration can lose data.
- Gotchas: `boxes.create()` / `pallets.create()` refuse when `brain_items` is empty (`requireBrainDatabase` — create nothing before Excel import, and don't pre-consume numbers: guard runs before `nextCounter`). Box/pallet numbers are monotonic counters in `settings` (`box_counter`/`pallet_counter`), never reused on partial clears; only `resetLocalData()` resets them to 1. `box_items` add can throw `ConstraintError` on the global index — `boxes.update` maps it to `{ message: 'duplicate_global', box_number }`. `separate_items.id` must be client-generated (`generateId()` in `db.js`) — Dexie rejects inserts without it. `generateId()` falls back to `Math.random` hex-UUID because `crypto.randomUUID` is unavailable over HTTP-on-LAN.
- Duplicate checks are two-layer: in-memory `checkGlobalDuplicate` (active containers only) + DB lookups `boxItems.findByBarcode` / `palletItems.findInlineByBarcode` / `findBoxUsage` (include finished containers). Always consult the DB variant for cross-container validation.
- `utils/sync.js` `ScanBatchManager` batches scans to `scan_history` (20 items or 30s, backoff retry to 60s) — not on `window.online`.

## Conventions & gotchas

- Barcodes: parse via `parseBarcodeToBrainNumber()` in `utils/barcode.js` (`Z018700453282` → `187/45328`; handles Cyrillic `Я`→`Z`, `187/…` passthrough, short numbers, EAN-13). Never compare raw Z-codes. Damaged code = starts with `Z` and length < 13 → reject with toast, don't store.
- Scanner (`composables/useScanner.js`): single-shot mode — `startScanner()` checks camera, requires `#<elementId>` in DOM (300ms + 500ms delays), decodes one code (deduped via `lastBarcode`), then `stopScanner()`. TSD keyboard-wedge input goes through `handleTsdInput()` (parse → `ensurePrefix`). Caller owns modal visibility, sounds, vibration.
- Toast: `window.showToast(msg, duration = 2500, type)` is installed by `Toast.vue` `onMounted` — guard with `typeof window.showToast === 'function'` if calling before mount; `type: 'error'` forces 4000ms. `no-console` rule allows only `warn`/`error`.
- Excel: both `xlsx` and `exceljs` are deps; `utils/excel.js` is the import/export owner (exports duplicate the seal via `duplicateSheetBlock` — keep its `endRow` in sync with seal rows: mix 8 / separate 8 / pallet 9 — and append a `Номер` label sheet); `utils/containerImport.js` parses our own exports (`Микс_*`/`Отдельные_*`/`Паллет_*`, detected via sheets + seal cell A3) for `/import`. `sync.js decodeMojibake` fixes WIN1251 filenames — don't strip it.
- Style: Prettier no-semicolons, single quotes, `trailingComma: none`, width 100 (enforced as ESLint error); `eslint.config.js` ignores `dist/**`, `node_modules/**`, `*.config.js`. `no-unused-vars` warns (args `^_` exempt), `vue/multi-word-component-names` off.
