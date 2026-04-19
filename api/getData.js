import { getJWT } from "../lib/jwt.js";

export default async function handler(req, res) {
  try {
    const type = req.query.type || "gatya";
    const locale = req.query.locale || "ja";
    const urlOnly = req.query.urlOnly === "1";

    const jwt = await getJWT(locale);

    // ★ 日本だけ URL が特別
    const base =
      locale === "ja"
        ? "battlecats_production"
        : `battlecats${locale}_production`;

    const url = `https://nyanko-events.ponosgames.com/${base}/${type}.tsv?jwt=${jwt}`;

    if (urlOnly) return res.status(200).send(url);

    const response = await fetch(url);
    const text = await response.text();

    res.status(200).send(text);

  } catch (err) {
    console.error("API ERROR:", err);
    res.status(500).send("Internal Server Error: " + err.message);
  }
}
