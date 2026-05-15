const CACHE_TTL = 5 * 60 * 1000; // 5分
let cache = { content: null, timestamp: 0 };

export default async (req, res) => {
  // Refererチェック（関数の内側）
  const ALLOWED_ORIGIN = 'https://kbc-rakv0-event.vercel.app';
  const referer = req.headers['referer'] || req.headers['origin'] || '';
  if (!referer.startsWith(ALLOWED_ORIGIN)) {
    res.statusCode = 403;
    res.end('// Forbidden');
    return;
  }

  try {
    const now = Date.now();

    // キャッシュが有効なら即返す
    if (cache.content && (now - cache.timestamp) < CACHE_TTL) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.end(cache.content);
      return;
    }

    const owner = process.env.PRIVATE_REPO_OWNER;
    const repo  = process.env.PRIVATE_REPO_NAME;
    const token = process.env.GITHUB_PRIVATE_TOKEN;

    if (!owner || !repo || !token) {
      res.statusCode = 500;
      res.end('// Server misconfigured');
      return;
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/app.js`;
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3.raw',
        'User-Agent': 'kbc-app-bundle',
      },
    });

    if (!response.ok) {
      res.statusCode = response.status;
      res.end(`// GitHub API error: ${response.status}`);
      return;
    }

    const jsContent = await response.text();

    // キャッシュ更新
    cache = { content: jsContent, timestamp: now };

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(jsContent);

  } catch (e) {
    res.statusCode = 500;
    res.end(`// Server error: ${e.message}`);
  }
};