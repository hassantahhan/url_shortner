# Production Deployment Guide

Complete guide for deploying the URL Shortener to production with best practices.

## Pre-Deployment Checklist

### Code Readiness
- [ ] All tests passing (`npm run test` or manual testing)
- [ ] TypeScript compilation successful (`npm run type-check`)
- [ ] Code formatted (`npm run format`)
- [ ] No console.errors or warnings in logs
- [ ] All dependencies updated (`npm update`)

### Infrastructure Readiness
- [ ] Cloudflare account with Workers enabled
- [ ] Custom domain registered and added to Cloudflare
- [ ] Zone ID obtained from Cloudflare Dashboard
- [ ] KV namespaces created for URL_STORE and RATE_LIMIT_KV
- [ ] Durable Objects available on your plan

### Security Readiness
- [ ] API_KEY environment variable set
- [ ] HTTPS enabled (Cloudflare default)
- [ ] Rate limiting configured appropriately
- [ ] CORS policy reviewed
- [ ] Secrets not committed to Git

### Capacity Planning
- [ ] Expected request volume calculated
- [ ] Rate limits adjusted for expected traffic
- [ ] Monitoring alerts configured
- [ ] Backup/recovery plan documented
- [ ] Cost estimates reviewed

## Deployment Steps

### Step 1: Final Pre-Deployment Validation

```bash
# Clean installation
rm -rf node_modules package-lock.json
npm install

# Type check
npm run type-check

# Build
npm run build

# Test locally
npm run dev &
sleep 2
node test-examples.js
kill %1
```

All tests should pass before proceeding.

### Step 2: Staging Deployment

Deploy to staging environment first:

```bash
wrangler publish --env development
```

Verify staging works:

```bash
# Replace with your staging URL
STAGING_URL="https://url-shortener-dev.worker-username.workers.dev"

# Health check
curl $STAGING_URL/health

# Create test URL
curl -X POST $STAGING_URL/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com"}'

# Run full test suite against staging
BASE_URL=$STAGING_URL node test-examples.js
```

Common staging issues:
- 404 errors → Check worker deployment
- KV errors → Verify namespace bindings
- Analytics errors → Durable Objects not initialized

### Step 3: Verify Cloudflare Configuration

```bash
# List deployments
wrangler deployments list

# Tail logs
wrangler tail --env development
```

Check dashboard for:
- Workers analytics
- Error rates
- Execution time
- Success rate

### Step 4: Production Deployment

When staging is fully tested:

```bash
# Deploy to production
wrangler publish --env production

# Verify it's live
curl https://short.yourdomain.com/health
```

### Step 5: Post-Deployment Validation

```bash
# Test all endpoints
curl https://short.yourdomain.com/health
curl -X POST https://short.yourdomain.com/shorten \
  -d '{"url":"https://github.com"}'

# Check logs
wrangler tail --env production

# Verify analytics
# Create test URL and visit it several times
# Then check analytics endpoint
```

## Monitoring Setup

### Cloudflare Dashboard Metrics

Navigate to **Workers** → **Your Worker** → **Analytics**

Monitor:
- **Requests**: Total & per endpoint
- **Errors**: 4xx, 5xx rates
- **Latency**: P50, P95, P99
- **Success Rate**: Target >99.9%

### Setting Up Alerts

Via Cloudflare Dashboard:
1. Go to **Notifications** → **Create**
2. Select **Workers** → **Your Worker**
3. Configure triggers:
   - Error rate >1%
   - Response time >100ms
   - Failed deployments

### Log Collection

```bash
# Real-time logs
wrangler tail --env production --format json

# Save logs to file
wrangler tail --env production > logs.txt &

# Format JSON logs
wrangler tail --env production --format json | jq .
```

Filter by type:
```bash
# Errors only
wrangler tail --env production --status error

# Show structured logs
wrangler tail --env production --format json | \
  jq 'select(.outcome == "error")'
```

## Performance Optimization

### Cache Hit Rate

Target: >95% cache hit rate for redirects

```bash
# Check cache headers
curl -i https://short.yourdomain.com/shortcode | grep -i cache
curl -i https://short.yourdomain.com/shortcode | grep -i "x-cache"
```

If cache hit rate is low:
- Verify `Cache-Control` headers in code
- Check Cloudflare page rules aren't conflicting
- Ensure cache purge isn't too aggressive

### KV Performance

KV should have <1ms read latency:

```bash
# Use Cloudflare Analytics for KV metrics
# Dashboard → Workers → Analytics → KV
```

If slow:
- Check for large values (should be ~300B)
- Verify regional KV replication
- Review batch operation patterns

### Durable Objects Performance

Analytics should add <1ms latency:

```bash
# Monitor in logs
wrangler tail --env production | jq '.outcome, .cpu_time'
```

If slow:
- Check Durable Object state size
- Review serialization patterns
- Consider batch analytics sync

## Rate Limiting Tuning

Adjust based on real traffic:

```bash
# Current settings in src/rate-limiter.ts
requestsPerMinute: 30     // Creates per minute
requestsPerHour: 1000     // Reads per hour
```

Monitor via:
1. Wrangler logs (count of 429 responses)
2. Analytics dashboard
3. User complaints/feedback

**Adjustment strategy:**

- Too many 429 errors? → Increase limits
- Spam/abuse detected? → Decrease limits
- DDos attacks? → Enable Cloudflare Shield

## Security Hardening

### API Key Rotation

```bash
# Generate new key
NEW_KEY=$(openssl rand -hex 32)

# Update in wrangler.toml
# [env.production]
# vars = { API_KEY = "sk_prod_$NEW_KEY" }

wrangler publish --env production
```

### IP Allowlisting (Optional)

For admin operations only:

```typescript
// In src/index.ts
const ALLOWED_IPS = ['1.2.3.4', '5.6.7.8'];

if (!ALLOWED_IPS.includes(clientIP)) {
  return createErrorResponse('Unauthorized IP', 401);
}
```

### URL Validation

Current validation:
- Must be valid HTTP/HTTPS URL
- Max length ~2KB

Consider adding:
- Blacklist (spam domains)
- Whitelist (internal domains only)
- Content scanning (malware detection)

### Monitoring Security

```bash
# Check for suspicious patterns
wrangler tail --env production --format json | \
  jq 'select(.statusCode == 400) | .request'

# Monitor rate limit hits
wrangler tail --env production --format json | \
  jq 'select(.statusCode == 429) | {ip, timestamp}'
```

## Disaster Recovery

### Backup Strategy

KV automatically replicates globally. Durable Objects persist in storage.

**Manual backups:**

```bash
# Export all URLs from KV
npx wrangler kv:key list --namespace-id YOUR_ID > urls-backup.json

# Periodic backups (daily)
0 2 * * * /path/to/backup.sh
```

### Restoration Procedure

If data is corrupted:

```bash
# 1. Create new KV namespace
wrangler kv:namespace create "URL_STORE_BACKUP"

# 2. Import previous data
cat urls-backup.json | jq '.[]' | while read line; do
  KEY=$(echo $line | jq -r '.name')
  VALUE=$(echo $line | jq -r '.value')
  wrangler kv:key put --namespace-id NEW_ID "$KEY" "$VALUE"
done

# 3. Update wrangler.toml to point to recovered namespace
# 4. Redeploy
wrangler publish --env production
```

### Rollback Procedure

If deployment causes issues:

```bash
# Option 1: Redeploy previous version
git checkout <previous-commit>
wrangler publish --env production

# Option 2: Use Cloudflare deployment history
# Dashboard → Workers → Deployments → Rollback

# Option 3: Temporary traffic redirect
# Cloudflare → Page Rules → Redirect to backup
```

## Scaling for High Traffic

### When to Scale

- Request volume approaching Workers rate limits
- KV response time increasing
- Durable Objects CPU time increasing
- Cache hit rate declining

### Scaling Strategies

#### 1. Geographic Scaling (Workers)
Workers already run on 200+ edge locations.
No action needed—automatic.

#### 2. Rate Limit Adjustment
```typescript
// Increase limits for expected load
requestsPerMinute: 100      // Was 30
requestsPerHour: 5000       // Was 1000
```

#### 3. Caching Optimization
```typescript
// Extend cache TTL if staleness acceptable
'Cache-Control': 'public, max-age=604800, s-maxage=2592000' // 30 days edge
```

#### 4. Durable Objects Distribution
For >100K analytics per second:
```toml
[[durable_objects.bindings]]
name = "ANALYTICS"
class_name = "AnalyticsObject"
script_name = "url-shortener"
environment = "production"
```

#### 5. Plan Upgrade
- Workers Unlimited: 100,000 requests/day → unlimited
- Durable Objects: Pay-per-use pricing for high volume
- KV: Scales automatically

## Cost Optimization

### Current Stack Cost Estimate

| Component | Monthly (1M URLs) |
|-----------|------------------|
| Workers | $5 (Workers Unlimited) |
| KV | $0.50 (storage) + reads |
| Durable Objects | $0.25 |
| Domain | $10-30 |
| **Total** | **~$15-35** |

### Cost Reduction

1. **Longer cache TTL**
   - Reduces KV reads
   - Trade-off: Slight staleness

2. **Batch operations**
   - Reduce API calls
   - ~10% savings

3. **Cleanup old URLs**
   - Remove expired entries
   - Reduce storage costs

4. **Analytics sampling**
   - Record 1-in-N events
   - Save Durable Objects cost

## Maintenance Windows

### Scheduled Maintenance

**When:** Off-peak hours (e.g., 3-4 AM UTC)

```bash
# 1. Announce maintenance window
# Send email to users

# 2. Deploy update
wrangler publish --env production

# 3. Test thoroughly
node test-examples.js

# 4. Monitor for 30 minutes
wrangler tail --env production

# 5. Announce completion
```

### Zero-Downtime Updates

Workers allows rolling deploys:

```bash
# Deploy (old and new versions coexist momentarily)
wrangler publish --env production

# No downtime - requests routed automatically
```

## Documentation Maintenance

Keep your deployment docs updated:

- [ ] Update runbooks after changes
- [ ] Document any customizations
- [ ] Record any incidents and resolutions
- [ ] Update capacity planning as traffic grows
- [ ] Review costs quarterly

## Incident Response

### High Error Rate (>5%)

```bash
# 1. Check logs
wrangler tail --env production --status error

# 2. Identify pattern
# - All endpoints or specific path?
# - All regions or specific?
# - Recent deployment correlation?

# 3. Potential fixes
# - Rollback deployment
# - Adjust rate limits
# - Clear Durable Objects state

# 4. Communicate
# - Update status page
# - Email affected users
# - Post-incident review
```

### High Latency (>500ms)

```bash
# Check Worker execution time
wrangler tail --env production --format json | \
  jq '.cpu_time'

# Likely causes
# - KV overloaded (check Cloudflare dashboard)
# - Durable Objects bottleneck (state too large)
# - External API calls in code

# Solutions
# - Increase cache TTL
# - Batch Durable Object operations
# - Optimize code
```

### DNS/Domain Issues

```bash
# Verify DNS resolution
dig short.yourdomain.com
nslookup short.yourdomain.com

# Check Cloudflare configuration
# Dashboard → DNS → Verify records

# Verify worker route
# Dashboard → Workers → Routes
```

## Launching to Users

### Soft Launch (Beta)

1. Deploy to custom URL
2. Share with limited beta users
3. Collect feedback
4. Monitor metrics

### General Availability

1. Announce feature
2. Gradually increase traffic
3. Monitor error rates
4. Be ready to scale

### Promotional Campaign

Before big marketing push:
- Load test (thousands of URLs created)
- Verify rate limiting
- Check cache hit rates
- Monitor cost impact

## Maintenance Checklist (Monthly)

- [ ] Review error logs and performance metrics
- [ ] Update dependencies if needed
- [ ] Verify backups are working
- [ ] Check Cloudflare bill
- [ ] Review rate limit effectiveness
- [ ] Analyze popular URLs/patterns
- [ ] Update documentation
- [ ] Security vulnerability scan

---

**For questions on deployment specifics, see:**
- [GETTING_STARTED.md](./GETTING_STARTED.md) - Initial setup
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Design details
- [API_DOCS.md](./API_DOCS.md) - API reference
