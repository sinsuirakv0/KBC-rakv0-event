# Architecture (Phase 1)

## Overview
Phase 1 keeps `index.html` behavior intact while moving reusable logic into `src/` modules.
`index.html` remains the orchestration layer and delegates to module APIs exposed via `window.KBCModules`.

## Module Boundaries
- `src/main.js`: module registry bootstrap and `window.KBCModules` bridge.
- `src/config/constants.js`: shared runtime constants.
- `src/state/store.js`: shared app state container and patch helper.
- `src/utils/`: pure search/normalization and TSV parsing helpers.
- `src/services/apiClient.js`: fetch wrappers and API encryption/decryption clients.
- `src/parsers/loader.js`: dynamic parser loading with local fallback parser imports.
- `src/features/history/`: history grouping logic independent of DOM rendering.
- `src/features/devtools/`: parser bridge helpers and utility predicates for devtools.

## Runtime Flow
1. Browser loads `src/main.js` first.
2. `src/main.js` attaches modular APIs to `window.KBCModules`.
3. Legacy functions in `index.html` delegate to `window.KBCModules` when available.
4. Existing DOM/UI flow continues unchanged.
