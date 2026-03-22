#!/usr/bin/env node

/**
 * Example Test Cases & Usage Scripts
 * Run these tests against a local or deployed instance
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
const API_KEY = process.env.API_KEY || 'test-key';

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

// Test HTTP client
async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: data ? JSON.parse(data) : null
  };
}

// Test suites
const tests = {
  /**
   * Test 1: Health Check
   */
  async testHealthCheck() {
    log('\n=== Test 1: Health Check ===', 'blue');
    const response = await request('GET', '/health');
    
    if (response.status === 200 && response.body.status === 'ok') {
      log('✓ Health check passed', 'green');
      return true;
    } else {
      log('✗ Health check failed', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 2: Create Shortened URL (Random)
   */
  async testCreateShortURL() {
    log('\n=== Test 2: Create Shortened URL ===', 'blue');
    const testURL = 'https://github.com/cloudflare/workers';
    
    const response = await request('POST', '/shorten', { url: testURL });
    
    if (response.status === 201 && response.body.shortCode) {
      log(`✓ Created short URL: ${response.body.shortUrl}`, 'green');
      this.shortCode = response.body.shortCode;
      return true;
    } else {
      log('✗ Failed to create short URL', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 3: Create Shortened URL with Custom Alias
   */
  async testCreateCustomAlias() {
    log('\n=== Test 3: Create with Custom Alias ===', 'blue');
    const alias = `test-${Date.now()}`;
    
    const response = await request('POST', '/shorten', {
      url: 'https://www.cloudflare.com',
      customAlias: alias
    });
    
    if (response.status === 201 && response.body.shortCode === alias) {
      log(`✓ Created custom alias: ${response.body.shortUrl}`, 'green');
      this.customAlias = alias;
      return true;
    } else {
      log('✗ Failed to create custom alias', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 4: Duplicate Alias Prevention
   */
  async testDuplicateAlias() {
    log('\n=== Test 4: Duplicate Alias Prevention ===', 'blue');
    
    const response = await request('POST', '/shorten', {
      url: 'https://twitter.com',
      customAlias: this.customAlias
    });
    
    if (response.status === 409) {
      log('✓ Correctly rejected duplicate alias', 'green');
      return true;
    } else {
      log('✗ Should have rejected duplicate alias', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 5: Get URL Info
   */
  async testGetURLInfo() {
    log('\n=== Test 5: Get URL Info ===', 'blue');
    
    const response = await request('GET', `/${this.shortCode}/info`);
    
    if (response.status === 200 && response.body.id === this.shortCode) {
      log(`✓ Retrieved URL info: ${response.body.originalUrl}`, 'green');
      return true;
    } else {
      log('✗ Failed to get URL info', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 6: Redirect (301)
   */
  async testRedirect() {
    log('\n=== Test 6: Redirect (301) ===', 'blue');
    
    const url = `${BASE_URL}/${this.shortCode}`;
    const response = await fetch(url, { redirect: 'manual' });
    
    if (response.status === 301) {
      log(`✓ Redirect successful (301)`, 'green');
      log(`  Location: ${response.headers.get('location')}`, 'gray');
      return true;
    } else {
      log(`✗ Expected 301, got ${response.status}`, 'red');
      return false;
    }
  },

  /**
   * Test 7: Get Analytics
   */
  async testGetAnalytics() {
    log('\n=== Test 7: Get Analytics ===', 'blue');
    
    const response = await request('GET', `/${this.shortCode}/analytics`);
    
    if (response.status === 200 && response.body.shortCode) {
      log(`✓ Retrieved analytics`, 'green');
      log(`  Redirects: ${response.body.redirectCount}`, 'gray');
      return true;
    } else {
      log('✗ Failed to get analytics', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 8: Invalid URL
   */
  async testInvalidURL() {
    log('\n=== Test 8: URL Validation ===', 'blue');
    
    const response = await request('POST', '/shorten', {
      url: 'not-a-valid-url'
    });
    
    if (response.status === 400 && response.body.message.includes('Invalid')) {
      log('✓ Correctly rejected invalid URL', 'green');
      return true;
    } else {
      log('✗ Should have rejected invalid URL', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 9: Missing URL Parameter
   */
  async testMissingURL() {
    log('\n=== Test 9: Missing URL Parameter ===', 'blue');
    
    const response = await request('POST', '/shorten', {});
    
    if (response.status === 400) {
      log('✓ Correctly rejected missing URL', 'green');
      return true;
    } else {
      log('✗ Should have rejected missing URL', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 10: 404 Not Found
   */
  async testNotFound() {
    log('\n=== Test 10: 404 Not Found ===', 'blue');
    
    const response = await request('GET', '/nonexistent');
    
    if (response.status === 404) {
      log('✓ Correctly returned 404', 'green');
      return true;
    } else {
      log('✗ Should have returned 404', 'red');
      log(JSON.stringify(response.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 11: Rate Limiting
   */
  async testRateLimiting() {
    log('\n=== Test 11: Rate Limiting ===', 'blue');
    log('  Creating 31 URLs rapidly to trigger rate limit...', 'gray');
    
    let rateLimited = false;
    for (let i = 0; i < 35; i++) {
      const response = await request('POST', '/shorten', {
        url: `https://example.com/test-${i}`
      });
      
      if (response.status === 429) {
        log(`✓ Rate limited after ${i} requests`, 'green');
        log(`  Headers: ${JSON.stringify({
          limit: response.headers.get('RateLimit-Limit'),
          remaining: response.headers.get('RateLimit-Remaining'),
          reset: response.headers.get('RateLimit-Reset')
        })}`, 'gray');
        rateLimited = true;
        break;
      }
    }
    
    if (!rateLimited) {
      log('✗ Rate limiting did not trigger as expected', 'yellow');
      return false;
    }
    
    return true;
  },

  /**
   * Test 12: URL Expiration
   */
  async testURLExpiration() {
    log('\n=== Test 12: URL Expiration ===', 'blue');
    
    // Create URL that expires in 2 seconds
    const response = await request('POST', '/shorten', {
      url: 'https://example.com/expires',
      expiresIn: 2000
    });
    
    if (response.status === 201) {
      const code = response.body.shortCode;
      log(`✓ Created expiring URL: ${code}`, 'green');
      log('  Waiting 3 seconds for expiration...', 'gray');
      
      await new Promise(r => setTimeout(r, 3000));
      
      const expiredResponse = await request('GET', `/${code}/info`);
      if (expiredResponse.status === 410) {
        log('✓ URL correctly expired', 'green');
        return true;
      } else {
        log('✗ URL should have expired', 'red');
        return false;
      }
    } else {
      log('✗ Failed to create expiring URL', 'red');
      return false;
    }
  },

  /**
   * Test 13: Delete URL (with auth)
   */
  async testDeleteURL() {
    log('\n=== Test 13: Delete URL ===', 'blue');
    
    // Create a URL to delete
    const createResponse = await request('POST', '/shorten', {
      url: 'https://example.com/to-delete'
    });
    
    if (createResponse.status !== 201) {
      log('✗ Failed to create URL for deletion', 'red');
      return false;
    }
    
    const code = createResponse.body.shortCode;
    
    // Delete it
    const deleteResponse = await request(
      'DELETE',
      `/${code}`,
      null,
      { 'Authorization': `Bearer ${API_KEY}` }
    );
    
    if (deleteResponse.status === 200) {
      log(`✓ Successfully deleted URL: ${code}`, 'green');
      return true;
    } else {
      log('✗ Failed to delete URL', 'red');
      log(JSON.stringify(deleteResponse.body, null, 2), 'gray');
      return false;
    }
  },

  /**
   * Test 14: CORS Headers
   */
  async testCORSHeaders() {
    log('\n=== Test 14: CORS Headers ===', 'blue');
    
    const url = `${BASE_URL}/health`;
    const response = await fetch(url);
    
    const corsOrigin = response.headers.get('Access-Control-Allow-Origin');
    const corsMethods = response.headers.get('Access-Control-Allow-Methods');
    
    if (corsOrigin && corsMethods) {
      log('✓ CORS headers present', 'green');
      log(`  Origin: ${corsOrigin}`, 'gray');
      log(`  Methods: ${corsMethods}`, 'gray');
      return true;
    } else {
      log('✗ Missing CORS headers', 'red');
      return false;
    }
  }
};

/**
 * Run all tests
 */
async function runAllTests() {
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║   URL Shortener Test Suite            ║', 'blue');
  log('╚════════════════════════════════════════╝', 'blue');
  log(`Base URL: ${BASE_URL}\n`, 'gray');

  const results = [];
  const testNames = Object.keys(tests).filter(k => k.startsWith('test'));

  for (const testName of testNames) {
    try {
      const result = await tests[testName].call(tests);
      results.push({ name: testName, passed: result });
    } catch (error) {
      log(`✗ ${testName} threw error: ${error.message}`, 'red');
      results.push({ name: testName, passed: false });
    }
  }

  // Summary
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║   Test Summary                         ║', 'blue');
  log('╚════════════════════════════════════════╝', 'blue');

  const passed = results.filter(r => r.passed).length;
  const total = results.length;

  results.forEach(r => {
    const icon = r.passed ? '✓' : '✗';
    const color = r.passed ? 'green' : 'red';
    log(`${icon} ${r.name}`, color);
  });

  log(`\nTotal: ${passed}/${total} tests passed`, passed === total ? 'green' : 'red');
}

runAllTests().catch(error => {
  log(`Fatal error: ${error.message}`, 'red');
  process.exit(1);
});
