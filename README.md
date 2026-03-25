# Global URL Shortener

This project turns long links into short, branded links that are fast for customers worldwide, track how queries perform in real time, and stay reliable during high traffic. It helps you share cleaner URLs, measure clicks by source and region, and reduce infrastructure overhead by running on Cloudflare’s global network.

## Design Overview

The design follows an edge-first design where Cloudflare Workers handle request routing, validation, and response shaping close to the user. The goal is to keep redirects fast globally while centralizing business rules for creation, expiration, and error handling in a single runtime layer.

The storage model is intentionally split by access pattern. URL mappings and lightweight metadata are stored in Workers KV for low-latency global reads, while analytics counters are handled by Durable Objects to guarantee serialized updates and avoid lost increments under concurrent traffic.

Business logic is designed around reliability and cost-efficient scale: create requests are rate-limited, redirects are aggressively cached at the edge, expired links are rejected with explicit lifecycle semantics, and analytics recording is treated as best-effort so redirect correctness remains the primary behavior of the system.

```
┌────────────────────────────────────────────────┐
│                Client Request                  │
└──────────────────────┬─────────────────────────┘
                       │
          ┌────────────▼──────────────┐
          │  Cloudflare Edge Network  │
          │  (Cache Layer - 7 days)   │
          └────────────┬──────────────┘
                       │
          ┌────────────▼──────────────┐
          │  Cloudflare Worker        │
          │  ├─ Rate Limiting         │
          │  └─ Request Processing    │
          └─┬──────────────────┬──────┘
            │                  │
    ┌───────▼─────────┐  ┌─────▼──────────────┐
    │ Workers KV      │  │ Durable Objects    │
    │ (URL Mappings)  │  │ (Analytics)        │
    │ - Fast Reads    │  │ - Real-time Stats  │
    └─────────────────┘  └────────────────────┘
```

## Quick Links

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- API reference: [API_DOCS.md](API_DOCS.md)

## Features

✅ **Fast URL Redirection**: Cached at the edge with <100 ms latency  
✅ **Global Distribution**: Uses Cloudflare's worldwide data centers  
✅ **Analytics**: Real-time tracking of clicks, referrers, and geographic data  
✅ **Rate Limiting**: Prevents abuse with configurable per-IP limits  
✅ **Custom Aliases**: Support for vanity URLs (customized and  memorable)  
✅ **URL Expiration**: Optional TTL for temporary short codes  
✅ **Security**: HTTPS only, CORS enabled  

## Setup Instructions

### Prerequisites

- npm
- Node.js
- Wrangler CLI installed
- Cloudflare account with Workers enabled

```bash
npm install -g wrangler
```

### Installation

1. **Install dependencies**

```bash
npm install
```

2. **Create KV Namespaces**

Create separate namespaces for each environment:

```bash
# Development
npx wrangler kv namespace create URL_STORE --env development
npx wrangler kv namespace create RATE_LIMIT_KV --env development

# Production
npx wrangler kv namespace create URL_STORE --env production
npx wrangler kv namespace create RATE_LIMIT_KV --env production
```

Manually update the resulting IDs in `wrangler.toml` under each environment's `kv_namespaces`.

Or run this command to auto-populate the namesapce bindings in `wrangler.toml` with the namesapce IDs in your Cloudflare account:

```powershell
$n = (npx wrangler kv namespace list 2>$null | Out-String); $n = $n.Substring($n.IndexOf('[')); $n = $n | ConvertFrom-Json; function i($t){($n|?{$_.title-eq$t}).id}; $t = Get-Content wrangler.toml -Raw; $d = $t.IndexOf('[env.development]'); $p = $t.IndexOf('[env.production]'); $db = $t.Substring($d,$p-$d); $pb = $t.Substring($p); $db = $db -replace '(binding = "URL_STORE"\s+id = ")[^"]*(")',"`${1}$(i 'development-URL_STORE')`${2}"; $db = $db -replace '(binding = "RATE_LIMIT_KV"\s+id = ")[^"]*(")',"`${1}$(i 'development-RATE_LIMIT_KV')`${2}"; $pb = $pb -replace '(binding = "URL_STORE"\s+id = ")[^"]*(")',"`${1}$(i 'production-URL_STORE')`${2}"; $pb = $pb -replace '(binding = "RATE_LIMIT_KV"\s+id = ")[^"]*(")',"`${1}$(i 'production-RATE_LIMIT_KV')`${2}"; $t.Substring(0,$d)+$db+$pb | Set-Content wrangler.toml -NoNewline; Write-Host "Done"
```

3. **Run Locally**

```bash
npm run dev
```

The worker will run at `http://localhost:8787`

4. **Deploy to Cloudflare**

**Development deployment**

```bash
npm run deploy -- -e development
```

Development URL:

```text
https://url-shortener-dev.<your-subdomain>.workers.dev
```

**Production deployment**

Before production deploys, update `wrangler.toml` under `[env.production]` by replacing `your-domain.example.com` with your real production domain, then deploy:

```bash
npm run deploy -- -e production
```

5. **Run Tests**

The project includes an integration-style test script in `test-examples.js`.

1. Start the local worker in one terminal:

```bash
npm run dev
```

2. In a second terminal, run:

```bash
npm test
```

By default, tests target `http://localhost:8787`.
To run tests against another environment, set `BASE_URL` before running `npm test`.

Example:

```
npx cross-env BASE_URL=https://your-domain.example.com npm test
```

## GitHub Actions

Configured workflows:

- `CI` (`.github/workflows/ci.yml`): runs on PRs and pushes to `main`.
- `Deploy Development` (`.github/workflows/deploy-development.yml`): runs on pushes to `main` and manual trigger.
- `Deploy Production` (`.github/workflows/deploy-production.yml`): manual trigger only.

CI steps:

1. `npm ci`
2. `npm run type-check`
3. `npm run build`
4. Start worker locally with `npm run dev`
5. Wait for `/health`
6. Run `npm test` against `http://127.0.0.1:8787`

Required GitHub secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

GitHub Environments used:

- `development`
- `production`

Manual steps (one-time): create KV namespaces, set IDs in `wrangler.toml`, and configure production route/domain.

## Monitoring & Debugging

### Test with curl

```bash
# Create short URL
curl -X POST http://localhost:8787/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com",
    "customAlias": "github"
  }'

# Visit short URL
curl -i http://localhost:8787/github

# Get analytics
curl http://localhost:8787/github/analytics

# Get URL info
curl http://localhost:8787/github/info
```

### Wrangler Dashboard

Monitor your worker metrics:

```bash
wrangler tail
# Shows real-time request logs
```

### View Errors

```bash
wrangler tail --format json
# See detailed error traces
```

### "Namespace not found" error
```bash
# List your KV namespaces
wrangler kv:namespace list

# Update wrangler.toml with correct IDs
```

### Rate limit issues
- Check IP detection: `cf-connecting-ip` header
- Adjust limits in `src/rate-limiter.ts`
- Test with `X-Forwarded-For` header simulation

### Cache not working
- Check `Cache-Control` headers returned from cloudflare Dashboard
- Verify `s-maxage` directive for edge cache
- Clear cache via cloudflare Dashboard if needed

## API Examples

### Create Shortened URL

**Endpoint:** `POST /shorten`

**Request:**
```json
{
  "url": "https://example.com/very/long/path",
  "customAlias": "mylink",
  "expiresIn": 86400000
}
```

**Parameters:**
- `url` (required): The URL to shorten
- `customAlias` (optional): Custom short code (3-20 chars, alphanumeric + hyphens)
- `expiresIn` (optional): Milliseconds until expiration (defaults to 30 days)

**Response (201):**
```json
{
  "shortCode": "abc123",
  "shortUrl": "https://hassantahhan.workers.dev/abc123",
  "originalUrl": "https://example.com/very/long/path",
  "createdAt": 1700000000000,
  "expiresAt": 1700086400000
}
```

### Redirect to Original URL

**Endpoint:** `GET /:code`

Redirects to the original URL with HTTP 301 (Moved Permanently). Response is cached at Cloudflare edge for 7 days.

**Example:**
```
GET /abc123
→ 301 Location: https://example.com/very/long/path
```

## Decommission

To fully remove all resources created by this project from Cloudflare:

### 1. Delete the Workers

```bash
# Delete production worker
npx wrangler delete --name url-shortener

# Delete development worker
npx wrangler delete --name url-shortener-dev
```

### 2. Delete KV Namespaces

```bash
# List all namespaces to confirm IDs
npx wrangler kv namespace list

npx wrangler kv namespace delete --namespace-id [...namespace-id...]
```

## Caching Strategy

Since short URLs are **static** (the target never changes without deletion), we can cache aggressively:

1. **First access**: Worker queries KV, gets URL, sets cache headers
2. **Subsequent accesses**: Cloudflare serves cached response from edge location
3. **Result**: <100ms response times for 99% of requests globally


| Component          | Cache TTL        | Location      | Strategy           |
|--------------------|------------------|---------------|--------------------|
| Redirects          | 7 days (604800s) | Edge (Tier 1) | Aggressive caching |
| URL Info           | 1 hour (3600s)   | Edge          | Standard caching   |
| Analytics          | 1 minute (60s)   | Edge          | Short-lived cache  |
| Health Check       | No cache         | Origin        | Real-time check    |

## Security Controls

### Rate Limiting

Applied on `POST /shorten` only — 30 requests/minute per IP. Returns `429` on breach with:

```
RateLimit-Limit: 30
RateLimit-Remaining: 27
RateLimit-Reset: 1700000060
```

### Response Headers

- CORS enabled on all endpoints (`Access-Control-Allow-Origin: *`)
- JSON responses include `Content-Type: application/json`
- Redirects return `301` with a `Location` header only — no HTTP body

### Privacy Protection

- Each URL record stores only: short code, original URL, timestamps, and optional alias
- Creator IP is used transiently for rate limiting only — never written to KV
- Analytics are aggregated totals (referrer domain, country code, browser name) — no per-visitor records are kept
- The original URL is stored exactly as provided; avoid shortening URLs that contain credentials, tokens, or personal identifiers in the query string (e.g. `?token=`, `?session=`, `?email=`)

## Cost Estimate

| Component | Cloudflare |
|-----------|-----------|
| 1M API calls/day | $0.50 |
| 100M page views/day | Included* |
| Edge caching | Global |
| Analytics DB | Included |

*Cloudflare Workers Scale pricing tier

## License

MIT