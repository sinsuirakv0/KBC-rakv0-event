/**
 * JST (UTC+9) で "YY/MM/DD HH:MM:SS" を返す
 */
export function getJSTTimestamp() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yy  = String(now.getUTCFullYear()).slice(2);
  const mon = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(now.getUTCDate()).padStart(2, '0');
  const h   = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const sec = String(now.getUTCSeconds()).padStart(2, '0');
  return `${yy}/${mon}/${d} ${h}:${min}:${sec}`;
}
