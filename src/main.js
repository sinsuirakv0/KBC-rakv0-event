import { APP_CONSTANTS } from "./config/constants.js";
import { appState, setState } from "./state/store.js";
import {
  normalizeForSearch,
  stripHtml,
  parseSearchQuery,
  matchesSearch,
  filterAndSortEvents,
} from "./utils/search.js";
import { parseCSV, parseItemNameCsv, parseItemPackCsv } from "./utils/csv.js";
import { parseTsvContent } from "./utils/tsv.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./utils/binary.js";
import {
  fetchText,
  fetchJson,
  decryptDatViaApi,
  encryptDatViaApi,
} from "./services/apiClient.js";
import { loadParsers, getFallbackParsers } from "./parsers/loader.js";
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
  csv: { parseCSV, parseItemNameCsv, parseItemPackCsv },
  tsv: { parseTsvContent },
  binary: { arrayBufferToBase64, base64ToArrayBuffer },
  api: { fetchText, fetchJson, decryptDatViaApi, encryptDatViaApi },
  parsers: { loadParsers, getFallbackParsers },
  history: { fetchHistoryGroups },
  devtools: { parseSheetEntries, arraysEqual },
  ui: createRendererApi(),
};
