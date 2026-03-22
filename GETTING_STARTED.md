# Getting Started Guide

This guide walks you through setting up and deploying the URL Shortener service.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Cloudflare Setup](#cloudflare-setup)
4. [Deployment](#deployment)
5. [Testing](#testing)
6. [Troubleshooting](#troubleshooting)

## Prerequisites

Required:
- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm or yarn** - Included with Node.js
- **Git** - [Download](https://git-scm.com/)
- **Cloudflare Account** - [Sign up](https://dash.cloudflare.com/sign-up)

Optional but recommended:
- **VS Code** - [Download](https://code.visualstudio.com/)
- **Cloudflare CLI** - Will be installed via npm

## Local Development

### Step 1: Install Dependencies

```bash
cd url_shortner
npm install
```

This installs:
- `wrangler` - Cloudflare Workers CLI
- `typescript` - Type checking
- `itty-router` - Lightweight routing
- Dev dependencies for linting and formatting

### Step 2: Start Development Server

```bash
npm run dev
```

You'll see output like:
```
⛅ wrangler 3.20.0
⭐ Bundling worker...
✨ Building...
✨ Built successfully.
▲ [wrangler:2.0.0] Listening at http://localhost:8787
```

The worker is now running locally! Leave this terminal open.

### Step 3: Test in Another Terminal

Open a new terminal window and try the API:

```bash
# Health check
curl http://localhost:8787/health

# Create a short URL
curl -X POST http://localhost:8787/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'

# Expected response:
# {
#   "shortCode": "abc123",
#   "shortUrl": "http://localhost:8787/abc123",
#   "originalUrl": "https://github.com",
#   "createdAt": 1700000000000
# }
```

### Step 4: Visit Short URL

```bash
# This will show the redirect response
curl -i http://localhost:8787/abc123
```

Perfect! Your local instance is working.

## Cloudflare Setup

### Step 1: Authenticate with Cloudflare

```bash
wrangler login
```

This opens your browser to authenticate. After logging in, you'll see:

```
✅ Successfully logged in via OAuth.
```

### Step 2: Create KV Namespaces

You need to create storage for URLs and rate limiting:

```bash
# Create URL storage namespace
wrangler kv:namespace create "URL_STORE"
# Output: 📝 Created KV namespace with ID: abc123...

# Create preview version for development
wrangler kv:namespace create "URL_STORE" --preview
# Output: 📝 Created KV namespace with ID: xyz789...

# Create rate limiting namespace
wrangler kv:namespace create "RATE_LIMIT_KV"
wrangler kv:namespace create "RATE_LIMIT_KV" --preview
```

The output will copy/paste automatically into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "URL_STORE"
id = "abc123..."
preview_id = "xyz789..."
```

### Step 3: Update wrangler.toml

Edit `wrangler.toml` and update:

1. **Zone ID** (for custom domain):
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
   - Select your domain
   - Copy Zone ID from the right sidebar
   - Paste into `wrangler.toml`

2. **Custom Domain** (routes section):
   ```toml
   routes = [
     { pattern = "short.yourdomain.com/*", zone_id = "YOUR_ZONE_ID" }
   ]
   ```

3. **Environment Variables** (optional):
   ```toml
   [env.production]
   vars = { API_KEY = "sk_prod_your_secret_key" }
   ```

### Step 4: Setup Migration for Durable Objects

Durable Objects need to be initialized. Wrangler will handle this automatically on first deploy.

## Deployment

### Option A: Deploy to Staging

Test on Cloudflare before production:

```bash
wrangler publish --env development
```

The worker is now live at: `https://url-shortener-dev.your-username.workers.dev`

Test it:
```bash
curl https://url-shortener-dev.your-username.workers.dev/health
```

### Option B: Deploy to Production

Once tested and ready:

```bash
# Build (TypeScript compilation)
npm run build

# Publish to production
wrangler publish --env production
```

Or more simply:
```bash
npm run deploy
```

You'll see:
```
✨ Built successfully.
✨ Uploading...
✨ Uploaded successfully to https://short.yourdomain.com
```

### Verify Production Deployment

```bash
# Health check
curl https://short.yourdomain.com/health

# Create short URL
curl -X POST https://short.yourdomain.com/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'
```

## Testing

### Unit Testing

We recommend adding test cases. The basic test structure:

```bash
# View deployment logs
wrangler tail

# Real-time tail of current worker
wrangler tail --format json
```

### Integration Testing

```bash
# Run example test suite
node test-examples.js
```

Current tests:
- Health check
- Create shortened URL
- Create custom alias
- Prevent duplicate aliases
- Get URL info
- Test 301 redirect
- Analytics retrieval
- URL validation
- 404 handling
- Rate limiting
- URL expiration
- Delete URL
- CORS headers

### Manual cURL Tests

**Create:**
```bash
curl -X POST https://short.example.com/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/cloudflare/workers",
    "customAlias": "cf-workers",
    "expiresIn": 604800000
  }'
```

**Redirect:**
```bash
curl -L https://short.example.com/cf-workers
# Follows the redirect and shows github contents
```

**Analytics:**
```bash
curl https://short.example.com/cf-workers/analytics | jq .
```

**Delete:**
```bash
curl -X DELETE https://short.example.com/cf-workers \
  -H "Authorization: Bearer your-api-key"
```

## Troubleshooting

### Problem: `wrangler: command not found`

**Solution:** Install wrangler globally:
```bash
npm install -g wrangler
# or use npx
npx wrangler dev
```

### Problem: `No KV namespace ID found for binding`

**Solution:** Ensure `wrangler.toml` has the KV bindings:
```toml
[[kv_namespaces]]
binding = "URL_STORE"
id = "your-id-here"
preview_id = "your-preview-id-here"
```

Get IDs with:
```bash
wrangler kv:namespace list
```

### Problem: `Durable Objects not found`

**Solution:** The first deploy might fail. Just deploy again:
```bash
wrangler publish
```

Durable Objects are initialized on first use.

### Problem: `Rate limit even though I'm not hitting the limit`

**Solution:** Check IP detection. Localhost appears as `0.0.0.0` in development.

For deployed version, Cloudflare automatically sets `cf-connecting-ip` header.

### Problem: `CORS errors`

**Solution:** CORS is handled by the worker. Double-check that `Access-Control-Allow-Origin: *` is returned:

```bash
curl -i https://short.example.com/health
```

Should show CORS headers in response.

### Problem: `Cache not working`

**Solution:** Check HTTP cache headers:

```bash
curl -i https://short.example.com/shortcode | grep -i cache
# Should show:
# Cache-Control: public, max-age=86400, s-maxage=604800
```

If not cached, visit Cloudflare Dashboard → Caching Rules to verify rules are applied.

### Problem: Analytics not recording

**Solution:** Check Durable Objects:

```bash
# View logs
wrangler tail

# Look for Durable Object fetch calls
```

Ensure the analytics binding is configured (automatic after first deploy).

## Next Steps

After deployment:

1. **Test the API** using [API_DOCS.md](./API_DOCS.md)
2. **Monitor performance** via [Cloudflare Dashboard](https://dash.cloudflare.com)
3. **Review architecture** in [ARCHITECTURE.md](./ARCHITECTURE.md)
4. **Customize rate limits** in `src/rate-limiter.ts`
5. **Add authentication** by setting API_KEY in environment

## Environment Variables

### Production (.env.production or wrangler.toml vars)

```
API_KEY=sk_prod_your_secret_key
RATE_LIMIT_ENABLED=true
```

### Development (.env or .env.development)

```
API_KEY=sk_dev_test_key
RATE_LIMIT_ENABLED=false  # Disable for testing
```

## Deployment Checklist

Before going live:

- [ ] KV namespaces created and bound in `wrangler.toml`
- [ ] Custom domain configured (routes in `wrangler.toml`)
- [ ] Durable Objects binding added
- [ ] API_KEY set in production environment
- [ ] Rate limiting configured
- [ ] Testing completed successfully
- [ ] Cloudflare Dashboard monitoring setup
- [ ] Error alerts configured
- [ ] Analytics reviewed and working

## Performance Optimization Tips

1. **Edge Caching**
   - Short URLs cached for 7 days at edge
   - 99% cache hit rate typical
   - Delete operations purge edge cache automatically

2. **KV Optimization**
   - KV queries <1ms globally
   - Eventually consistent (usually <500ms)
   - Good for URL mappings (read-heavy)

3. **Durable Objects**
   - Real-time analytics collection
   - Minimal overhead (<1ms per request)
   - Serialized writes prevent race conditions

## Getting Help

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Wrangler Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Community Discord](https://discord.gg/cloudflaredev)
- [GitHub Issues](https://github.com/cloudflare/workers-sdk)

---

**That's it!** Your URL shortener is now deployed and running globally🚀

For API usage, see [API_DOCS.md](./API_DOCS.md)
For architecture details, see [ARCHITECTURE.md](./ARCHITECTURE.md)
