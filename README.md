# Global URL Shortener - Cloudflare Stack

A production-ready URL shortener built on Cloudflare's edge computing platform with Workers, Workers KV, Durable Objects, and integrated rate limiting.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Request                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────▼──────────────┐
          │  Cloudflare Edge Network  │
          │  (Cache Layer - 7 days)   │
          └────────────┬──────────────┘
                       │
          ┌────────────▼──────────────┐
          │  Cloudflare Worker        │
          │  ├─ Rate Limiting         │
          │  ├─ Routing               │
          │  └─ Request Processing    │
          └─┬──────────────────┬──────┘
            │                  │
    ┌───────▼─────────┐  ┌─────▼──────────────┐
    │ Workers KV      │  │ Durable Objects    │
    │ (URL Mappings)  │  │ (Analytics)        │
    │ - Fast Reads    │  │ - Real-time Stats  │
    │ - Global CDN    │  │ - Persistent Data  │
    └─────────────────┘  └────────────────────┘
```

## Features

✅ **Fast URL Redirection**: Cached at the edge for <100ms response times
✅ **Global Distribution**: Uses Cloudflare's worldwide data centers
✅ **Analytics**: Real-time tracking of clicks, referrers, and geographic data
✅ **Rate Limiting**: Prevents abuse with configurable per-IP limits
✅ **Custom Aliases**: Support for vanity URLs
✅ **URL Expiration**: Optional TTL for temporary short codes
✅ **High Performance**: Sub-millisecond lookups with KV caching
✅ **Security**: HTTPS only, API key support, CORS enabled 

## Setup Instructions

### Prerequisites

- Node.js 18+
- npm or yarn
- Cloudflare account with Workers enabled
- Wrangler CLI installed globally

```bash
npm install -g wrangler
```

### Installation

1. **Clone and install dependencies**

```bash
cd url_shortner
npm install
```

2. **Configure Wrangler**

Edit `wrangler.toml`:
- Replace `your-kv-namespace-id` with your actual KV namespace ID
- Replace `your-zone-id` with your Cloudflare zone ID
- Update domain in routes (replace `short.example.com`)

3. **Create KV Namespaces**

Use the installed Wrangler CLI:

```bash
wrangler kv:namespace create "URL_STORE"
wrangler kv:namespace create "URL_STORE" --preview
wrangler kv:namespace create "RATE_LIMIT_KV"
wrangler kv:namespace create "RATE_LIMIT_KV" --preview
```

Or via npx (no global Wrangler install needed):

```bash
npx wrangler kv:namespace create URL_STORE
npx wrangler kv:namespace create URL_STORE --preview
npx wrangler kv:namespace create RATE_LIMIT_KV
npx wrangler kv:namespace create RATE_LIMIT_KV --preview
```

4. **Set Environment Variables** (optional)

Create `.env.production` and `.env.development`:

```env
API_KEY=your-secret-api-key
RATE_LIMIT_ENABLED=true
```

5. **Run Locally**

```bash
npm run dev
```

The worker will run at `http://localhost:8787`

6. **Deploy to Cloudflare**

```bash
npm run deploy

# Or with specific environment
wrangler publish --env production
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
- `expiresIn` (optional): Milliseconds until expiration

**Response (201):**
```json
{
  "shortCode": "abc123",
  "shortUrl": "https://short.example.com/abc123",
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

**Cache:** 1 minute

### Delete Shortened URL

**Endpoint:** `DELETE /:code`

**Headers:**
```
Authorization: Bearer your-secret-api-key
```

**Response:**
```json
{
  "success": true,
  "message": "URL deleted successfully"
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
3. **Result**: <10ms response times for 99% of requests globally

### KV Naming Convention

```
{shortCode}              → ShortenedURL object
alias:{customAlias}      → Stores shortCode for reverse lookup
ratelimit:{ip}:minute    → Per-minute counter (60s TTL)
ratelimit:{ip}:hour      → Per-hour counter (3600s TTL)
```

## Security Implementation

### Rate Limiting

**Create endpoint (write-heavy):**
- 30 requests/minute per IP
- Prevents rapid-fire URL creation attacks

**Redirect endpoint (read-heavy):**
- 1000 requests/hour per IP
- Prevents enumeration attacks

**Headers returned:**
```
RateLimit-Limit: 30
RateLimit-Remaining: 27
RateLimit-Reset: 1700000060
```

### API Key Protection

Optional API key for sensitive operations (DELETE):

```typescript
// Add to wrangler.toml env vars
API_KEY = "your-secret-key"
```

Usage:
```bash
curl -H "Authorization: Bearer your-secret-key" \
  -X DELETE https://short.example.com/abc123
```

### CORS & Security Headers

- Cross-Origin Requests enabled with proper CORS headers
- All responses include `Content-Type: application/json`
- Error messages are informative but not sensitive

## Durable Objects Deep Dive

### Why Durable Objects for Analytics?

**Traditional approach (Workers KV only):**
- Limited transaction support
- Hard to maintain counters reliably
- Race conditions on frequently accessed URLs

**Durable Objects solution:**
- Single instance per short code
- Serialized writes (no race conditions)
- Persistent storage with durability guarantees
- Real-time in-memory state for hot URLs

### Analytics Data Structure

```typescript
interface AnalyticsData {
  shortCode: string;           // Unique identifier
  redirectCount: number;       // Total clicks
  lastAccessedAt: number;      // Timestamp of last access
  referrers: Record<string, number>;    // Domain referrer counts
  countries: Record<string, number>;    // Geographic distribution
  userAgents: Record<string, number>;   // Browser/client breakdown
}
```

### Recording Analytics

When a redirect occurs:
1. Worker sends analytics event to Durable Object
2. Durable Object increments counters atomically
3. Data persists in Durable Object's storage
4. Minimal impact on redirect latency (<1ms)

## Deployment Scenarios

### Development
```bash
npm run dev
# Access at http://localhost:8787
```

### Staging
```bash
wrangler publish --env development
# Tests full Cloudflare services without affecting production
```

### Production
```bash
wrangler publish --env production
# Live on your custom domain
```

## Environment Variables

Create `.env.production.local` for sensitive data:

```env
API_KEY=sk_prod_xxxxxxxxxxxx
RATE_LIMIT_ENABLED=true
CUSTOM_DOMAIN=short.mycompany.com
```

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

## Scaling Considerations

### KV Performance
- **Reads**: ~1ms globally (geographically distributed)
- **Writes**: ~5-10ms (replicated globally)
- **Consistency**: Eventually consistent (usually <500ms)
- **Capacity**: Up to 1KB per key (short URLs fit easily)

### Durable Objects
- **State**: Up to 128MB per object
- **Throughput**: ~1000 ops/second per object instance
- **Cost**: ~$0.15/million requests + storage

### Practical Limits

For typical production use:
- **URLs**: Unlimited (millions in KV)
- **QPS**: >100,000 requests/second (edge distributed)
- **Analytics**: Real-time with minimal latency impact

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

### Analytics not appearing
- Ensure Durable Objects binding is configured in `wrangler.toml`
- Check Durable Objects migration is applied
- Verify `ANALYTICS` namespace is created

### Cache not working
- Check `Cache-Control` headers returned from CF Dashboard
- Verify `s-maxage` directive for edge cache
- Clear cache via CF Dashboard if needed

## Testing

```bash
# Type checking
npm run type-check

# Linting
npm run lint

# Format code
npm run format
```

## Production Best Practices

1. **Set API_KEY** in `wrangler.toml` for DELETE operations
2. **Monitor analytics** via CF Dashboard
3. **Start with higher rate limits**, adjust based on metrics
4. **Enable geo-blocking** for specific regions if needed
5. **Regularly audit** created URLs for spam/abuse
6. **Set up alerts** for spike in error rates

## Cost Estimate (AWS pricing equivalent)

| Component | Cloudflare | AWS |
|-----------|-----------|-----|
| 1M API calls/day | $0.50 | $2.50+ |
| 100M page views/day | Included* | $5.00+ |
| Edge caching | Global | $0.50+ |
| Analytics DB | Included | $1.00+ |

*Cloudflare Workers Scale pricing tier

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Workers KV](https://developers.cloudflare.com/workers/platform/storage/kv/)
- [Durable Objects](https://developers.cloudflare.com/workers/platform/durable-objects/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Rate Limiting Strategies](https://developers.cloudflare.com/fundamentals/get-started/concepts/ddos-protection/)

## License

MIT
