import { test as base } from '@playwright/test';
import { AccessibilityAudit, A11yAuditResult, generateA11yReport } from '../utils/accessibility-audit';
import { TrendTracker } from '../utils/trend-tracker';
import * as path from 'path';
import { execSync } from 'child_process';

type A11yFixtures = {
  a11yAudit: AccessibilityAudit;
  runA11yAudit: (options?: {
    wcagLevel?: 'A' | 'AA' | 'AAA';
    includeExperimental?: boolean;
    exclude?: string[];
    disableRules?: string[];
    baselinePath?: string;
  }) => Promise<A11yAuditResult>;
};

function getGitMeta(): { gitBranch?: string; gitCommit?: string } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    return { gitBranch: branch, gitCommit: commit };
  } catch {
    return {};
  }
}

/**
 * Fixture that provides accessibility audit capabilities to any test.
 * Every audit automatically records results to the trend store.
 *
 * Usage:
 *   import { test, expect } from '../fixtures/a11y.fixture';
 *
 *   test('my page is accessible', async ({ page, runA11yAudit }) => {
 *     await page.goto('/my-page');
 *     const results = await runA11yAudit({ wcagLevel: 'AA' });
 *     expect(results.summary.critical).toBe(0);
 *   });
 */
export const test = base.extend<A11yFixtures>({
  a11yAudit: async ({ page }, use) => {
    await use(new AccessibilityAudit(page));
  },

  runA11yAudit: async ({ page }, use, testInfo) => {
    const audit = new AccessibilityAudit(page);

    const runner = async (options?: Parameters<AccessibilityAudit['runFullAudit']>[0]) => {
      const results = await audit.runFullAudit(options);

      // Auto-attach reports to test
      await testInfo.attach('a11y-report.html', {
        body: generateA11yReport(results),
        contentType: 'text/html',
      });
      await testInfo.attach('a11y-report.json', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      // Auto-record to trend store
      try {
        const tracker = new TrendTracker({
          storePath: path.resolve('.a11y-trends/history.json'),
        });
        tracker.recordAudit(results, getGitMeta());
      } catch {
        // Don't fail the test if trend recording fails
      }

      return results;
    };

    await use(runner);
  },
});

export { expect } from '@playwright/test';
