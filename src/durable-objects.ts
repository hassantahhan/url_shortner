import { AnalyticsData } from './types';

export class AnalyticsObject {
  private state: DurableObjectState;
  private env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
  }

  /**
   * Initialize or load existing analytics data
   */
  private async initializeData(shortCode: string): Promise<AnalyticsData> {
    const stored = await this.state.storage.get(`analytics:${shortCode}`);
    
    if (stored) {
      return stored as AnalyticsData;
    }

    return {
      shortCode,
      redirectCount: 0,
      lastAccessedAt: Date.now(),
      referrers: {},
      countries: {},
      userAgents: {}
    };
  }

  /**
   * Record a redirect access
   */
  async recordRedirect(request: {
    shortCode: string;
    referrer?: string;
    country?: string;
    userAgent?: string;
  }): Promise<void> {
    const data = await this.initializeData(request.shortCode);

    data.redirectCount++;
    data.lastAccessedAt = Date.now();

    // Track referrer
    if (request.referrer) {
      data.referrers[request.referrer] = (data.referrers[request.referrer] || 0) + 1;
    }

    // Track country
    if (request.country) {
      data.countries[request.country] = (data.countries[request.country] || 0) + 1;
    }

    // Track user agent
    if (request.userAgent) {
      // Simplified UA tracking
      const browserName = this.extractBrowserName(request.userAgent);
      data.userAgents[browserName] = (data.userAgents[browserName] || 0) + 1;
    }

    await this.state.storage.put(`analytics:${request.shortCode}`, data);
  }

  /**
   * Get analytics for a short code
   */
  async getAnalytics(shortCode: string): Promise<AnalyticsData | null> {
    const data = await this.state.storage.get(`analytics:${shortCode}`);
    return data ? (data as AnalyticsData) : null;
  }

  /**
   * Get top referrers for a short code
   */
  async getTopReferrers(shortCode: string, limit: number = 10): Promise<Array<[string, number]>> {
    const data = await this.getAnalytics(shortCode);
    if (!data) return [];

    return Object.entries(data.referrers)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  /**
   * Get geographic distribution
   */
  async getGeographicDistribution(shortCode: string): Promise<Record<string, number>> {
    const data = await this.getAnalytics(shortCode);
    return data?.countries || {};
  }

  /**
   * Clear analytics for a short code
   */
  async clearAnalytics(shortCode: string): Promise<void> {
    await this.state.storage.delete(`analytics:${shortCode}`);
  }

  /**
   * Extract browser name from user agent
   */
  private extractBrowserName(ua: string): string {
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    if (ua.includes('Opera')) return 'Opera';
    return 'Other';
  }

  /**
   * Handle requests to this Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const shortCode = url.searchParams.get('code');

    if (!shortCode) {
      return new Response('Missing code parameter', { status: 400 });
    }

    switch (request.method) {
      case 'GET':
        const endpoint = url.pathname.split('/').pop();
        if (endpoint === 'analytics') {
          const analytics = await this.getAnalytics(shortCode);
          return new Response(JSON.stringify(analytics), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (endpoint === 'referrers') {
          const limit = parseInt(url.searchParams.get('limit') || '10');
          const referrers = await this.getTopReferrers(shortCode, limit);
          return new Response(JSON.stringify(referrers), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (endpoint === 'geography') {
          const geo = await this.getGeographicDistribution(shortCode);
          return new Response(JSON.stringify(geo), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        break;

      case 'POST':
        if (url.pathname.includes('record')) {
          const body = await request.json() as any;
          await this.recordRedirect({
            shortCode,
            referrer: body.referrer,
            country: body.country,
            userAgent: body.userAgent
          });
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        break;

      case 'DELETE':
        await this.clearAnalytics(shortCode);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Not Found', { status: 404 });
  }
}
