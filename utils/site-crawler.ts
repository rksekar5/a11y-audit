import { Page } from '@playwright/test';
import { AccessibilityAudit, A11yAuditResult } from './accessibility-audit';

export interface CrawlOptions {
  /** Starting URL(s) to crawl from */
  startUrls: string[];
  /** Maximum number of pages to audit */
  maxPages?: number;
  /** Use sitemap.xml for discovery (URL or boolean to auto-detect) */
  sitemap?: string | boolean;
  /** Follow links on discovered pages */
  followLinks?: boolean;
  /** URL pattern to stay within (regex). Defaults to same origin. */
  includePattern?: RegExp;
  /** URL patterns to exclude (regex array) */
  excludePatterns?: RegExp[];
  /** WCAG level for audits */
  wcagLevel?: 'A' | 'AA' | 'AAA';
  /** Include experimental checks */
  includeExperimental?: boolean;
  /** Delay between page audits (ms) */
  delayBetweenPages?: number;
  /** Timeout per page navigation (ms) */
  navigationTimeout?: number;
  /** Callback for progress updates */
  onProgress?: (status: CrawlProgress) => void;
}

export interface CrawlProgress {
  pagesDiscovered: number;
  pagesAudited: number;
  currentUrl: string;
  totalViolations: number;
}

export interface CrawlResult {
  startTime: string;
  endTime: string;
  durationMs: number;
  pagesAudited: number;
  pagesSkipped: string[];
  pageResults: A11yAuditResult[];
  summary: {
    totalViolations: number;
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    topIssues: { rule: string; count: number; impact: string }[];
    pagesWith0Issues: number;
  };
}

/**
 * Site crawler that discovers pages via sitemap.xml or link-following,
 * then runs the full accessibility audit on each discovered page.
 */
export class SiteCrawler {
  private page: Page;
  private discoveredUrls: Set<string> = new Set();
  private auditedUrls: Set<string> = new Set();
  private skippedUrls: string[] = [];

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Crawl and audit a site
   */
  async crawl(options: CrawlOptions): Promise<CrawlResult> {
    const startTime = Date.now();
    const maxPages = options.maxPages ?? 20;
    const followLinks = options.followLinks ?? true;
    const delay = options.delayBetweenPages ?? 1000;
    const navTimeout = options.navigationTimeout ?? 30000;

    // Step 1: Discover pages
    await this.discoverPages(options);

    // Step 2: Audit each page
    const results: A11yAuditResult[] = [];
    const urlsToAudit = Array.from(this.discoveredUrls).slice(0, maxPages);

    for (const url of urlsToAudit) {
      if (this.auditedUrls.has(url)) continue;

      try {
        options.onProgress?.({
          pagesDiscovered: this.discoveredUrls.size,
          pagesAudited: results.length,
          currentUrl: url,
          totalViolations: results.reduce((s, r) => s + r.totalViolations, 0),
        });

        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: navTimeout,
        });

        // Wait for page to settle
        await this.page.waitForTimeout(500);

        const audit = new AccessibilityAudit(this.page);
        const result = await audit.runFullAudit({
          wcagLevel: options.wcagLevel ?? 'AA',
          includeExperimental: options.includeExperimental ?? false,
        });

        results.push(result);
        this.auditedUrls.add(url);

        // Discover more links if following
        if (followLinks && this.discoveredUrls.size < maxPages) {
          await this.extractLinks(options);
        }

        // Delay between audits to avoid overwhelming the server
        if (delay > 0) {
          await this.page.waitForTimeout(delay);
        }
      } catch (error) {
        this.skippedUrls.push(url);
        this.auditedUrls.add(url);
      }
    }

    const endTime = Date.now();

    // Build summary
    const allViolations = results.flatMap(r => r.violations);
    const ruleCounts = new Map<string, { count: number; impact: string }>();
    for (const v of allViolations) {
      const existing = ruleCounts.get(v.rule);
      if (existing) {
        existing.count++;
      } else {
        ruleCounts.set(v.rule, { count: 1, impact: v.impact });
      }
    }

    const topIssues = Array.from(ruleCounts.entries())
      .map(([rule, { count, impact }]) => ({ rule, count, impact }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      pagesAudited: results.length,
      pagesSkipped: this.skippedUrls,
      pageResults: results,
      summary: {
        totalViolations: allViolations.length,
        critical: allViolations.filter(v => v.impact === 'critical').length,
        serious: allViolations.filter(v => v.impact === 'serious').length,
        moderate: allViolations.filter(v => v.impact === 'moderate').length,
        minor: allViolations.filter(v => v.impact === 'minor').length,
        topIssues,
        pagesWith0Issues: results.filter(r => r.totalViolations === 0).length,
      },
    };
  }

  /**
   * Discover pages from sitemap and/or start URLs
   */
  private async discoverPages(options: CrawlOptions) {
    // Add start URLs
    for (const url of options.startUrls) {
      this.discoveredUrls.add(this.normalizeUrl(url));
    }

    // Try sitemap discovery
    if (options.sitemap !== false) {
      const sitemapUrl = typeof options.sitemap === 'string'
        ? options.sitemap
        : this.guessSitemapUrl(options.startUrls[0]);

      if (sitemapUrl) {
        await this.parseSitemap(sitemapUrl, options);
      }
    }

    // Follow links from start pages
    if (options.followLinks !== false) {
      for (const url of options.startUrls) {
        try {
          await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeout ?? 30000 });
          await this.extractLinks(options);
        } catch {
          // Skip if page fails to load
        }
      }
    }
  }

  /**
   * Parse sitemap.xml (supports sitemap index files)
   */
  private async parseSitemap(sitemapUrl: string, options: CrawlOptions) {
    const maxPages = options.maxPages ?? 20;

    try {
      const response = await this.page.goto(sitemapUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      if (!response || response.status() !== 200) return;

      const content = await this.page.content();

      // Check if it's a sitemap index
      const sitemapIndexUrls = await this.page.evaluate(() => {
        const locs = document.querySelectorAll('sitemapindex sitemap loc');
        return Array.from(locs).map(el => el.textContent?.trim()).filter(Boolean) as string[];
      });

      if (sitemapIndexUrls.length > 0) {
        // Parse child sitemaps (limit to first 3 to avoid excessive crawling)
        for (const childUrl of sitemapIndexUrls.slice(0, 3)) {
          if (this.discoveredUrls.size >= maxPages) break;
          await this.parseSitemap(childUrl, options);
        }
        return;
      }

      // Parse regular sitemap
      const urls = await this.page.evaluate(() => {
        const locs = document.querySelectorAll('urlset url loc');
        return Array.from(locs).map(el => el.textContent?.trim()).filter(Boolean) as string[];
      });

      for (const url of urls) {
        if (this.discoveredUrls.size >= maxPages) break;
        if (this.matchesIncludePattern(url, options) && !this.matchesExcludePattern(url, options)) {
          this.discoveredUrls.add(this.normalizeUrl(url));
        }
      }
    } catch {
      // Sitemap not available, continue with link following
    }
  }

  /**
   * Extract links from the current page
   */
  private async extractLinks(options: CrawlOptions) {
    const maxPages = options.maxPages ?? 20;

    const links = await this.page.evaluate(() => {
      const anchors = document.querySelectorAll('a[href]');
      return Array.from(anchors)
        .map(a => {
          try {
            return new URL(a.getAttribute('href') || '', window.location.href).href;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as string[];
    });

    for (const link of links) {
      if (this.discoveredUrls.size >= maxPages) break;

      const normalized = this.normalizeUrl(link);
      if (
        !this.discoveredUrls.has(normalized) &&
        this.matchesIncludePattern(normalized, options) &&
        !this.matchesExcludePattern(normalized, options) &&
        !this.isNonPageUrl(normalized)
      ) {
        this.discoveredUrls.add(normalized);
      }
    }
  }

  private guessSitemapUrl(startUrl: string): string | null {
    try {
      const url = new URL(startUrl);
      return `${url.origin}/sitemap.xml`;
    } catch {
      return null;
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, hash, and common tracking params
      parsed.hash = '';
      parsed.searchParams.delete('utm_source');
      parsed.searchParams.delete('utm_medium');
      parsed.searchParams.delete('utm_campaign');
      let normalized = parsed.href;
      if (normalized.endsWith('/') && parsed.pathname !== '/') {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return url;
    }
  }

  private matchesIncludePattern(url: string, options: CrawlOptions): boolean {
    if (options.includePattern) {
      return options.includePattern.test(url);
    }
    // Default: same origin as first start URL
    try {
      const startOrigin = new URL(options.startUrls[0]).origin;
      return url.startsWith(startOrigin);
    } catch {
      return true;
    }
  }

  private matchesExcludePattern(url: string, options: CrawlOptions): boolean {
    if (!options.excludePatterns) return false;
    return options.excludePatterns.some(pattern => pattern.test(url));
  }

  private isNonPageUrl(url: string): boolean {
    const nonPageExtensions = /\.(pdf|zip|tar|gz|exe|dmg|pkg|deb|rpm|png|jpg|jpeg|gif|svg|webp|mp4|mp3|wav|avi|mov|css|js|json|xml|woff|woff2|ttf|eot)(\?.*)?$/i;
    return nonPageExtensions.test(url) || url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:');
  }
}

/**
 * Generate a comprehensive HTML report for a crawl result
 */
export function generateCrawlReport(result: CrawlResult): string {
  const impactColors: Record<string, string> = {
    critical: '#d32f2f',
    serious: '#f57c00',
    moderate: '#fbc02d',
    minor: '#1976d2',
  };

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Site Accessibility Crawl Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #fafafa; }
    h1 { color: #1a237e; }
    h2 { color: #283593; margin-top: 30px; }
    .meta { color: #666; margin-bottom: 20px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0; }
    .summary-card { padding: 15px; border-radius: 8px; text-align: center; color: white; }
    .page-card { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; background: white; }
    .page-card h3 { margin: 0 0 8px 0; font-size: 14px; }
    .page-card a { color: #1565c0; text-decoration: none; word-break: break-all; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 11px; font-weight: bold; margin: 2px; }
    .top-issues { background: white; border-radius: 8px; padding: 15px; margin: 15px 0; }
    .top-issues li { padding: 5px 0; font-size: 14px; }
    .page-score { font-size: 28px; font-weight: bold; }
    .stat { display: inline-block; margin-right: 12px; font-size: 13px; }
    .progress-bar { height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden; margin-top: 8px; }
    .progress-fill { height: 100%; transition: width 0.3s; }
  </style>
</head>
<body>
  <h1>Site Accessibility Crawl Report</h1>
  <div class="meta">
    <p><strong>Crawl Start:</strong> ${result.startTime}</p>
    <p><strong>Duration:</strong> ${(result.durationMs / 1000).toFixed(1)}s</p>
    <p><strong>Pages Audited:</strong> ${result.pagesAudited}</p>
    ${result.pagesSkipped.length > 0 ? `<p><strong>Pages Skipped:</strong> ${result.pagesSkipped.length}</p>` : ''}
  </div>

  <div class="summary">
    <div class="summary-card" style="background:#1a237e">
      <div class="page-score">${result.pagesAudited}</div>
      <div>Pages</div>
    </div>
    <div class="summary-card" style="background:${impactColors.critical}">
      <div class="page-score">${result.summary.critical}</div>
      <div>Critical</div>
    </div>
    <div class="summary-card" style="background:${impactColors.serious}">
      <div class="page-score">${result.summary.serious}</div>
      <div>Serious</div>
    </div>
    <div class="summary-card" style="background:${impactColors.moderate}">
      <div class="page-score">${result.summary.moderate}</div>
      <div>Moderate</div>
    </div>
    <div class="summary-card" style="background:${impactColors.minor}">
      <div class="page-score">${result.summary.minor}</div>
      <div>Minor</div>
    </div>
  </div>

  <h2>Top Issues Across All Pages</h2>
  <div class="top-issues">
    <ol>
      ${result.summary.topIssues.map(issue => `
        <li>
          <span class="badge" style="background:${impactColors[issue.impact] || '#666'}">${issue.impact.toUpperCase()}</span>
          <strong>${escapeHtml(issue.rule)}</strong> — ${issue.count} occurrence${issue.count > 1 ? 's' : ''}
        </li>
      `).join('')}
    </ol>
  </div>

  <h2>Per-Page Results</h2>
  ${result.pageResults.map(page => {
    const maxIssues = Math.max(...result.pageResults.map(p => p.totalViolations), 1);
    const severity = page.summary.critical > 0 ? 'critical' : page.summary.serious > 0 ? 'serious' : page.summary.moderate > 0 ? 'moderate' : 'minor';
    return `
    <div class="page-card">
      <h3><a href="${escapeHtml(page.url)}" target="_blank">${escapeHtml(page.url)}</a></h3>
      <span class="stat"><strong>${page.totalViolations}</strong> issues</span>
      <span class="badge" style="background:${impactColors.critical}">${page.summary.critical} critical</span>
      <span class="badge" style="background:${impactColors.serious}">${page.summary.serious} serious</span>
      <span class="badge" style="background:${impactColors.moderate}">${page.summary.moderate} moderate</span>
      <span class="badge" style="background:${impactColors.minor}">${page.summary.minor} minor</span>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${(page.totalViolations / maxIssues) * 100}%;background:${impactColors[severity]}"></div>
      </div>
    </div>`;
  }).join('')}
</body>
</html>`;

  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
