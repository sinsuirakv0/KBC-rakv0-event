import { parseGatya } from "../../parsers/gatya.js";
import { parseSale } from "../../parsers/sale.js";
import { parseItem } from "../../parsers/item.js";
import { APP_CONSTANTS } from "../config/constants.js";

const FALLBACKS = {
  parseGatyaBrowser: parseGatya,
  parseSaleBrowser: parseSale,
  parseItemBrowser: parseItem,
};

export function getFallbackParsers() {
  return { ...FALLBACKS };
}

export async function loadParsers() {
  const map = [
    { file: "gatya", exportName: "parseGatya", globalName: "parseGatyaBrowser" },
    { file: "sale", exportName: "parseSale", globalName: "parseSaleBrowser" },
    { file: "item", exportName: "parseItem", globalName: "parseItemBrowser" },
  ];
  const loaded = { ...FALLBACKS };
  await Promise.all(
    map.map(async ({ file, exportName, globalName }) => {
      try {
        const version = new Date().toISOString().slice(0, 10);
        const res = await fetch(`${APP_CONSTANTS.PARSER_BASE}/${file}.js?v=${version}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let src = await res.text();
        src = src.replace(/^export\s+/gm, "");
        // eslint-disable-next-line no-new-func
        const fn = new Function(`${src}; return ${exportName};`)();
        loaded[globalName] = fn;
      } catch (_e) {
        loaded[globalName] = FALLBACKS[globalName];
      }
    }),
  );
  return loaded;
}
