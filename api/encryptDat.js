import crypto from 'crypto';

const SALTS = { ja: 'battlecats', jp: 'battlecats', kr: 'battlecatskr', en: 'battlecatsen', tw: 'battlecatstw' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

export default async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    const body = await readBody(req);
    const { text, locale = 'ja' } = body;

    if (!text) { res.statusCode = 400; res.end('Missing text'); return; }

    const keyBase = process.env.DAT_KEY_BASE || process.env.DEV_KEY_BASE;
    if (!keyBase) { res.statusCode = 500; res.end('Server misconfigured: DAT_KEY_BASE not set'); return; }

    const md5 = crypto.createHash('md5').update(String(keyBase)).digest('hex');
    const key = Buffer.from(md5.substring(0, 16), 'utf8');

    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(true);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(String(text), 'utf8')), cipher.final()]);

    const salt = SALTS[locale] || SALTS.ja;
    const hashHex = crypto.createHash('md5')
      .update(Buffer.concat([Buffer.from(String(salt), 'utf8'), ciphertext]))
      .digest('hex');

    const out = Buffer.concat([ciphertext, Buffer.from(hashHex, 'utf8')]);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', out.length);
    res.end(out);
  } catch (e) {
    res.statusCode = 500;
    res.end('Server error: ' + e.message);
  }
};