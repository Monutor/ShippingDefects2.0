# Warehouse Brain PWA — Project Guide

## Commands

```sh
# Frontend / PWA (port 3000, fully client-side — no backend, no API proxy)
npm run dev

# Lint (ESLint + Prettier), run before committing
npm run lint

# Build for GitHub Pages (/ShippingDefects2.0/ base)
npm run build
```

## Architecture

- **Stack**: Vue 3 (`<script setup>` + Composition API), Pinia (persist only for session/UI state), Tailwind (dark-only), Vite. Fully client-side — no backend; all data in IndexedDB via Dexie
- **Routes** (lazy-loaded): `/`, `/upload`, `/mix-view`, `/pallet-view`, `/boxes`, `/separate`, `/mix/:boxId`, `/pallet/:palletId`, `/login`, `/user`
- **ContainerView.vue** — reusable component used by MixView and PalletView (~700 lines, includes scanner modal, item list, status bar, action buttons)
- **Data model**: all business data lives in IndexedDB (Dexie, `lib/db.js`). Pinia persist is used only for session/UI state; nothing sensitive is stored in localStorage
- **Import alias**: `@/` → `src/`
- **UI components** globally registered from `@/components/ui` barrel; Vant used only for icons (`<VanIcon name="..." />`)
- **Tailwind**: `darkMode: 'class'`, `preflight: false` (breaks Vant), custom slate/gray/primary/success/warning/error palettes
- **Prettier**: no semicolons, single quotes, trailingComma: none, printWidth: 100
- **No TypeScript, no tests**

## Key Patterns

- Barcode format: `Z018700453282` → parsed as `187/45328` (`utils/barcode.js`). Z-codes < 13 chars → damaged, rejected with toast
- Scanner: `useScanner.js` composable, returned object destructured; `startScanner()` auto-detects camera, deduplicates by `lastBarcode`
- No network layer: all reads/writes go through Dexie store `lib/db.js`; offline queues flushed on `window.online`
- Single-user mode: admin check is local (`config.js` `isAdmin()` always returns true); collector identified by `employeeId`
- `window.showToast(msg, duration?, type?)` globally available
- Action history + undo pattern in container stores (boxes, separate)

## Data storage (IndexedDB / Dexie)

All data is stored client-side in IndexedDB via Dexie (`src/lib/db.js`). No server, no API.

- **boxes**: `status, collector_id, id, box_number` (auto-increment PK `key`)
- **brain_items**: `&barcode` (unique)
- **box_items**: `[boxId+barcode]`, `&barcode` (global unique barcode — the global constraint is stricter than the per-box duplicate check in `stores/boxes.js`)
- **separate_items**: `id, &barcode` (unique)
- **settings**: `&key`
- Profile / collector: stored in IndexedDB, identified by `employeeId`
