import { test } from '@playwright/test';
import { AccessibilityAudit, generateA11yReport } from '../utils/accessibility-audit';
import { SiteCrawler, generateCrawlReport } from '../utils/site-crawler';
import { TrendTracker } from '../utils/trend-tracker';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CI-specific audit test that:
 * 1. Crawls the target URL (with sitemap + link following)
 * 2. Runs full accessibility audit on each page
 * 3. Records results in the trend store
 * 4. Generates a markdown summary for PR comments
 * 5. Writes a gate-result file for pass/fail decision
 */

const TARGET_URL = process.env.AUDIT_URL || 'https://www.w3.org/WAI/demos/bad/before/home.html';
const MAX_PAGES = parseInt(process.env.AUDIT_MAX_PAGES || '10', 10);
const GIT_BRANCH = process.env.GIT_BRANCH || undefined;
const GIT_COMMIT = process.env.GIT_COMMIT || undefined;

const TRENDS_DIR = '.a11y-trends';
const REPORTS_DIR = 'test-results/a11y-reports';

test.describe('CI Accessibility Audit', () => {
  test('crawl and audit site', async ({ page }, testInfo) => {
    // Ensure output dirs exist
    fs.mkdirSync(TRENDS_DIR, { recursive: true });
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    // Run site crawl
    const crawler = new SiteCrawler(page);
    const crawlResult = await crawler.crawl({
      startUrls: [TARGET_URL],
      maxPages: MAX_PAGES,
      sitemap: true,
      followLinks: true,
      wcagLevel: 'AA',
      includeExperimental: false,
      delayBetweenPages: 500,
      navigationTimeout: 20000,
      onProgress: (progress) => {
        console.log(
          `[${progress.pagesAudited}/${progress.pagesDiscovered}] Auditing: ${progress.currentUrl}`
        );
      },
    });

    // Save crawl report
    const crawlReportHtml = generateCrawlReport(crawlResult);
    fs.writeFileSync(path.join(REPORTS_DIR, 'crawl-report.html'), crawlReportHtml);

    // Record in trend tracker
    const tracker = new TrendTracker({
      storePath: path.join(TRENDS_DIR, 'history.json'),
      projectName: new URL(TARGET_URL).hostname,
    });

    tracker.recordCrawl(crawlResult, {
      gitBranch: GIT_BRANCH,
      gitCommit: GIT_COMMIT,
    });

    // Generate comparison and markdown summary
    const comparison = tracker.compare();
    const markdownSummary = tracker.generateMarkdownSummary(comparison);

    // Write summary for the GitHub Action to read
    fs.writeFileSync(path.join(TRENDS_DIR, 'ci-summary.md'), markdownSummary);

    // Write gate result
    const gateResult = (crawlResult.summary.critical > 0 || crawlResult.summary.serious > 0)
      ? 'FAILED'
      : 'PASSED';
    fs.writeFileSync(path.join(TRENDS_DIR, 'gate-result.txt'), gateResult);

    // Write trend report
    const trendReportHtml = tracker.generateTrendReport({ limit: 30 });
    fs.writeFileSync(path.join(REPORTS_DIR, 'trend-report.html'), trendReportHtml);

    // Attach reports to Playwright test results
    await testInfo.attach('crawl-report', {
      body: crawlReportHtml,
      contentType: 'text/html',
    });

    await testInfo.attach('trend-report', {
      body: trendReportHtml,
      contentType: 'text/html',
    });

    await testInfo.attach('ci-summary', {
      body: markdownSummary,
      contentType: 'text/markdown',
    });

    await testInfo.attach('crawl-result-json', {
      body: JSON.stringify(crawlResult, null, 2),
      contentType: 'application/json',
    });

    // Log summary
    console.log('\n' + '='.repeat(60));
    console.log('ACCESSIBILITY AUDIT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Pages audited: ${crawlResult.pagesAudited}`);
    console.log(`Total violations: ${crawlResult.summary.totalViolations}`);
    console.log(`  Critical: ${crawlResult.summary.critical}`);
    console.log(`  Serious:  ${crawlResult.summary.serious}`);
    console.log(`  Moderate: ${crawlResult.summary.moderate}`);
    console.log(`  Minor:    ${crawlResult.summary.minor}`);
    console.log(`Quality Gate: ${gateResult}`);
    console.log('='.repeat(60));
  });
});
