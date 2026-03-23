import { Hono } from 'hono';
import { Env, CreateURLRequest, ErrorResponse } from './types';
import { KVStorage } from './kv-storage';
import { RateLimiter } from './rate-limiter';
import { AnalyticsObject } from './durable-objects';

// Create app
const app = new Hono<{ Bindings: Env }>();

/**
 * Extract client IP from request headers
 */
function getClientIP(request: Request): string {
  return request.headers.get('cf-connecting-ip') || 
         request.headers.get('x-forwarded-for') ||
         '0.0.0.0';
}

/**
 * Create error response
 */
function createErrorResponse(
  message: string,
  statusCode: number = 400
): Response {
  const error: ErrorResponse = {
    error: statusCode.toString(),
    message,
    statusCode
  };
  return new Response(JSON.stringify(error), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Add CORS headers
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type');
});

function renderDemoPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>URL Shortener Demo</title>
  <style>
    :root {
      --bg: #f4f7fb;
      --card: #ffffff;
      --line: #d7e0ec;
      --ink: #1e2a3a;
      --muted: #64748b;
      --accent: #0f6fff;
      --ok: #118847;
      --err: #cf2f2f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Arial, sans-serif;
      color: var(--ink);
      background: radial-gradient(circle at 0 0, #eaf2ff 0, var(--bg) 40%);
    }
    .wrap {
      max-width: 980px;
      margin: 0 auto;
      padding: 20px 14px 42px;
    }
    .hero {
      background: linear-gradient(120deg, #0f4fc8, #0f6fff 55%, #2aa9ff);
      color: #fff;
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 14px;
      box-shadow: 0 10px 24px rgba(15, 111, 255, 0.24);
    }
    .hero-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .hero h1 { margin: 0 0 6px; font-size: 1.35rem; }
    .hero p { margin: 0; opacity: 0.95; }
    .repo-link {
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.65);
      border-radius: 999px;
      padding: 6px 10px;
      white-space: nowrap;
      background: rgba(255, 255, 255, 0.12);
    }
    .repo-link:hover {
      background: rgba(255, 255, 255, 0.22);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
    }
    h2 { margin: 0 0 10px; font-size: 1rem; }
    label { display: block; margin: 8px 0 4px; color: var(--muted); font-size: 0.88rem; }
    input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 9px;
      padding: 8px 10px;
      font-size: 0.95rem;
      background: #fff;
    }
    textarea { min-height: 140px; font-family: Consolas, monospace; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .stacked-buttons {
      flex-direction: column;
      align-items: stretch;
    }
    .stacked-buttons button {
      width: 100%;
    }
    button {
      border: 0;
      border-radius: 9px;
      padding: 9px 12px;
      font-weight: 600;
      background: var(--accent);
      color: #fff;
      cursor: pointer;
    }
    button.alt { background: #374a6b; }
    button.ghost { background: #ecf2fb; color: var(--ink); }
    .status { margin-top: 8px; min-height: 18px; font-size: 0.9rem; }
    .ok { color: var(--ok); }
    .err { color: var(--err); }
    .warning {
      margin-top: 10px;
      padding: 8px 10px;
      border-left: 3px solid #e6a817;
      background: #fffbf0;
      border-radius: 0 9px 9px 0;
      font-size: 0.85rem;
      color: #7a5200;
    }
    .preview {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px dashed var(--line);
      border-radius: 9px;
      font-size: 0.88rem;
      color: var(--muted);
      word-break: break-all;
      background: #fafcff;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="hero-head">
        <h1>URL Shortener API Demo</h1>
        <a class="repo-link" href="https://github.com/hassantahhan/url_shortner" target="_blank" rel="noopener noreferrer">GitHub Repo</a>
      </div>
      <p>Single-page UI for health, shorten, info, analytics, and redirect operations.</p>
    </section>

    <section class="grid">
      <article class="card">
        <h2>Health</h2>
        <div class="row"><button id="btnHealth">GET /health</button></div>
        <div id="healthStatus" class="status"></div>
      </article>

      <article class="card">
        <h2>Create URL</h2>
        <label for="longUrl">Long URL</label>
        <input id="longUrl" placeholder="https://example.com/path" />
        <label for="customAlias">Custom Alias (optional)</label>
        <input id="customAlias" placeholder="my-alias" />
        <label for="expiresIn">Expires In (ms, optional)</label>
        <input id="expiresIn" placeholder="86400000" />
        <div class="row"><button id="btnCreate">POST /shorten</button></div>
        <div class="warning">⚠ Do not shorten URLs that contain sensitive information such as passwords, access tokens, session ids, or personal data in the query string. The full URL is stored and returned to anyone who follows the link.</div>
        <div id="createStatus" class="status"></div>
      </article>

      <article class="card">
        <h2>Lookup / Analytics / Redirect</h2>
        <label for="shortCode">Short Code</label>
        <input id="shortCode" placeholder="abc123" />
        <div id="redirectPreview" class="preview">Redirect URL preview: (enter short code)</div>
        <div class="row stacked-buttons">
          <button id="btnOpen" class="ghost">Open Redirect</button>
          <button id="btnInfo">GET /:code/info</button>
          <button id="btnAnalytics" class="alt">GET /:code/analytics</button>
        </div>
        <div id="lookupStatus" class="status"></div>
      </article>

      <article class="card" style="grid-column: 1 / -1;">
        <h2>Response</h2>
        <textarea id="output" readonly>{"message":"Run an action above"}</textarea>
      </article>
    </section>
  </div>

  <script>
    const output = document.getElementById('output');
    const shortCodeInput = document.getElementById('shortCode');
    const redirectPreview = document.getElementById('redirectPreview');

    function setStatus(id, msg, isError) {
      const el = document.getElementById(id);
      el.className = 'status ' + (isError ? 'err' : 'ok');
      el.textContent = msg;
    }

    async function callApi(method, path, body) {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const txt = await res.text();
      let parsed = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body: parsed
      };
    }

    function write(data) {
      output.value = JSON.stringify(data, null, 2);
    }

    function updateRedirectPreview() {
      const code = shortCodeInput.value.trim();
      if (!code) {
        redirectPreview.textContent = 'Redirect URL preview: (enter short code)';
        return;
      }
      const fullUrl = window.location.origin + '/' + encodeURIComponent(code);
      redirectPreview.textContent = 'Redirect URL preview: ' + fullUrl;
    }

    shortCodeInput.addEventListener('input', updateRedirectPreview);

    document.getElementById('btnHealth').addEventListener('click', async () => {
      try {
        const data = await callApi('GET', '/health');
        write(data);
        setStatus('healthStatus', 'Health checked (' + data.status + ')', data.status >= 400);
      } catch {
        setStatus('healthStatus', 'Request failed', true);
      }
    });

    document.getElementById('btnCreate').addEventListener('click', async () => {
      const url = document.getElementById('longUrl').value.trim();
      const alias = document.getElementById('customAlias').value.trim();
      const expiresRaw = document.getElementById('expiresIn').value.trim();

      const body = { url };
      // API field remains customAlias for compatibility.
      if (alias) body.customAlias = alias;
      if (expiresRaw) body.expiresIn = Number(expiresRaw);

      try {
        const data = await callApi('POST', '/shorten', body);
        write(data);
        setStatus('createStatus', 'Create completed (' + data.status + ')', data.status >= 400);
        if (data.body && data.body.shortCode) {
          shortCodeInput.value = data.body.shortCode;
          updateRedirectPreview();
        }
      } catch {
        setStatus('createStatus', 'Request failed', true);
      }
    });

    document.getElementById('btnInfo').addEventListener('click', async () => {
      const code = shortCodeInput.value.trim();
      if (!code) return setStatus('lookupStatus', 'Enter a short code first', true);
      try {
        const data = await callApi('GET', '/' + encodeURIComponent(code) + '/info');
        write(data);
        setStatus('lookupStatus', 'Info fetched (' + data.status + ')', data.status >= 400);
      } catch {
        setStatus('lookupStatus', 'Request failed', true);
      }
    });

    document.getElementById('btnAnalytics').addEventListener('click', async () => {
      const code = shortCodeInput.value.trim();
      if (!code) return setStatus('lookupStatus', 'Enter a short code first', true);
      try {
        const data = await callApi('GET', '/' + encodeURIComponent(code) + '/analytics');
        write(data);
        setStatus('lookupStatus', 'Analytics fetched (' + data.status + ')', data.status >= 400);
      } catch {
        setStatus('lookupStatus', 'Request failed', true);
      }
    });

    document.getElementById('btnOpen').addEventListener('click', () => {
      const code = shortCodeInput.value.trim();
      if (!code) return setStatus('lookupStatus', 'Enter a short code first', true);
      const target = '/' + encodeURIComponent(code);
      window.open(target, '_blank', 'noopener,noreferrer');
    });

    updateRedirectPreview();
  </script>
</body>
</html>`;
}

/**
 * Health check endpoint
 */
app.get('/health', () => {
  return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});

app.get('/demo', (c) => {
  return new Response(renderDemoPage(), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
});

app.get('/', (c) => {
  return c.redirect('/demo', 302);
});

/**
 * POST /shorten - Create a new shortened URL
 */
app.post('/shorten', async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const clientIP = getClientIP(request);
  const rateLimiter = new RateLimiter({
    requestsPerMinute: 30,
    requestsPerHour: 500,
    ipBased: true
  });

  // Check rate limit for writes
  const rateLimitCheck = await rateLimiter.checkLimit(
    env.RATE_LIMIT_KV || env.URL_STORE,
    clientIP,
    'create'
  );

  if (!rateLimitCheck.allowed) {
    await rateLimiter.resetCreateWindow(
      env.RATE_LIMIT_KV || env.URL_STORE,
      clientIP
    );

    const response = createErrorResponse(
      'Rate limit exceeded. Too many requests.',
      429
    );
    Object.entries(rateLimiter.createHeaders(
      rateLimitCheck.remaining,
      rateLimitCheck.resetTime
    )).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }

  try {
    const body = (await request.json()) as CreateURLRequest;

    // Validate URL
    if (!body.url) {
      return createErrorResponse('Missing required field: url', 400);
    }

    try {
      new URL(body.url); // Validate URL format
    } catch {
      return createErrorResponse('Invalid URL format', 400);
    }

    // Optional: Validate custom alias format
    if (body.customAlias && !/^[a-zA-Z0-9_-]{3,20}$/.test(body.customAlias)) {
      return createErrorResponse(
        'Custom alias must be 3-20 characters, alphanumeric with hyphens/underscores',
        400
      );
    }

    const storage = new KVStorage(env.URL_STORE);

    // Check if custom alias already exists
    if (body.customAlias && await storage.codeExists(`alias:${body.customAlias}`)) {
      return createErrorResponse('Custom alias already taken', 409);
    }

    const result = await storage.createURL(body);

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  } catch (error) {
    console.error('Error creating shortened URL:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

/**
 * GET /:code - Redirect to original URL
 */
app.get('/:code', async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const code = c.req.param('code');
  const clientIP = getClientIP(request);

  try {
    const storage = new KVStorage(env.URL_STORE);
    const urlEntry = await storage.getURL(code);

    if (!urlEntry) {
      return createErrorResponse('Short URL not found', 404);
    }

    // Check if URL is expired
    if (storage.isExpired(urlEntry)) {
      // Delete expired entry
      await storage.deleteURL(code);
      return createErrorResponse('Short URL has expired', 410);
    }

    // Record analytics in Durable Object
    try {
      const analyticsId = env.ANALYTICS.idFromName(code);
      const analytics = env.ANALYTICS.get(analyticsId);
      
      await analytics.fetch(
        new Request(`http://internal/record?code=${code}`, {
          method: 'POST',
          body: JSON.stringify({
            referrer: request.headers.get('referer'),
            country: request.headers.get('cf-ipcountry'),
            userAgent: request.headers.get('user-agent')
          })
        })
      );
    } catch (error) {
      console.warn('Failed to record analytics:', error);
    }

    // Response with multi-day edge cache
    return new Response(null, {
      status: 301,
      headers: {
        'Location': urlEntry.originalUrl,
        'Cache-Control': 'public, max-age=86400, s-maxage=604800', // 1 day client, 7 days edge
        'Content-Type': 'text/plain'
      }
    });
  } catch (error) {
    console.error('Error retrieving URL:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

/**
 * GET /:code/info - Get information about a short URL
 */
app.get('/:code/info', async (c) => {
  const env = c.env;
  const code = c.req.param('code');

  try {
    const storage = new KVStorage(env.URL_STORE);
    const urlEntry = await storage.getURL(code);

    if (!urlEntry) {
      return createErrorResponse('Short URL not found', 404);
    }

    if (storage.isExpired(urlEntry)) {
      await storage.deleteURL(code);
      return createErrorResponse('Short URL has expired', 410);
    }

    return new Response(JSON.stringify(urlEntry), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error retrieving URL info:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

/**
 * GET /:code/analytics - Get analytics for a short URL
 */
app.get('/:code/analytics', async (c) => {
  const env = c.env;
  const code = c.req.param('code');

  try {
    const storage = new KVStorage(env.URL_STORE);
    const urlEntry = await storage.getURL(code);

    if (!urlEntry) {
      return createErrorResponse('Short URL not found', 404);
    }

    // Get analytics from Durable Object
    const analyticsId = env.ANALYTICS.idFromName(code);
    const analytics = env.ANALYTICS.get(analyticsId);

    const analyticsResponse = await analytics.fetch(
      new Request(`http://internal/analytics?code=${code}`, {
        method: 'GET'
      })
    );

    return new Response(analyticsResponse.body, {
      status: analyticsResponse.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });
  } catch (error) {
    console.error('Error retrieving analytics:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

/**
 * OPTIONS - Handle CORS preflight
 */
app.options('*', () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
});

/**
 * 404 Handler
 */
app.notFound(() => {
  return createErrorResponse('Endpoint not found', 404);
});

/**
 * Main handler
 */
export default app;

// Export Durable Object
export { AnalyticsObject };
