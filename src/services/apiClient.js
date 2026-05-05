export async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function decryptDatViaApi(datBase64, locale = "ja") {
  const res = await fetch("/api/decryptDat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: datBase64, locale }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "API decrypt failed");
  }
  const json = await res.json();
  return json.text;
}

export async function encryptDatViaApi(text, locale = "ja") {
  const res = await fetch("/api/encryptDat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, locale }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || "API encrypt failed");
  }
  return res.arrayBuffer();
}
