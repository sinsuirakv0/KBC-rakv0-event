const crypto = require('crypto');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    const body = await readBody(req);
    const { data, locale = 'ja' } = body;

    if (!data) { res.statusCode = 400; res.end('Missing data'); return; }

    const keyBase = process.env.DAT_KEY_BASE || process.env.DEV_KEY_BASE;
    if (!keyBase) { res.statusCode = 500; res.end('Server misconfigured: DAT_KEY_BASE not set'); return; }

    const md5 = crypto.createHash('md5').update(String(keyBase)).digest('hex');
    const key = Buffer.from(md5.substring(0, 16), 'utf8');

    const buf = Buffer.from(data, 'base64');
    if (buf.length <= 32) { res.statusCode = 400; res.end('Encrypted file too small'); return; }

    const ciphertext = buf.slice(0, buf.length - 32);
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ text: decrypted.toString('utf8') }));
  } catch (e) {
    res.statusCode = 500;
    res.end('Server error: ' + e.message);
  }
};