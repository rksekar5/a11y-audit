import { test, expect } from '@playwright/test';
import { SiteCrawler, generateCrawlReport } from '../utils/site-crawler';
import { TrendTracker } from '../utils/trend-tracker';
import * as fs from 'fs';
import * as path from 'path';

const REPORTS_DIR = path.resolve(__dirname, '../test-results/a11y-reports');
const TRENDS_DIR = path.resolve(__dirname, '../.a11y-trends');

test.describe('Site Crawl Accessibility Audit', () => {
  test.beforeAll(() => {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.mkdirSync(TRENDS_DIR, { recursive: true });
  });

  test('crawl and audit W3C BAD Demo', async ({ page }, testInfo) => {
    test.setTimeout(120_000); // 2 minutes for crawling

    const crawler = new SiteCrawler(page);
    const result = await crawler.crawl({
      startUrls: ['https://www.w3.org/WAI/demos/bad/before/home.html'],
      maxPages: 5,
      sitemap: false,
      followLinks: true,
      wcagLevel: 'AA',
      delayBetweenPages: 1000,
      includePattern: /w3\.org\/WAI\/demos\/bad\/before/,
      onProgress: (p) => {
        console.log(`[${p.pagesAudited}/${p.pagesDiscovered}] ${p.currentUrl}`);
      },
    });

    // Save crawl report
    const reportHtml = generateCrawlReport(result);
    fs.writeFileSync(path.join(REPORTS_DIR, 'crawl-report.html'), reportHtml);

    // Record trends
    const tracker = new TrendTracker({
      storePath: path.join(TRENDS_DIR, 'history.json'),
      projectName: 'w3c-bad-demo',
    });
    tracker.recordCrawl(result);

    // Generate and save trend report
    const trendHtml = tracker.generateTrendReport();
    fs.writeFileSync(path.join(REPORTS_DIR, 'trend-report.html'), trendHtml);

    // Attach to test
    await testInfo.attach('crawl-report', {
      body: reportHtml,
      contentType: 'text/html',
    });

    await testInfo.attach('crawl-result', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });

    // Assert no critical issues
    expect(result.summary.critical, `Found ${result.summary.critical} critical issues across ${result.pagesAudited} pages`).toBe(0);

    console.log(`\nCrawl complete: ${result.pagesAudited} pages, ${result.summary.totalViolations} issues`);
  });

  test('custom URL crawl', async ({ page }, testInfo) => {
    test.setTimeout(180_000); // 3 minutes

    const targetUrl = process.env.CRAWL_URL;
    test.skip(!targetUrl, 'Set CRAWL_URL env var to run this test');

    const crawler = new SiteCrawler(page);
    const result = await crawler.crawl({
      startUrls: [targetUrl!],
      maxPages: parseInt(process.env.CRAWL_MAX_PAGES || '10', 10),
      sitemap: true,
      followLinks: true,
      wcagLevel: 'AA',
      includeExperimental: true,
      delayBetweenPages: 1500,
      onProgress: (p) => {
        console.log(`[${p.pagesAudited}/${p.pagesDiscovered}] ${p.currentUrl}`);
      },
    });

    const reportHtml = generateCrawlReport(result);
    fs.writeFileSync(path.join(REPORTS_DIR, 'custom-crawl-report.html'), reportHtml);

    await testInfo.attach('crawl-report', {
      body: reportHtml,
      contentType: 'text/html',
    });

    console.log(`\nCrawl: ${result.pagesAudited} pages, ${result.summary.totalViolations} violations`);
    console.log(`  Critical: ${result.summary.critical}, Serious: ${result.summary.serious}`);
  });
});
