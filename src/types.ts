// Types for URL shortener
export interface ShortenedURL {
  id: string;
  originalUrl: string;
  createdAt: number;
  expiresAt?: number;
  customAlias?: string;
  userId?: string;
}

export interface CreateURLRequest {
  url: string;
  customAlias?: string;
  expiresIn?: number; // milliseconds
}

export interface CreateURLResponse {
  shortCode: string;
  shortUrl: string;
  originalUrl: string;
  createdAt: number;
  expiresAt?: number;
}

export interface AnalyticsData {
  shortCode: string;
  redirectCount: number;
  lastAccessedAt: number;
  referrers: Record<string, number>;
  countries: Record<string, number>;
  userAgents: Record<string, number>;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerHour: number;
  ipBased: boolean;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

// Environment types
export interface Env {
  URL_STORE: KVNamespace;
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_ENABLED?: string;
  ANALYTICS: DurableObjectNamespace;
}
