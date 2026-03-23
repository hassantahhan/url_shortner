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

Update the resulting IDs in `wrangler.toml` under each environment's `kv_namespaces`.

3. **Run Locally**

```bash
npm run dev
```

The worker will run at `http://localhost:8787`

4. **Deploy to Cloudflare**

```bash
# Deploy to development
npm run deploy -- -e development

# Deploy to production
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

Example (PowerShell):

```powershell
$env:BASE_URL = "https://your-worker-domain.example.com"
npm test
```

## API Documentation

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

**Rate Limit:** 30 requests/minute per IP

### Redirect to Original URL

**Endpoint:** `GET /:code`

Redirects to the original URL with HTTP 301 (Moved Permanently). Response is cached at Cloudflare edge for 7 days.

**Example:**
```
GET /abc123
→ 301 Location: https://example.com/very/long/path
```

### Get URL Information

**Endpoint:** `GET /:code/info`

**Response:**
```json
{
  "id": "abc123",
  "originalUrl": "https://example.com/very/long/path",
  "createdAt": 1700000000000,
  "customAlias": "mylink"
}
```

### Get Analytics

**Endpoint:** `GET /:code/analytics`

**Response:**
```json
{
  "shortCode": "abc123",
  "redirectCount": 1250,
  "lastAccessedAt": 1700050000000,
  "referrers": {
    "twitter.com": 450,
    "facebook.com": 380,
    "direct": 420
  },
  "countries": {
    "US": 600,
    "GB": 300,
    "FR": 200,
    "OTHER": 150
  },
  "userAgents": {
    "Chrome": 700,
    "Safari": 350,
    "Firefox": 200
  }
}
```

## Performance Optimization

### Caching Strategy

| Component          | Cache TTL        | Location      | Strategy           |
|--------------------|------------------|---------------|--------------------|
| Redirects          | 7 days (604800s) | Edge (Tier 1) | Aggressive caching |
| URL Info           | 1 hour (3600s)   | Edge          | Standard caching   |
| Analytics          | 1 minute (60s)   | Edge          | Short-lived cache  |
| Health Check       | No cache         | Origin        | Real-time check    |

### Why Edge Caching Works

Since short URLs are **static** (the target never changes without deletion), we can cache aggressively:

1. **First access**: Worker queries KV, gets URL, sets cache headers
2. **Subsequent accesses**: Cloudflare serves cached response from edge location
3. **Result**: <100ms response times for 99% of requests globally

## Security Implementation

### Rate Limiting

**Create endpoint (write-heavy):**
- 30 requests/minute per IP
- Prevents rapid-fire URL creation attacks

**Current enforcement:**
- Applied on `POST /shorten`
- Returns 429 with standard rate-limit headers when exceeded

**Headers returned:**
```
RateLimit-Limit: 30
RateLimit-Remaining: 27
RateLimit-Reset: 1700000060
```

### CORS & Security Headers

- Cross-Origin Requests enabled with proper CORS headers
- JSON endpoints return `Content-Type: application/json`
- Redirect endpoint (`GET /:code`) returns `301` with `Location` header
- Error messages are informative but not sensitive

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

## Troubleshooting

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