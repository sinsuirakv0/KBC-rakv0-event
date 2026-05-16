import crypto from 'crypto';

let plainCache = { content: null, timestamp: 0 };
const CACHE_TTL = 5 * 60 * 1000;

function getSessionKey(secret) {
  const minute = Math.floor(Date.now() / 60000);
  return crypto.createHmac('sha256', secret).update(String(minute)).digest('hex').substring(0, 32);
}


function decryptBundle(encFile, secret) {
  const [ivHex, encB64] = encFile.split(':');
  const key     = crypto.createHash('sha256').update(secret).digest();
  const iv      = Buffer.from(ivHex, 'hex');
  const enc     = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}


function reEncrypt(plainText, sessionKey) {
  const key     = crypto.createHash('sha256').update(sessionKey).digest();
  const iv      = crypto.randomBytes(16);
  const cipher  = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('base64');
}

export default async (req, res) => {
  const ALLOWED_ORIGIN = 'https://kbc-rakv0-event.vercel.app';
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  if (!referer.startsWith(ALLOWED_ORIGIN)) {
    res.statusCode = 403;
    res.end('');
    return;
  }

  try {
    const secret = process.env.APP_BUNDLE_SECRET;
    const owner  = process.env.PRIVATE_REPO_OWNER;
    const repo   = process.env.PRIVATE_REPO_NAME;
    const token  = process.env.GITHUB_PRIVATE_TOKEN;

    if (!secret || !owner || !repo || !token) {
      res.statusCode = 500;
      res.end('');
      return;
    }

    const now = Date.now();
    let plainJs;

    if (plainCache.content && (now - plainCache.timestamp) < CACHE_TTL) {
      plainJs = plainCache.content;
    } else {
      const apiUrl  = `https://api.github.com/repos/${owner}/${repo}/contents/app.enc`;
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept':        'application/vnd.github.v3.raw',
          'User-Agent':    'kbc-app-bundle',
        },
      });

      if (!response.ok) {
        res.statusCode = response.status;
        res.end('');
        return;
      }

      const encFile = await response.text();
      plainJs = decryptBundle(encFile, secret);
      plainCache = { content: plainJs, timestamp: now };
    }

    const sessionKey  = getSessionKey(secret);
    const reEncrypted = reEncrypt(plainJs, sessionKey);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ b: reEncrypted, k: sessionKey }));

  } catch (e) {
    res.statusCode = 500;
    res.end('');
  }
};