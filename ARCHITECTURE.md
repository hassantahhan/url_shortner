# Architecture and System Design

This document explains how the URL shortener works as a system. It is written for developers who need to understand request flow, storage boundaries, business rules, and the implementation tradeoffs behind the current design.

## What This Service Is

The service exposes a small public API that does four things:

1. Create a short code for a long URL.
2. Resolve a short code into an HTTP redirect.
3. Return metadata about a short code without redirecting.
4. Return aggregate analytics for that short code.

At runtime, the service is a Cloudflare Worker backed by two state systems:

- Workers KV stores URL records and rate-limit counters.
- A Durable Object stores analytics counters for each short code.

The design intentionally splits read-heavy URL lookups from write-sensitive analytics updates:

- URL lookups must be cheap and globally fast, so they live in KV.
- Analytics increments must not lose counts under concurrency, so they live in a Durable Object.

## Mental Model

Think of the system as three layers:

```text
Client
  -> Cloudflare Worker (routing, validation, response shaping)
       -> Workers KV (URL records, expiration metadata, rate-limit counters)
       -> Durable Object (serialized analytics updates per short code)
```

The Worker owns the application behavior. KV and Durable Objects are storage and coordination primitives used by the Worker to enforce that behavior.

## Runtime Components

### 1. Edge Worker

File: `src/index.ts`

The Worker is the application entry point. It uses Hono for route matching, but the business logic is still explicit in the route handlers.

Core responsibilities:

- Parse the incoming request.
- Extract client metadata such as IP, country, referrer, and user agent.
- Validate request payloads.
- Enforce create-rate limiting.
- Read and write URL state through `KVStorage`.
- Forward analytics operations to the `AnalyticsObject` Durable Object.
- Shape HTTP semantics: status codes, redirects, cache headers, and error payloads.

The Worker also applies permissive CORS headers to all routes and exposes a small demo UI at `/demo`.

### 2. KVStorage Abstraction

File: `src/kv-storage.ts`

`KVStorage` is a thin repository layer over Workers KV. It centralizes how URL records are created, retrieved, updated, deleted, and expired.

Responsibilities:

- Generate random short codes when the client does not supply one.
- Persist `ShortenedURL` records.
- Encode expiration twice:
  - platform TTL through `expirationTtl`
  - application-level expiration through `expiresAt`
- Delete alias metadata when a short code is deleted.
- Prevent mutation of the original target URL in `updateURL`.

This class is where most persistent URL business rules should live if the project grows.

### 3. Analytics Durable Object

File: `src/durable-objects.ts`

The Durable Object provides a single serialized execution context per short code. That matters because analytics are increment-heavy writes and would be prone to lost updates in KV alone.

Responsibilities:

- Initialize analytics state on first access.
- Increment redirect counters.
- Aggregate referrer, country, and browser counts.
- Return analytics views for the Worker.
- Persist analytics in Durable Object storage under `analytics:{shortCode}`.

This object is not used for routing or redirect resolution. It is dedicated to analytics.

### 4. Rate Limiter

File: `src/rate-limiter.ts`

The `RateLimiter` uses KV counters to cap traffic from a single IP.

Current behavior:

- `POST /shorten` is rate-limited.
- The configured create limit is 30 requests per minute per IP.
- Redirect traffic is not currently rate-limited by route handlers, even though the helper supports an hourly mode.

This distinction is important: the codebase contains generic rate-limit logic, but only create requests actually enforce it today.

## Data Model

### URL Record

Stored in Workers KV under key `{shortCode}`.

```json
{
  "id": "abc123",
  "originalUrl": "https://example.com/path",
  "createdAt": 1700000000000,
  "expiresAt": 1702592000000,
  "customAlias": "marketing-landing"
}
```

Fields with business meaning:

- `id`: canonical short code used in routes.
- `originalUrl`: redirect target.
- `createdAt`: creation timestamp in Unix milliseconds.
- `expiresAt`: logical expiration checked by the Worker on reads.
- `customAlias`: present when the user supplied the code instead of using a generated one.

### Analytics Record

Stored in Durable Object storage under key `analytics:{shortCode}`.

```json
{
  "shortCode": "abc123",
  "redirectCount": 1250,
  "lastAccessedAt": 1700050000000,
  "referrers": {
    "https://twitter.com": 450
  },
  "countries": {
    "US": 600
  },
  "userAgents": {
    "Chrome": 700
  }
}
```

The analytics data is aggregate-only. There is no event log and no per-click identity persisted.

### Rate-Limit Counters

Stored in Workers KV under time-bucketed keys:

- `ratelimit:{ip}:minute:{bucket}`
- `ratelimit:{ip}:hour:{bucket}`

These keys expire automatically using KV TTL.

## End-to-End Request Flows

### 1. Create Flow: `POST /shorten`

This is the write path where most validation logic lives.

```text
Request
  -> extract client IP
  -> check per-IP create rate limit
  -> parse JSON body
  -> validate url exists
  -> validate url is syntactically valid
  -> validate customAlias format if present
  -> check alias collision
  -> create URL record in KV
  -> return 201 response with shortCode and timestamps
```

Business rules enforced here:

- `url` is required.
- `url` must parse as a valid URL.
- `customAlias`, if supplied, must match `^[a-zA-Z0-9_-]{3,20}$`.
- Create requests are limited to 30 per minute per IP.
- If `expiresIn` is omitted, the default is 30 days.
- If the caller supplies `customAlias`, that alias becomes the actual short code.
- If the system generates a short code, it retries up to 10 times to avoid collisions.

Important implementation details:

- Expiration is enforced logically through `expiresAt`, not only by KV TTL.
- KV still requires a minimum TTL of 60 seconds, so the system stores very short expirations in metadata and lets the Worker reject them after they expire.
- The response currently returns `https://short.example.com/{shortCode}` as `shortUrl`. That is a static host string from the storage layer, not a dynamically derived host.

### 2. Redirect Flow: `GET /:code`

This is the main read path and the one most sensitive to latency.

```text
Request
  -> lookup short code in KV
  -> if not found, return 404
  -> if expired, delete record and return 410
  -> send analytics increment to Durable Object
  -> return 301 redirect with cache headers
```

Business rules enforced here:

- A missing short code returns `404`.
- An expired short code returns `410` and is deleted from KV on access.
- Redirects use `301 Moved Permanently`.
- Redirect responses are cacheable for 1 day in the browser and 7 days at the edge.

What happens under the hood:

- The Worker reads the URL record from KV.
- If the record is expired according to `expiresAt`, the Worker deletes it immediately.
- The Worker then makes an internal request to the analytics Durable Object using the short code as the Durable Object name.
- If analytics recording fails, the redirect still succeeds. Analytics failures are treated as non-fatal.

That last point is deliberate: redirect correctness is prioritized over analytics completeness.

### 3. Metadata Flow: `GET /:code/info`

This is a read-only inspection endpoint.

```text
Request
  -> lookup short code in KV
  -> if missing, return 404
  -> if expired, delete record and return 410
  -> return stored metadata as JSON
```

Business rules:

- It uses the same expiration behavior as redirects.
- It does not record analytics.
- It is cacheable for 1 hour.

This endpoint is useful for dashboards, debugging, and admin tools because it returns the persisted URL record without following the redirect.

### 4. Analytics Flow: `GET /:code/analytics`

This is a mixed read path:

```text
Request
  -> verify short code exists in KV
  -> resolve Durable Object by code
  -> request analytics snapshot from Durable Object
  -> return aggregate analytics JSON
```

Business rules:

- Analytics are only returned for an existing short code.
- The response is cached for 60 seconds.
- Analytics are aggregate counts, not raw event records.

The Worker validates the code in KV first so analytics are not served for orphaned or unknown codes.

## Under-the-Hood Business Logic

### Code Generation Strategy

Random codes use a base62-like alphabet:

```text
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

Default length is 6, which gives a large key space while keeping URLs short. Collisions are handled by retrying up to 10 times.

The business implication is simple:

- generated links optimize for brevity
- custom aliases optimize for readability and campaign-specific naming

### Custom Alias Behavior

When `customAlias` is provided:

- the alias itself is used as the short code
- the record is stored under that alias key in KV
- a second KV entry `alias:{customAlias}` is also written

Today, public routes do not use the reverse alias lookup helper. In practice, the alias works because it is already the main key. The extra alias mapping exists as supporting metadata and could enable future lookup patterns, but it is not currently required for route resolution.

### Expiration Model

Expiration is enforced in two layers:

1. KV TTL removes old entries eventually.
2. The Worker checks `expiresAt` on every read and treats stale entries as expired immediately.

That means business expiration is precise even if physical deletion in KV is delayed.

When an expired record is accessed:

- the Worker deletes the code from KV
- the caller receives `410 Gone`

This makes expiration an active rule in request handling, not just a background storage property.

### Analytics Aggregation Rules

Each redirect attempt records:

- total redirect count
- last accessed timestamp
- raw referrer header value if present
- Cloudflare country header if present
- simplified browser family derived from user agent

The browser bucketing is intentionally coarse:

- Chrome
- Firefox
- Safari
- Edge
- Opera
- Other

This keeps the analytics model lightweight and avoids storing high-cardinality full user-agent strings.

### Failure-Tolerance Rules

The service distinguishes core path failures from secondary path failures.

Core failures:

- malformed create request
- missing code
- expired code
- KV read or write failure on the primary path

Secondary failures:

- analytics recording failure during redirect

Core failures change the API result. Secondary failures are logged and ignored so the redirect path stays available.

## Storage and Consistency Tradeoffs

### Why URL Records Are in KV

KV is a good fit because redirect resolution is read-heavy and globally distributed.

Expected pattern:

- relatively few creates
- many more redirects
- occasional metadata and analytics reads

KV gives cheap, global reads and works well with cacheable redirect responses.

### Why Analytics Are Not in KV Alone

Analytics are increment-based writes. If two requests read the same old value and both write back an incremented value, one increment is lost.

The Durable Object avoids that by serializing operations for a given short code.

### Why Rate Limiting Uses KV

Rate-limit counters do not need perfect cross-region transactional guarantees for this use case. They only need cheap bucketed counters with automatic expiry. KV is sufficient for that level of enforcement.

## Caching Model

The system relies on HTTP caching rather than a custom cache implementation.

### Redirect Responses

- Browser cache: 1 day via `max-age=86400`
- Shared edge cache: 7 days via `s-maxage=604800`

This is safe because URL targets are immutable in the current system. There is no public endpoint that edits a destination after creation.

### Metadata Responses

- Cache TTL: 1 hour

### Analytics Responses

- Cache TTL: 60 seconds

Analytics are intentionally less aggressive because they change on every redirect.

## Security and Abuse Controls

### Public API Surface

All current endpoints are unauthenticated.

- `GET /health`
- `GET /demo`
- `POST /shorten`
- `GET /:code`
- `GET /:code/info`
- `GET /:code/analytics`

This makes rate limiting the primary built-in abuse control at the application layer.

### Rate-Limit Semantics

The create flow uses per-IP counters.

- Limit: 30 requests per minute
- Storage: KV with 60-second TTL buckets
- Response on limit breach: `429 Too Many Requests`
- Headers returned: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`

One implementation detail developers should know: when a create request exceeds the limit, the current code resets the minute bucket after detecting the breach. That is convenient for local testing but weakens strict rate-limit enforcement semantics.

## Deployment Model

Environment config is defined in `wrangler.toml`.

Bindings:

- `URL_STORE`: KV namespace for URL records
- `RATE_LIMIT_KV`: KV namespace for rate-limit counters
- `ANALYTICS`: Durable Object namespace for analytics

There are separate `development` and `production` environments. The production config expects a custom domain route for `short.example.com`.

## What A Developer Should Know Before Changing This System

1. Redirect correctness is the primary product requirement. Do not let analytics or secondary features break redirect success.
2. Expiration is enforced in application logic, not only by KV TTL.
3. URL records are effectively immutable after creation from a business perspective.
4. Custom aliases are not a second-class feature; they become the canonical route key.
5. Analytics are aggregate counters, not raw event history.
6. The current host in `shortUrl` responses is hardcoded and may need environment-aware generation if this service is deployed under multiple domains.
7. Only create requests are actively rate-limited today.
8. If you add features like delete, edit, ownership, or auth, you will need to revisit cache invalidation, authorization boundaries, and the current assumption that redirects are safe to cache for days.

## Likely Extension Points

The current architecture leaves room for the following future changes:

- authentication and ownership for private link management
- custom domain support with dynamic host generation
- richer analytics dimensions
- admin delete or deactivate endpoints
- mutable destination URLs with cache purge strategy
- stronger anti-abuse controls for redirect scraping or analytics harvesting

If those features are added, the biggest design changes will likely be around cache invalidation, authorization, and whether KV remains the right store for all URL metadata.
