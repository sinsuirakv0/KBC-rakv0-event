import { APP_CONSTANTS } from "./config/constants.js";
import { appState, setState } from "./state/store.js";
import {
  normalizeForSearch,
  stripHtml,
  parseSearchQuery,
  matchesSearch,
  filterAndSortEvents,
} from "./utils/search.js";
import { parseTsvContent } from "./utils/tsv.js";
import {
  fetchText,
  fetchJson,
  decryptDatViaApi,
  encryptDatViaApi,
} from "./services/apiClient.js";
import { loadParsers } from "./parsers/loader.js";
import { fetchHistoryGroups } from "./features/history/historyService.js";
import { parseSheetEntries, arraysEqual } from "./features/devtools/parserBridge.js";
import { createRendererApi } from "./ui/renderers/index.js";

window.KBCModules = {
  constants: APP_CONSTANTS,
  state: { appState, setState },
  search: {
    normalizeForSearch,
    stripHtml,
    parseSearchQuery,
    matchesSearch,
    filterAndSortEvents,
  },
  tsv: { parseTsvContent },
  api: { fetchText, fetchJson, decryptDatViaApi, encryptDatViaApi },
  parsers: { loadParsers },
  history: { fetchHistoryGroups },
  devtools: { parseSheetEntries, arraysEqual },
  ui: createRendererApi(),
};
