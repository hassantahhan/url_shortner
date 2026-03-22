# API Documentation

Complete REST API reference for the URL Shortener service.

## Base URL

```
https://short.example.com
http://localhost:8787 (local development)
```

## Authentication

Most endpoints are public. Protected endpoints require an API key:

```
Authorization: Bearer your-api-key
```

Set `API_KEY` in environment variables for protected operations.

---

## Endpoints

### 1. Create Shortened URL

Create a new shortened URL with optional custom alias and expiration.

**Endpoint:**
```
POST /shorten
```

**Request Headers:**
```
Content-Type: application/json
```

**Request Body:**
```json
{
  "url": "https://example.com/very/long/path",
  "customAlias": "mylink",
  "expiresIn": 86400000
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | ✅ Yes | Full URL to shorten (must be valid HTTP/HTTPS) |
| customAlias | string | ❌ No | Custom short code (3-20 chars, alphanumeric + `-_`) |
| expiresIn | number | ❌ No | Milliseconds until URL expires (optional, permanent if omitted) |

**Response (201 Created):**
```json
{
  "shortCode": "abc123",
  "shortUrl": "https://short.example.com/abc123",
  "originalUrl": "https://example.com/very/long/path",
  "createdAt": 1700000000000,
  "expiresAt": 1700086400000
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Missing required field: url | URL parameter missing |
| 400 | Invalid URL format | URL is malformed |
| 400 | Custom alias must be 3-20 characters... | Alias format invalid |
| 409 | Custom alias already taken | Alias exists (try another) |
| 429 | Rate limit exceeded | Too many requests (30/min per IP) |
| 500 | Internal server error | Server error (retry) |

**Examples:**

```bash
# Basic URL shortening
curl -X POST https://short.example.com/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/cloudflare/workers"
  }'

# With custom alias
curl -X POST https://short.example.com/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://github.com/cloudflare/workers",
    "customAlias": "cf-workers"
  }'

# With 24-hour expiration
curl -X POST https://short.example.com/shorten \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/report",
    "expiresIn": 86400000
  }'
```

---

### 2. Redirect to Original URL

Redirect to the original URL. Returns HTTP 301 (Moved Permanently) for search engine optimization.

**Endpoint:**
```
GET /:code
```

**Parameters:**
| Field | Type | Location | Required |
|-------|------|----------|----------|
| code | string | Path | ✅ Yes |

**Response (301 Moved Permanently):**
```
Location: https://original-url.com
Cache-Control: public, max-age=86400, s-maxage=604800
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Short URL not found | Code doesn't exist |
| 410 | Short URL has expired | URL TTL exceeded |

**Cache Headers:**
- `max-age=86400`: Browser caches 1 day
- `s-maxage=604800`: Edge caches 7 days

**Examples:**

```bash
# Redirect (follow with -L flag to see final destination)
curl -i https://short.example.com/abc123

# Output:
# HTTP/1.1 301 Moved Permanently
# Location: https://github.com/cloudflare/workers
# Cache-Control: public, max-age=86400, s-maxage=604800

# Visit in browser
open https://short.example.com/abc123
```

---

### 3. Get URL Information

Get metadata about a shortened URL without redirecting.

**Endpoint:**
```
GET /:code/info
```

**Parameters:**
| Field | Type | Location | Required |
|-------|------|----------|----------|
| code | string | Path | ✅ Yes |

**Response (200 OK):**
```json
{
  "id": "abc123",
  "originalUrl": "https://github.com/cloudflare/workers",
  "createdAt": 1700000000000,
  "expiresAt": null,
  "customAlias": null,
  "userId": null
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Short URL not found | Code doesn't exist |

**Cache:**
- Cached for 1 hour at edge
- `Cache-Control: public, max-age=3600`

**Examples:**

```bash
# Get info about a short URL
curl https://short.example.com/abc123/info

# Get info by custom alias (requires lookup)
curl https://short.example.com/cf-workers/info
```

---

### 4. Get Analytics

Get click statistics and traffic analytics for a shortened URL.

**Endpoint:**
```
GET /:code/analytics
```

**Parameters:**
| Field | Type | Location | Required |
|-------|------|----------|----------|
| code | string | Path | ✅ Yes |

**Response (200 OK):**
```json
{
  "shortCode": "abc123",
  "redirectCount": 1250,
  "lastAccessedAt": 1700050000000,
  "referrers": {
    "twitter.com": 450,
    "facebook.com": 380,
    "direct": 200,
    "github.com": 220
  },
  "countries": {
    "US": 600,
    "GB": 300,
    "FR": 200,
    "DE": 150
  },
  "userAgents": {
    "Chrome": 700,
    "Safari": 350,
    "Firefox": 150,
    "Edge": 50
  }
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| shortCode | string | The short code |
| redirectCount | number | Total number of redirects |
| lastAccessedAt | number | Timestamp of last access (Unix ms) |
| referrers | object | Traffic source breakdown |
| countries | object | Geographic distribution (country codes) |
| userAgents | object | Browser/client breakdown |

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Short URL not found | Code doesn't exist |

**Cache:**
- Cached for 1 minute at edge
- `Cache-Control: public, max-age=60`

**Examples:**

```bash
# Get full analytics
curl https://short.example.com/abc123/analytics

# Parse with jq for specific data
curl https://short.example.com/abc123/analytics | jq '.countries'
# Output:
# {
#   "US": 600,
#   "GB": 300,
#   "FR": 200
# }

# Get referrer breakdown
curl https://short.example.com/abc123/analytics | jq '.referrers'
```

---

### 5. Delete Shortened URL

Delete a shortened URL (requires API key).

**Endpoint:**
```
DELETE /:code
```

**Request Headers:**
```
Authorization: Bearer your-api-key
```

**Parameters:**
| Field | Type | Location | Required |
|-------|------|----------|----------|
| code | string | Path | ✅ Yes |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "URL deleted successfully"
}
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 401 | Unauthorized | Missing or invalid API key |
| 404 | Short URL not found | Code doesn't exist |

**Examples:**

```bash
# Delete a short URL
curl -X DELETE https://short.example.com/abc123 \
  -H "Authorization: Bearer your-api-key"

# Delete by custom alias
curl -X DELETE https://short.example.com/cf-workers \
  -H "Authorization: Bearer your-api-key"

# Check response
# {"success": true, "message": "URL deleted successfully"}
```

---

### 6. Health Check

Health check endpoint for monitoring.

**Endpoint:**
```
GET /health
```

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": 1700000000000
}
```

**Cache:** No cache

**Examples:**

```bash
# Simple health check
curl https://short.example.com/health

# With monitoring (ping every 30 seconds)
watch -n 30 curl https://short.example.com/health
```

---

## Rate Limiting

Rate limiting is enforced per IP address.

### Limits by Endpoint

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| POST /shorten | 30 | 1 minute | Prevent spam creation |
| GET /:code | 1000 | 1 hour | Prevent enumeration |
| Other GET | 100 | 1 minute | Standard |

### Rate Limit Headers

Every response includes rate limit information:

```
RateLimit-Limit: 30                 (total allowed)
RateLimit-Remaining: 27             (remaining in window)
RateLimit-Reset: 1700000060         (Unix timestamp when resets)
```

### Handling Rate Limits

When you exceed the limit, you'll receive a 429 response:

```json
{
  "error": "429",
  "message": "Rate limit exceeded. Too many requests.",
  "statusCode": 429
}
```

**Response headers:**
```
RateLimit-Limit: 30
RateLimit-Remaining: 0
RateLimit-Reset: 1700000060
```

**Retry strategy:**
```javascript
// Exponential backoff retry
async function createWithRetry(url, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        'https://short.example.com/shorten',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        }
      );

      if (response.status === 429) {
        const resetTime = parseInt(
          response.headers.get('RateLimit-Reset') || '0'
        );
        const delay = Math.max(0, resetTime * 1000 - Date.now());
        console.log(`Rate limited. Retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      return await response.json();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      const backoff = Math.pow(2, attempt - 1) * 1000;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}
```

---

## Error Handling

All errors follow a consistent format:

**Error Response Format:**
```json
{
  "error": "400",
  "message": "Descriptive error message",
  "statusCode": 400
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK - Request succeeded |
| 201 | Created - Resource created |
| 301 | Moved Permanently - Redirect |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - API key required |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Alias already used |
| 410 | Gone - Resource expired |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error - Server error |

---

## CORS & Header Support

### CORS Headers

All responses include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### Useful Headers

**Request:**
```
User-Agent: Mozilla/5.0 ...     (for analytics)
Referer: https://twitter.com    (for referrer tracking)
```

**Response:**
```
Cache-Control: public, max-age=86400, s-maxage=604800
X-Frame-Options: SAMEORIGIN
Content-Type: application/json
```

---

## Pagination & Filtering

Currently not implemented. Future versions may include:

```
GET /analytics?limit=10&offset=0
GET /admin/urls?created_after=2024-01-01
```

---

## Webhooks & Events (Future)

Planned for future releases:
- POST webhooks on URL creation
- POST webhooks on URL redirect
- Email notifications on threshold events

---

## Code Examples

### JavaScript/Node.js

```javascript
// Create shortened URL
async function shortenURL(longURL) {
  const response = await fetch('https://short.example.com/shorten', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: longURL })
  });
  
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  
  return await response.json();
}

// Get analytics
async function getAnalytics(shortCode) {
  const response = await fetch(
    `https://short.example.com/${shortCode}/analytics`
  );
  
  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }
  
  return await response.json();
}

// Usage
const result = await shortenURL('https://github.com/cloudflare/workers');
console.log(`Short URL: ${result.shortUrl}`);

const analytics = await getAnalytics(result.shortCode);
console.log(`Clicks: ${analytics.redirectCount}`);
```

### Python

```python
import requests
import json

BASE_URL = "https://short.example.com"

def shorten_url(long_url, custom_alias=None, expires_in=None):
    """Create a shortened URL"""
    payload = {"url": long_url}
    if custom_alias:
        payload["customAlias"] = custom_alias
    if expires_in:
        payload["expiresIn"] = expires_in
    
    response = requests.post(
        f"{BASE_URL}/shorten",
        json=payload,
        headers={"Content-Type": "application/json"}
    )
    
    response.raise_for_status()
    return response.json()

def get_analytics(short_code):
    """Get analytics for a short URL"""
    response = requests.get(f"{BASE_URL}/{short_code}/analytics")
    response.raise_for_status()
    return response.json()

# Usage
result = shorten_url("https://github.com/cloudflare/workers")
print(f"Short URL: {result['shortUrl']}")

analytics = get_analytics(result["shortCode"])
print(f"Clicks: {analytics['redirectCount']}")
```

### cURL

```bash
# Create short URL
curl -X POST https://short.example.com/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/cloudflare/workers"}'

# Get analytics
curl https://short.example.com/abc123/analytics

# Delete (requires API key)
curl -X DELETE https://short.example.com/abc123 \
  -H "Authorization: Bearer sk_prod_xxx"
```

---

## changelog

### v1.0.0 (Initial Release)
- Create shortened URLs with optional custom aliases
- Redirect with global edge caching (7 days)
- Real-time analytics via Durable Objects
- Rate limiting per IP address
- Optional URL expiration
- API key support for admin operations

### Planned Features
- Batch operations
- Link customization (redirect codes, headers)
- Click webhooks
- Admin dashboard
- Custom analytics views
- Link password protection
