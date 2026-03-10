// api/fetch-video.js — V6
// Uses snapsave.app + fdown.net APIs (proven working services)

const https = require('https');
const http = require('http');
const querystring = require('querystring');

/* ═══════════════════════════════════════
   HTTP helper with redirect support
   ═══════════════════════════════════════ */
function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ...opts.headers,
      },
      timeout: 20000,
    };

    const req = lib.request(reqOpts, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let next = res.headers.location;
        if (next.startsWith('/')) next = parsed.origin + next;
        return request(next, opts).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf-8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ═══════════════════════════════════════
   METHOD 1: SnapSave.app
   ═══════════════════════════════════════ */
async function trySnapSave(fbUrl) {
  console.log('[SNAPSAVE] Starting...');
  try {
    // Step 1: Get the page token
    const page = await request('https://snapsave.app/', {
      headers: { 'Accept': 'text/html' },
    });

    // Extract token from form
    const tokenMatch = page.body.match(/name="token"\s+value="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : '';

    // Step 2: Submit the URL
    const postData = querystring.stringify({
      url: fbUrl,
      token: token,
    });

    const res = await request('https://snapsave.app/action.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://snapsave.app/',
        'Origin': 'https://snapsave.app',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: postData,
    });

    console.log('[SNAPSAVE] Response status:', res.status, 'Length:', res.body.length);

    if (res.body.length < 100) return null;

    // Parse the response — it returns encoded JS/HTML
    let html = res.body;

    // Try to decode if it's base64 encoded
    if (html.includes('eval(') || html.includes('decodeURIComponent')) {
      // Extract the encoded string
      const encodedMatch = html.match(/decodeURIComponent\(escape\(atob\("([^"]+)"\)\)\)/);
      if (encodedMatch) {
        try {
          const decoded = Buffer.from(encodedMatch[1], 'base64').toString('utf-8');
          html = decodeURIComponent(escape(decoded));
        } catch(e) {
          // Try direct base64
          try { html = Buffer.from(encodedMatch[1], 'base64').toString('utf-8'); } catch(e2) {}
        }
      }

      // Alternative decode pattern
      const altMatch = html.match(/atob\("([^"]+)"\)/);
      if (altMatch && !html.includes('fbcdn')) {
        try { html += Buffer.from(altMatch[1], 'base64').toString('utf-8'); } catch(e) {}
      }
    }

    // Extract video URLs from the decoded HTML
    const results = { sd: '', hd: '', title: '' };

    // HD link
    const hdPatterns = [
      /href="(https?:\/\/[^"]*fbcdn[^"]*)"[^>]*>.*?HD/gi,
      /href="(https?:\/\/[^"]*fbcdn[^"]*)"[^>]*>\s*<[^>]*>\s*HD/gi,
      /"(https?:\/\/[^"]*fbcdn\.net[^"]*)"[^}]*"hd"/gi,
      /hd[_\s"':]*(?:url|src|href)['":\s]*(https?:\/\/[^"'\s]+fbcdn[^"'\s]+)/gi,
    ];
    
    // SD link  
    const sdPatterns = [
      /href="(https?:\/\/[^"]*fbcdn[^"]*)"[^>]*>.*?SD/gi,
      /href="(https?:\/\/[^"]*fbcdn[^"]*)"[^>]*>\s*<[^>]*>\s*SD/gi,
      /"(https?:\/\/[^"]*fbcdn\.net[^"]*)"[^}]*"sd"/gi,
      /sd[_\s"':]*(?:url|src|href)['":\s]*(https?:\/\/[^"'\s]+fbcdn[^"'\s]+)/gi,
    ];

    // Generic fbcdn links
    const allLinks = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]*fbcdn\.net[^"]*\.mp4[^"]*)"/gi)];
    const allRawLinks = [...html.matchAll(/(https?:\/\/[^\s"'<>]*fbcdn\.net[^\s"'<>]*\.mp4[^\s"'<>]*)/g)];

    for (const p of hdPatterns) {
      const m = p.exec(html);
      if (m && m[1] && m[1].includes('fbcdn')) { results.hd = cleanFbUrl(m[1]); break; }
    }
    for (const p of sdPatterns) {
      const m = p.exec(html);
      if (m && m[1] && m[1].includes('fbcdn')) { results.sd = cleanFbUrl(m[1]); break; }
    }

    // Fallback to any fbcdn link
    if (!results.sd && allLinks.length > 0) {
      results.sd = cleanFbUrl(allLinks[0][1]);
      if (allLinks.length > 1) results.hd = cleanFbUrl(allLinks[1][1]);
    }
    if (!results.sd && allRawLinks.length > 0) {
      results.sd = cleanFbUrl(allRawLinks[0][1]);
      if (allRawLinks.length > 1 && allRawLinks[1][1] !== allRawLinks[0][1]) {
        results.hd = cleanFbUrl(allRawLinks[1][1]);
      }
    }

    // Title
    const titleMatch = html.match(/<[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</i)
      || html.match(/<h[1-3][^>]*>([^<]+)<\/h/i);
    if (titleMatch) results.title = titleMatch[1].trim();

    if (results.sd || results.hd) {
      console.log('[SNAPSAVE] ✓ Found video!');
      return results;
    }

    console.log('[SNAPSAVE] No fbcdn links found in response');
    return null;
  } catch(e) {
    console.log('[SNAPSAVE] Error:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════
   METHOD 2: getfvid.com
   ═══════════════════════════════════════ */
async function tryGetFvid(fbUrl) {
  console.log('[GETFVID] Starting...');
  try {
    const postData = querystring.stringify({ url: fbUrl });

    const res = await request('https://getfvid.com/downloader', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://getfvid.com/',
        'Origin': 'https://getfvid.com',
      },
      body: postData,
    });

    console.log('[GETFVID] Status:', res.status, 'Len:', res.body.length);

    const html = res.body;
    const results = { sd: '', hd: '', title: '' };

    // Extract download links
    const downloadLinks = [...html.matchAll(/href="(https?:\/\/[^"]*fbcdn[^"]*)"/gi)];
    
    if (downloadLinks.length >= 1) results.sd = cleanFbUrl(downloadLinks[0][1]);
    if (downloadLinks.length >= 2) results.hd = cleanFbUrl(downloadLinks[1][1]);

    // Also check for direct video links
    const directLinks = [...html.matchAll(/(https?:\/\/video[^"'\s]*fbcdn\.net[^"'\s]*)/g)];
    if (!results.sd && directLinks.length > 0) results.sd = cleanFbUrl(directLinks[0][1]);
    if (!results.hd && directLinks.length > 1) results.hd = cleanFbUrl(directLinks[1][1]);

    const titleM = html.match(/<p[^>]*class="[^"]*card-text[^"]*"[^>]*>([^<]+)/i);
    if (titleM) results.title = titleM[1].trim();

    if (results.sd || results.hd) {
      console.log('[GETFVID] ✓ Found!');
      return results;
    }
    return null;
  } catch(e) {
    console.log('[GETFVID] Error:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════
   METHOD 3: fdownloader.net
   ═══════════════════════════════════════ */
async function tryFDownloader(fbUrl) {
  console.log('[FDOWNLOADER] Starting...');
  try {
    // Get CSRF token first
    const page = await request('https://fdownloader.net/', {
      headers: { 'Accept': 'text/html' },
    });
    
    const csrfMatch = page.body.match(/name="csrf[_-]token"[^>]*value="([^"]+)"/i)
      || page.body.match(/name="_token"[^>]*value="([^"]+)"/i);

    const postData = JSON.stringify({
      url: fbUrl,
      ...(csrfMatch ? { token: csrfMatch[1] } : {}),
    });

    const res = await request('https://fdownloader.net/api/ajaxSearch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://fdownloader.net/',
        'Origin': 'https://fdownloader.net',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: postData,
    });

    console.log('[FDOWNLOADER] Status:', res.status);

    if (res.status === 200) {
      let data;
      try { data = JSON.parse(res.body); } catch { data = {}; }

      const html = data.data || data.html || res.body;
      const results = { sd: '', hd: '', title: data.title || '' };

      // Parse links from response HTML
      const links = [...html.matchAll(/href="(https?:\/\/[^"]*fbcdn[^"]*)"/gi)];
      const rawLinks = [...html.matchAll(/(https?:\/\/[^\s"'<>]*fbcdn\.net[^\s"'<>]*\.mp4[^\s"'<>]*)/g)];

      if (links.length >= 1) results.sd = cleanFbUrl(links[0][1]);
      if (links.length >= 2) results.hd = cleanFbUrl(links[1][1]);
      if (!results.sd && rawLinks.length > 0) results.sd = cleanFbUrl(rawLinks[0][1]);

      if (results.sd || results.hd) {
        console.log('[FDOWNLOADER] ✓ Found!');
        return results;
      }
    }
    return null;
  } catch(e) {
    console.log('[FDOWNLOADER] Error:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════
   METHOD 4: fbdownloader.app
   ═══════════════════════════════════════ */
async function tryFBDownloaderApp(fbUrl) {
  console.log('[FBDL-APP] Starting...');
  try {
    const postData = querystring.stringify({ url: fbUrl });

    const res = await request('https://fbdownloader.app/api/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://fbdownloader.app/',
        'Origin': 'https://fbdownloader.app',
      },
      body: postData,
    });

    console.log('[FBDL-APP] Status:', res.status);

    if (res.status === 200) {
      let data;
      try { data = JSON.parse(res.body); } catch { data = {}; }

      if (data.sd || data.hd || data.url) {
        return {
          sd: data.sd || data.url || '',
          hd: data.hd || '',
          title: data.title || 'فيديو فيسبوك',
        };
      }

      // Parse HTML response
      const html = data.data || data.html || res.body;
      const links = [...html.matchAll(/(https?:\/\/[^\s"'<>]*fbcdn\.net[^\s"'<>]*\.mp4[^\s"'<>]*)/g)];
      if (links.length > 0) {
        return {
          sd: cleanFbUrl(links[0][1]),
          hd: links.length > 1 ? cleanFbUrl(links[1][1]) : '',
          title: data.title || 'فيديو فيسبوك',
        };
      }
    }
    return null;
  } catch(e) {
    console.log('[FBDL-APP] Error:', e.message);
    return null;
  }
}

/* ═══════════════════════════════════════
   URL Cleanup
   ═══════════════════════════════════════ */
function cleanFbUrl(url) {
  if (!url) return '';
  return url.replace(/&amp;/g, '&').replace(/\\\//g, '/').replace(/\\u002F/g, '/').replace(/\\u0026/g, '&').trim();
}

/* ═══════════════════════════════════════
   MASTER: Run all methods
   ═══════════════════════════════════════ */
async function extractVideo(url) {
  const methods = [
    { name: 'SnapSave', fn: () => trySnapSave(url) },
    { name: 'GetFvid', fn: () => tryGetFvid(url) },
    { name: 'FDownloader', fn: () => tryFDownloader(url) },
    { name: 'FBDownloaderApp', fn: () => tryFBDownloaderApp(url) },
  ];

  for (const m of methods) {
    console.log(`\n[MASTER] ═══ ${m.name} ═══`);
    try {
      const result = await m.fn();
      if (result && (result.sd || result.hd)) {
        console.log(`[MASTER] ✓ ${m.name} succeeded!`);
        return { ...result, source: m.name };
      }
    } catch(e) {
      console.log(`[MASTER] ✗ ${m.name}: ${e.message}`);
    }
  }

  return null;
}

/* ═══════════════════════════════════════
   VERCEL HANDLER
   ═══════════════════════════════════════ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'أدخل رابط الفيديو' });
    if (!['facebook.com','fb.watch','fb.com','fb.me'].some(d => url.includes(d))) {
      return res.status(400).json({ error: 'رابط غير صالح' });
    }

    const video = await extractVideo(url);

    if (!video) {
      return res.status(404).json({
        error: 'no_video_found',
        message: 'لم نتمكن من استخراج الفيديو. تأكد أن الفيديو عام وجرّب مرة أخرى.',
      });
    }

    const qualities = [];
    if (video.hd) qualities.push({ label: 'HD عالية', resolution: '720p', url: video.hd, recommended: true });
    if (video.sd) qualities.push({ label: 'SD عادية', resolution: '360p', url: video.sd, recommended: qualities.length === 0 });

    return res.status(200).json({
      success: true,
      title: video.title || 'فيديو فيسبوك',
      qualities,
      preview: video.sd || video.hd,
      source: video.source,
    });
  } catch(err) {
    console.error('[ERROR]', err);
    return res.status(500).json({ error: 'خطأ', message: err.message });
  }
};
