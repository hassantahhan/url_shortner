import { Router } from 'itty-router';
import { Env, CreateURLRequest, ErrorResponse } from './types';
import { KVStorage } from './kv-storage';
import { RateLimiter } from './rate-limiter';
import { AnalyticsObject } from './durable-objects';

// Create router
const router = Router();

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
function addCORSHeaders(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

/**
 * POST /shorten - Create a new shortened URL
 */
router.post('/shorten', async (request: Request, env: Env) => {
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
router.get('/:code', async (request: Request, env: Env) => {
  const { code } = request.params as { code: string };
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
router.get('/:code/info', async (request: Request, env: Env) => {
  const { code } = request.params as { code: string };

  try {
    const storage = new KVStorage(env.URL_STORE);
    const urlEntry = await storage.getURL(code);

    if (!urlEntry) {
      return createErrorResponse('Short URL not found', 404);
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
router.get('/:code/analytics', async (request: Request, env: Env) => {
  const { code } = request.params as { code: string };

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
 * DELETE /:code - Delete a short URL
 */
router.delete('/:code', async (request: Request, env: Env) => {
  const { code } = request.params as { code: string };
  const authHeader = request.headers.get('Authorization');

  // Optional: Verify API key
  if (env.API_KEY && authHeader !== `Bearer ${env.API_KEY}`) {
    return createErrorResponse('Unauthorized', 401);
  }

  try {
    const storage = new KVStorage(env.URL_STORE);
    const deleted = await storage.deleteURL(code);

    if (!deleted) {
      return createErrorResponse('Short URL not found', 404);
    }

    return new Response(JSON.stringify({ success: true, message: 'URL deleted successfully' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting URL:', error);
    return createErrorResponse('Internal server error', 500);
  }
});

/**
 * OPTIONS - Handle CORS preflight
 */
router.options('*', () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
});

/**
 * Health check endpoint
 */
router.get('/health', () => {
  return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});

/**
 * 404 Handler
 */
router.all('*', () => {
  return createErrorResponse('Endpoint not found', 404);
});

/**
 * Main handler
 */
export default {
  fetch: (request: Request, env: Env) => {
    const response = router.handle(request, env);
    return Promise.resolve(response).then(addCORSHeaders);
  }
};

// Export Durable Object
export { AnalyticsObject };
