// api/fetch-video.js — V5: Uses proven extraction APIs
// Instead of scraping Facebook (which blocks servers),
// we call APIs that already solved this problem

const https = require('https');

/* ══════════════════════════════════════════
   HTTPS POST/GET helper
   ══════════════════════════════════════════ */
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    };

    const req = https.request(opts, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpRequest(res.headers.location, options).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ statusCode: res.statusCode, body, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/* ══════════════════════════════════════════
   METHOD 1: Cobalt API
   (open-source, supports FB, IG, YT, etc)
   ══════════════════════════════════════════ */
async function tryCobalt(url) {
  console.log('[COBALT] Trying...');
  
  const instances = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh',
  ];

  for (const api of instances) {
    try {
      const res = await httpRequest(api, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          url: url,
          videoQuality: '720',
          filenameStyle: 'basic',
        }),
      });

      console.log(`[COBALT] ${api} → ${res.statusCode}`);
      
      if (res.statusCode === 200) {
        const data = JSON.parse(res.body);
        console.log('[COBALT] Status:', data.status);

        // Direct redirect
        if (data.status === 'redirect' && data.url) {
          return { sd: data.url, hd: '', title: 'فيديو فيسبوك', source: 'cobalt' };
        }

        // Tunnel (proxied download)
        if (data.status === 'tunnel' && data.url) {
          return { sd: data.url, hd: '', title: 'فيديو فيسبوك', source: 'cobalt' };
        }

        // Picker (multiple options)
        if (data.status === 'picker' && data.picker?.length) {
          const videos = data.picker.filter(p => p.type === 'video');
          if (videos.length > 0) {
            return {
              sd: videos[videos.length - 1]?.url || '',
              hd: videos[0]?.url || '',
              title: data.filename || 'فيديو فيسبوك',
              source: 'cobalt',
            };
          }
        }

        // Stream
        if (data.status === 'stream' && data.url) {
          return { sd: data.url, hd: '', title: 'فيديو فيسبوك', source: 'cobalt' };
        }
      }
    } catch (e) {
      console.log(`[COBALT] ${api} error:`, e.message);
    }
  }
  return null;
}

/* ══════════════════════════════════════════
   METHOD 2: FBDown API approach
   (replicate what fdown.net does)
   ══════════════════════════════════════════ */
async function tryFBDown(url) {
  console.log('[FBDOWN] Trying...');

  try {
    // Use the getfvid.com approach - post URL to their API
    const postData = `url=${encodeURIComponent(url)}`;
    
    const res = await httpRequest('https://getfvid.com/api/get-video', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://getfvid.com/',
        'Origin': 'https://getfvid.com',
      },
      body: postData,
    });

    if (res.statusCode === 200) {
      const data = JSON.parse(res.body);
      if (data.success || data.sd || data.hd) {
        return {
          sd: data.sd || data.url || '',
          hd: data.hd || '',
          title: data.title || 'فيديو فيسبوك',
          source: 'getfvid',
        };
      }
    }
  } catch (e) {
    console.log('[FBDOWN] error:', e.message);
  }
  return null;
}

/* ══════════════════════════════════════════
   METHOD 3: 9xbuddy / savefrom approach
   ══════════════════════════════════════════ */
async function try9xbuddy(url) {
  console.log('[9XBUDDY] Trying...');
  
  try {
    const apiUrl = `https://9xbuddy.in/process?url=${encodeURIComponent(url)}`;
    const res = await httpRequest(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://9xbuddy.in/',
      },
    });

    if (res.statusCode === 200) {
      const data = JSON.parse(res.body);
      if (data.url || data.urls?.length) {
        const urls = data.urls || [data];
        const sdUrl = urls.find(u => u.quality === 'sd' || u.quality === '360p')?.url || urls[0]?.url || '';
        const hdUrl = urls.find(u => u.quality === 'hd' || u.quality === '720p')?.url || '';
        if (sdUrl || hdUrl) {
          return { sd: sdUrl, hd: hdUrl, title: data.title || 'فيديو فيسبوك', source: '9xbuddy' };
        }
      }
    }
  } catch(e) {
    console.log('[9XBUDDY] error:', e.message);
  }
  return null;
}

/* ══════════════════════════════════════════
   METHOD 4: Direct scrape with better patterns
   (using mbasic with enhanced cookie simulation)
   ══════════════════════════════════════════ */
async function tryDirectScrape(url) {
  console.log('[SCRAPE] Trying direct...');
  
  const crypto = require('crypto');
  const datr = crypto.randomBytes(12).toString('base64').replace(/[+/=]/g, 'x');
  
  // Resolve share URL first
  let targetUrl = url;
  try {
    const resolveRes = await httpRequest(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Mobile Safari/537.36',
        'Cookie': `datr=${datr}; locale=en_US;`,
      },
    });
    // Try to extract video ID from response
    const vidIdMatch = resolveRes.body.match(/video_id=(\d{10,})/) 
      || resolveRes.body.match(/\/videos\/(\d{10,})/)
      || resolveRes.body.match(/"videoId"\s*:\s*"(\d{10,})"/)
      || resolveRes.body.match(/v=(\d{10,})/);
    
    if (vidIdMatch) {
      targetUrl = `https://mbasic.facebook.com/watch/?v=${vidIdMatch[1]}`;
    }
  } catch(e) {}

  // Now try mbasic
  try {
    const mUrl = targetUrl.replace(/(?:www|m|web|touch)\.facebook\.com/g, 'mbasic.facebook.com');
    const res = await httpRequest(mUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 4.4.2; Nexus 5 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2490.76 Mobile Safari/537.36',
        'Cookie': `datr=${datr}; locale=en_US;`,
        'Accept': 'text/html',
      },
    });

    const html = res.body;
    let sd = '', hd = '', title = '';

    // video_redirect
    const redirects = [...html.matchAll(/href="(\/video_redirect\/\?src=[^"]+)"/gi)];
    for (const m of redirects) {
      const srcM = m[1].match(/src=([^&"]+)/);
      if (srcM) {
        try { const u = decodeURIComponent(srcM[1]); if (u.includes('fbcdn')) { if (!sd) sd = u; else if (!hd) hd = u; } } catch(e) {}
      }
    }

    // sd_src / hd_src
    if (!sd) { const m = html.match(/"sd_src":"([^"]+)"/); if (m) sd = m[1].replace(/\\\//g, '/'); }
    if (!hd) { const m = html.match(/"hd_src":"([^"]+)"/); if (m) hd = m[1].replace(/\\\//g, '/'); }
    if (!sd) { const m = html.match(/playable_url":"([^"]+)"/); if (m) sd = m[1].replace(/\\\//g, '/'); }

    // Title
    const t = html.match(/<title>([^<]+)<\/title>/i);
    if (t) title = t[1].replace(/\s*[-|]?\s*Facebook.*$/i, '').trim();

    if (sd || hd) {
      return { sd, hd, title: title || 'فيديو فيسبوك', source: 'scrape' };
    }
  } catch(e) {
    console.log('[SCRAPE] error:', e.message);
  }
  return null;
}

/* ══════════════════════════════════════════
   MASTER: Try all methods
   ══════════════════════════════════════════ */
async function extractVideo(url) {
  const methods = [
    { name: 'cobalt', fn: () => tryCobalt(url) },
    { name: 'getfvid', fn: () => tryFBDown(url) },
    { name: '9xbuddy', fn: () => try9xbuddy(url) },
    { name: 'scrape', fn: () => tryDirectScrape(url) },
  ];

  const results = [];

  for (const method of methods) {
    console.log(`[MASTER] Trying ${method.name}...`);
    try {
      const result = await method.fn();
      if (result && (result.sd || result.hd)) {
        console.log(`[MASTER] ✓ ${method.name} succeeded!`);
        return result;
      }
      results.push({ method: method.name, status: 'no_video' });
    } catch(e) {
      console.log(`[MASTER] ✗ ${method.name}:`, e.message);
      results.push({ method: method.name, status: 'error', error: e.message });
    }
  }

  console.log('[MASTER] All methods failed:', JSON.stringify(results));
  return null;
}

/* ══════════════════════════════════════════
   VERCEL HANDLER
   ══════════════════════════════════════════ */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'أدخل رابط الفيديو' });
    if (!['facebook.com', 'fb.watch', 'fb.com', 'fb.me'].some(d => url.includes(d))) {
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

  } catch (err) {
    console.error('[ERROR]', err);
    return res.status(500).json({ error: 'خطأ بالسيرفر', message: err.message });
  }
};
