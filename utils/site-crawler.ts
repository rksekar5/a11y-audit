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
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#ca8a04',
    minor: '#2563eb',
  };

  const totalViolations = result.summary.totalViolations;
  const gateStatus = result.summary.critical === 0 && result.summary.serious === 0 ? 'passed' : 'failed';

  // Find worst page
  const worstPage = result.pageResults.length > 0
    ? result.pageResults.reduce((a, b) => a.totalViolations > b.totalViolations ? a : b)
    : null;
  const bestPage = result.pageResults.length > 0
    ? result.pageResults.reduce((a, b) => a.totalViolations < b.totalViolations ? a : b)
    : null;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Site Crawl Report — ${result.pagesAudited} Pages Audited</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-card: #1e293b;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --border: #334155;
      --accent: #6366f1;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --radius: 12px;
    }
    [data-theme="light"] {
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-card: #ffffff;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #94a3b8;
      --border: #e2e8f0;
      --accent: #4f46e5;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 24px;
      min-height: 100vh;
    }
    .container { max-width: 1400px; margin: 0 auto; }

    /* Header */
    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      margin-bottom: 32px; flex-wrap: wrap; gap: 16px;
    }
    .header h1 { font-size: 24px; font-weight: 700; color: var(--text-primary); }
    .header .meta { color: var(--text-secondary); font-size: 13px; margin-top: 4px; }
    .header .meta a { color: var(--accent); text-decoration: none; }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    .btn {
      padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--bg-secondary); color: var(--text-primary); font-size: 12px;
      cursor: pointer; transition: all 0.2s; font-weight: 500;
    }
    .btn:hover { border-color: var(--accent); background: var(--accent); color: white; }
    .theme-toggle { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; padding: 0; font-size: 16px; }

    /* Quality Gate Banner */
    .quality-gate {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 16px 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;
    }
    .quality-gate.passed { border-left: 4px solid var(--success); }
    .quality-gate.failed { border-left: 4px solid var(--danger); }
    .quality-gate .icon { font-size: 24px; }
    .quality-gate .label { font-weight: 600; font-size: 15px; }
    .quality-gate .detail { color: var(--text-secondary); font-size: 13px; }

    /* Summary Cards Row */
    .summary-row {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .summary-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 20px; text-align: center; position: relative; overflow: hidden;
    }
    .summary-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    }
    .summary-card.critical::before { background: ${impactColors.critical}; }
    .summary-card.serious::before { background: ${impactColors.serious}; }
    .summary-card.moderate::before { background: ${impactColors.moderate}; }
    .summary-card.minor::before { background: ${impactColors.minor}; }
    .summary-card.pages::before { background: var(--accent); }
    .summary-card .count { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
    .summary-card .label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }

    /* Charts Row */
    .charts-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;
    }
    @media (max-width: 768px) { .charts-row { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px;
    }
    .chart-card h3 { font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }

    /* Top Issues */
    .top-issues-section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px; margin-bottom: 24px;
    }
    .top-issues-section h3 { font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .top-issue-item {
      display: flex; align-items: center; gap: 12px; padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .top-issue-item:last-child { border-bottom: none; }
    .top-issue-rank { width: 28px; height: 28px; border-radius: 50%; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
    .top-issue-name { flex: 1; font-size: 13px; font-weight: 500; }
    .top-issue-count { font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .impact-badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; color: white;
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
    }

    /* Page Cards */
    .pages-section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      overflow: hidden; margin-bottom: 24px;
    }
    .pages-header {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .pages-header h3 { font-size: 15px; font-weight: 600; }
    .sort-btns { display: flex; gap: 6px; }
    .sort-btn {
      padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border);
      background: transparent; color: var(--text-secondary); font-size: 11px;
      cursor: pointer; transition: all 0.2s;
    }
    .sort-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .page-row {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      transition: background 0.15s; cursor: pointer;
    }
    .page-row:hover { background: var(--bg-primary); }
    .page-row:last-child { border-bottom: none; }
    .page-row-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 8px;
    }
    .page-url { font-size: 13px; font-weight: 500; color: var(--accent); text-decoration: none; word-break: break-all; flex: 1; }
    .page-url:hover { text-decoration: underline; }
    .page-total { font-size: 20px; font-weight: 700; min-width: 40px; text-align: right; }
    .page-badges { display: flex; gap: 6px; flex-wrap: wrap; }
    .page-badge {
      display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px;
      border-radius: 6px; font-size: 11px; font-weight: 600;
      background: var(--bg-primary); border: 1px solid var(--border);
    }
    .page-badge .dot { width: 8px; height: 8px; border-radius: 50%; }
    .progress-bar { height: 4px; background: var(--bg-primary); border-radius: 2px; overflow: hidden; margin-top: 10px; }
    .progress-fill { height: 100%; border-radius: 2px; transition: width 0.6s ease; }

    /* Skipped Pages */
    .skipped-section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px; margin-bottom: 24px;
    }
    .skipped-section h3 { font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .skipped-item { font-size: 12px; color: var(--text-muted); padding: 4px 0; word-break: break-all; }

    /* Footer */
    .footer {
      margin-top: 32px; text-align: center; color: var(--text-muted); font-size: 12px;
      padding: 16px; border-top: 1px solid var(--border);
    }
    .footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div>
        <h1>🕷️ Site Accessibility Crawl Report</h1>
        <div class="meta">
          ${result.pagesAudited} pages audited &nbsp;•&nbsp; ${(result.durationMs / 1000).toFixed(1)}s duration &nbsp;•&nbsp; ${result.startTime}
          ${result.pagesSkipped.length > 0 ? `&nbsp;•&nbsp; ${result.pagesSkipped.length} skipped` : ''}
        </div>
      </div>
      <div class="header-actions">
        <button class="btn" onclick="exportCSV()">📄 CSV</button>
        <button class="btn" onclick="exportJSON()">{ } JSON</button>
        <button class="btn theme-toggle" onclick="toggleTheme()" title="Toggle theme">🌓</button>
      </div>
    </div>

    <!-- Quality Gate -->
    <div class="quality-gate ${gateStatus}">
      <span class="icon">${gateStatus === 'passed' ? '✅' : '❌'}</span>
      <div>
        <div class="label">Quality Gate: ${gateStatus.toUpperCase()}</div>
        <div class="detail">${gateStatus === 'failed' ? (result.summary.critical + result.summary.serious) + ' critical/serious issue(s) must be resolved' : 'No critical or serious issues found'} • ${totalViolations} total violation${totalViolations !== 1 ? 's' : ''} across ${result.pagesAudited} page${result.pagesAudited !== 1 ? 's' : ''}</div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary-row">
      <div class="summary-card pages">
        <div class="count" style="color:var(--accent)">${result.pagesAudited}</div>
        <div class="label">Pages Audited</div>
      </div>
      <div class="summary-card critical">
        <div class="count" style="color:${impactColors.critical}">${result.summary.critical}</div>
        <div class="label">Critical</div>
      </div>
      <div class="summary-card serious">
        <div class="count" style="color:${impactColors.serious}">${result.summary.serious}</div>
        <div class="label">Serious</div>
      </div>
      <div class="summary-card moderate">
        <div class="count" style="color:${impactColors.moderate}">${result.summary.moderate}</div>
        <div class="label">Moderate</div>
      </div>
      <div class="summary-card minor">
        <div class="count" style="color:${impactColors.minor}">${result.summary.minor}</div>
        <div class="label">Minor</div>
      </div>
      <div class="summary-card">
        <div class="count" style="color:var(--text-primary)">${totalViolations}</div>
        <div class="label">Total Issues</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Severity Breakdown -->
      <div class="chart-card">
        <h3>Severity Distribution</h3>
        <canvas id="severityChart" style="max-height:220px"></canvas>
      </div>

      <!-- Issues Per Page -->
      <div class="chart-card">
        <h3>Issues Per Page</h3>
        <canvas id="pagesChart" style="max-height:220px"></canvas>
      </div>
    </div>

    <!-- Top Issues -->
    <div class="top-issues-section">
      <h3>Top Issues Across All Pages</h3>
      ${result.summary.topIssues.map((issue, i) => `
      <div class="top-issue-item">
        <span class="top-issue-rank">${i + 1}</span>
        <span class="impact-badge" style="background:${impactColors[issue.impact] || '#666'}">${issue.impact}</span>
        <span class="top-issue-name">${escapeHtml(issue.rule)}</span>
        <span class="top-issue-count">${issue.count}×</span>
      </div>`).join('')}
    </div>

    <!-- Per-Page Results -->
    <div class="pages-section">
      <div class="pages-header">
        <h3>Per-Page Results</h3>
        <div class="sort-btns">
          <button class="sort-btn active" onclick="sortPages('issues')">Most Issues</button>
          <button class="sort-btn" onclick="sortPages('alpha')">A–Z</button>
        </div>
      </div>
      ${result.pageResults
        .sort((a, b) => b.totalViolations - a.totalViolations)
        .map(page => {
          const maxIssues = Math.max(...result.pageResults.map(p => p.totalViolations), 1);
          const severity = page.summary.critical > 0 ? 'critical' : page.summary.serious > 0 ? 'serious' : page.summary.moderate > 0 ? 'moderate' : 'minor';
          return `
      <div class="page-row" data-url="${escapeHtml(page.url)}" data-issues="${page.totalViolations}">
        <div class="page-row-header">
          <a class="page-url" href="${escapeHtml(page.url)}" target="_blank">${escapeHtml(page.url)}</a>
          <span class="page-total" style="color:${impactColors[severity]}">${page.totalViolations}</span>
        </div>
        <div class="page-badges">
          ${page.summary.critical > 0 ? `<span class="page-badge"><span class="dot" style="background:${impactColors.critical}"></span>${page.summary.critical} critical</span>` : ''}
          ${page.summary.serious > 0 ? `<span class="page-badge"><span class="dot" style="background:${impactColors.serious}"></span>${page.summary.serious} serious</span>` : ''}
          ${page.summary.moderate > 0 ? `<span class="page-badge"><span class="dot" style="background:${impactColors.moderate}"></span>${page.summary.moderate} moderate</span>` : ''}
          ${page.summary.minor > 0 ? `<span class="page-badge"><span class="dot" style="background:${impactColors.minor}"></span>${page.summary.minor} minor</span>` : ''}
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${(page.totalViolations / maxIssues) * 100}%;background:${impactColors[severity]}"></div>
        </div>
      </div>`;
        }).join('')}
    </div>

    ${result.pagesSkipped.length > 0 ? `
    <!-- Skipped Pages -->
    <div class="skipped-section">
      <h3>Skipped Pages (${result.pagesSkipped.length})</h3>
      ${result.pagesSkipped.map(url => `<div class="skipped-item">${escapeHtml(url)}</div>`).join('')}
    </div>` : ''}

    <!-- Footer -->
    <div class="footer">
      Generated by <a href="https://github.com/rksekar5/a11y-audit">a11y-audit</a> • AI-Powered Accessibility Auditor
      ${worstPage ? `<br>Worst page: ${escapeHtml(worstPage.url)} (${worstPage.totalViolations} issues)` : ''}
      ${bestPage ? ` • Best page: ${escapeHtml(bestPage.url)} (${bestPage.totalViolations} issues)` : ''}
    </div>
  </div>

  <script>
    // Severity doughnut chart
    const sevCtx = document.getElementById('severityChart').getContext('2d');
    new Chart(sevCtx, {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'Serious', 'Moderate', 'Minor'],
        datasets: [{
          data: [${result.summary.critical}, ${result.summary.serious}, ${result.summary.moderate}, ${result.summary.minor}],
          backgroundColor: ['${impactColors.critical}', '${impactColors.serious}', '${impactColors.moderate}', '${impactColors.minor}'],
          borderWidth: 0,
          spacing: 2
        }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 16, usePointStyle: true, pointStyle: 'circle' } }
        }
      }
    });

    // Pages bar chart
    const pagesCtx = document.getElementById('pagesChart').getContext('2d');
    const pageData = ${JSON.stringify(result.pageResults.sort((a, b) => b.totalViolations - a.totalViolations).slice(0, 10).map(p => ({
      url: p.url.replace(/https?:\/\/[^/]+/, '').substring(0, 30) || '/',
      total: p.totalViolations,
      critical: p.summary.critical,
      serious: p.summary.serious,
      moderate: p.summary.moderate,
      minor: p.summary.minor
    })))};
    new Chart(pagesCtx, {
      type: 'bar',
      data: {
        labels: pageData.map(p => p.url),
        datasets: [
          { label: 'Critical', data: pageData.map(p => p.critical), backgroundColor: '${impactColors.critical}', borderRadius: 4 },
          { label: 'Serious', data: pageData.map(p => p.serious), backgroundColor: '${impactColors.serious}', borderRadius: 4 },
          { label: 'Moderate', data: pageData.map(p => p.moderate), backgroundColor: '${impactColors.moderate}', borderRadius: 4 },
          { label: 'Minor', data: pageData.map(p => p.minor), backgroundColor: '${impactColors.minor}', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        scales: {
          x: { stacked: true, grid: { color: 'rgba(100,116,139,0.1)' }, ticks: { color: '#94a3b8' } },
          y: { stacked: true, grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 12, usePointStyle: true, pointStyle: 'circle' } }
        }
      }
    });

    // Sort pages
    function sortPages(mode) {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      const container = document.querySelector('.pages-section');
      const rows = Array.from(container.querySelectorAll('.page-row'));
      rows.sort((a, b) => {
        if (mode === 'issues') return parseInt(b.dataset.issues) - parseInt(a.dataset.issues);
        return a.dataset.url.localeCompare(b.dataset.url);
      });
      const header = container.querySelector('.pages-header');
      rows.forEach(r => container.appendChild(r));
    }

    // Theme toggle
    function toggleTheme() {
      const body = document.body;
      const current = body.getAttribute('data-theme');
      body.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
      localStorage.setItem('a11y-crawl-theme', body.getAttribute('data-theme'));
    }
    const saved = localStorage.getItem('a11y-crawl-theme');
    if (saved) document.body.setAttribute('data-theme', saved);

    // Export CSV
    function exportCSV() {
      const rows = [['URL', 'Total', 'Critical', 'Serious', 'Moderate', 'Minor']];
      document.querySelectorAll('.page-row').forEach(row => {
        const url = row.dataset.url;
        const badges = row.querySelectorAll('.page-badge');
        let c = 0, s = 0, m = 0, mi = 0;
        badges.forEach(b => {
          const text = b.textContent.trim();
          if (text.includes('critical')) c = parseInt(text);
          else if (text.includes('serious')) s = parseInt(text);
          else if (text.includes('moderate')) m = parseInt(text);
          else if (text.includes('minor')) mi = parseInt(text);
        });
        rows.push([url, row.dataset.issues, c, s, m, mi].map(v => '"' + String(v).replace(/"/g, '""') + '"'));
      });
      const csv = rows.map(r => r.join(',')).join('\\n');
      download(csv, 'crawl-report.csv', 'text/csv');
    }

    // Export JSON
    function exportJSON() {
      const data = ${JSON.stringify({ pagesAudited: result.pagesAudited, duration: result.durationMs, summary: result.summary, pages: result.pageResults.map(p => ({ url: p.url, total: p.totalViolations, critical: p.summary.critical, serious: p.summary.serious, moderate: p.summary.moderate, minor: p.summary.minor })) })};
      download(JSON.stringify(data, null, 2), 'crawl-report.json', 'application/json');
    }

    function download(content, filename, type) {
      const blob = new Blob([content], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }
  <\/script>
</body>
</html>`;

  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
