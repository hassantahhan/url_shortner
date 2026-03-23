import { ShortenedURL, CreateURLRequest, CreateURLResponse } from './types';

export class KVStorage {
  // Default TTL: 30 days in milliseconds
  private DEFAULT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 2,592,000,000 ms

  constructor(private kv: KVNamespace) {}

  /**
   * Generate a short code (base62 encoded random value)
   */
  private generateShortCode(length: number = 6): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  /**
   * Check if a short code already exists
   */
  async codeExists(code: string): Promise<boolean> {
    const existing = await this.kv.get(code);
    return existing !== null;
  }

  /**
   * Create a new shortened URL entry
   */
  async createURL(request: CreateURLRequest): Promise<CreateURLResponse> {
    let shortCode: string;

    if (request.customAlias) {
      shortCode = request.customAlias;
      if (await this.codeExists(shortCode)) {
        throw new Error('Custom alias already exists');
      }
    } else {
      let attempts = 0;
      const maxAttempts = 10;

      // Generate unique short code
      do {
        shortCode = this.generateShortCode();
        attempts++;
      } while (await this.codeExists(shortCode) && attempts < maxAttempts);

      if (attempts >= maxAttempts) {
        throw new Error('Failed to generate unique short code');
      }
    }

    const now = Date.now();
    // Use provided expiration or default to 30 days
    const expirationMs = request.expiresIn || this.DEFAULT_EXPIRATION_MS;
    
    const urlEntry: ShortenedURL = {
      id: shortCode,
      originalUrl: request.url,
      customAlias: request.customAlias,
      createdAt: now,
      expiresAt: now + expirationMs,
      userId: undefined
    };

    // KV requires expiration_ttl >= 60s. Keep logical expiration in expiresAt.
    const options: KVNamespacePutOptions = {
      expirationTtl: Math.max(60, Math.ceil(expirationMs / 1000))
    };

    await this.kv.put(shortCode, JSON.stringify(urlEntry), options);

    // Store reverse mapping for custom aliases with same expiration
    if (request.customAlias) {
      await this.kv.put(`alias:${request.customAlias}`, shortCode, options);
    }

    return {
      shortCode,
      shortUrl: `https://short.example.com/${shortCode}`,
      originalUrl: request.url,
      createdAt: now,
      expiresAt: urlEntry.expiresAt
    };
  }

  /**
   * Retrieve URL by short code
   */
  async getURL(code: string): Promise<ShortenedURL | null> {
    const data = await this.kv.get(code, 'json');
    if (!data) {
      return null;
    }
    return data as ShortenedURL;
  }

  /**
   * Retrieve URL by custom alias
   */
  async getURLByAlias(alias: string): Promise<ShortenedURL | null> {
    const code = await this.kv.get(`alias:${alias}`);
    if (!code) {
      return null;
    }
    return this.getURL(code);
  }

  /**
   * Delete a shortened URL entry
   */
  async deleteURL(code: string): Promise<boolean> {
    const urlEntry = await this.getURL(code);
    if (!urlEntry) {
      return false;
    }

    // Clean up alias mapping if exists
    if (urlEntry.customAlias) {
      await this.kv.delete(`alias:${urlEntry.customAlias}`);
    }

    await this.kv.delete(code);
    return true;
  }

  /**
   * Update URL metadata (without changing the target)
   */
  async updateURL(code: string, updates: Partial<ShortenedURL>): Promise<ShortenedURL | null> {
    const existing = await this.getURL(code);
    if (!existing) {
      return null;
    }

    const updated: ShortenedURL = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      originalUrl: existing.originalUrl // Prevent URL change
    };

    await this.kv.put(code, JSON.stringify(updated));
    return updated;
  }

  /**
   * Check if URL is expired
   */
  isExpired(url: ShortenedURL): boolean {
    if (!url.expiresAt) {
      return false;
    }
    return Date.now() > url.expiresAt;
  }
}
