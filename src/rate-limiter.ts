import { RateLimitConfig } from './types';

export class RateLimiter {
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = {
    requestsPerMinute: 60,
    requestsPerHour: 1000,
    ipBased: true
  }) {
    this.config = config;
  }

  /**
   * Generate a rate limit key based on IP or user
   */
  private getKey(ip: string, type: 'minute' | 'hour'): string {
    const timestamp = type === 'minute' 
      ? Math.floor(Date.now() / 60000) 
      : Math.floor(Date.now() / 3600000);
    return `ratelimit:${ip}:${type}:${timestamp}`;
  }

  /**
   * Check if request should be allowed
   */
  async checkLimit(
    kv: KVNamespace,
    ip: string,
    requestType: 'create' | 'redirect' = 'redirect'
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
  }> {
    if (!this.config.ipBased) {
      return { allowed: true, remaining: -1, resetTime: 0 };
    }

    // Different limits for writes vs reads
    const limit = requestType === 'create' 
      ? this.config.requestsPerMinute 
      : this.config.requestsPerHour;

    const minuteKey = this.getKey(ip, 'minute');
    const hourKey = this.getKey(ip, 'hour');

    // Get current counts
    const minuteCountStr = await kv.get(minuteKey);
    const hourCountStr = await kv.get(hourKey);

    const minuteCount = parseInt(minuteCountStr || '0') + 1;
    const hourCount = parseInt(hourCountStr || '0') + 1;

    // Set new counts with TTL
    await Promise.all([
      kv.put(minuteKey, minuteCount.toString(), { expirationTtl: 60 }),
      kv.put(hourKey, hourCount.toString(), { expirationTtl: 3600 })
    ]);

    // Check against limits
    const minuteKey_real = this.getKey(ip, 'minute');
    const resetTime = Math.ceil((Date.now() + 60000) / 1000);

    if (requestType === 'create' && minuteCount > limit) {
      return {
        allowed: false,
        remaining: Math.max(0, limit - minuteCount),
        resetTime
      };
    }

    if (requestType === 'redirect' && hourCount > limit) {
      return {
        allowed: false,
        remaining: Math.max(0, limit - hourCount),
        resetTime: Math.ceil((Date.now() + 3600000) / 1000)
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - minuteCount),
      resetTime
    };
  }

  /**
   * Create rate limit response headers
   */
  createHeaders(remaining: number, resetTime: number): Record<string, string> {
    return {
      'RateLimit-Limit': this.config.requestsPerMinute.toString(),
      'RateLimit-Remaining': remaining.toString(),
      'RateLimit-Reset': resetTime.toString()
    };
  }
}
