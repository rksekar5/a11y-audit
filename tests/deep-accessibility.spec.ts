import { test, expect } from '@playwright/test';
import { AccessibilityAudit, generateA11yReport, A11yAuditResult } from '../utils/accessibility-audit';

/**
 * Comprehensive accessibility audit tests that replicate BrowserStack-level
 * WCAG checking. Runs axe-core + 18 additional custom checks covering:
 * - Heading hierarchy (1.3.1, 2.4.6)
 * - Keyboard accessibility & traps (2.1.1, 2.1.2)
 * - Focus visibility (2.4.7)
 * - Link purpose (2.4.4)
 * - Color contrast including non-text (1.4.3, 1.4.11)
 * - Touch target size (2.5.8)
 * - Form labels & instructions (1.3.1, 3.3.2)
 * - ARIA pattern validation (4.1.2)
 * - Content reflow at 320px (1.4.10)
 * - Text spacing (1.4.12)
 * - Motion & animation (2.3.3)
 * - Landmarks (1.3.1, 2.4.1)
 * - Language attributes (3.1.1)
 * - Image accessibility (1.1.1)
 * - Table accessibility (1.3.1)
 * - Autoplay media (1.4.2)
 * - Status messages (4.1.3)
 * - Duplicate IDs (4.1.1)
 */

test.describe('Deep Accessibility Audit (WCAG 2.0/2.1/2.2)', () => {
  let audit: AccessibilityAudit;

  test.beforeEach(async ({ page }) => {
    audit = new AccessibilityAudit(page);
  });

  test('full WCAG AA audit — homepage', async ({ page }, testInfo) => {
    await page.goto('https://playwright.dev/');

    const results = await audit.runFullAudit({
      wcagLevel: 'AA',
      includeExperimental: true,
    });

    // Attach HTML report
    await testInfo.attach('accessibility-audit-report', {
      body: generateA11yReport(results),
      contentType: 'text/html',
    });

    // Attach JSON for programmatic analysis
    await testInfo.attach('accessibility-audit-json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });

    // Fail on critical + serious issues
    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    if (blocking.length > 0) {
      const summary = blocking
        .map(v => `[${v.impact.toUpperCase()}] ${v.rule}: ${v.description}`)
        .join('\n');
      expect(blocking, `Found ${blocking.length} blocking issues:\n${summary}`).toHaveLength(0);
    }
  });

  test('full WCAG AA audit — docs page', async ({ page }, testInfo) => {
    await page.goto('https://playwright.dev/docs/intro');

    const results = await audit.runFullAudit({
      wcagLevel: 'AA',
      exclude: ['.DocSearch'], // exclude known third-party widgets
    });

    await testInfo.attach('accessibility-audit-report', {
      body: generateA11yReport(results),
      contentType: 'text/html',
    });

    await testInfo.attach('accessibility-audit-json', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    });

    const blocking = results.violations.filter(
      v => v.impact === 'critical' || v.impact === 'serious'
    );

    if (blocking.length > 0) {
      const summary = blocking
        .map(v => `[${v.impact.toUpperCase()}] ${v.rule}: ${v.description}`)
        .join('\n');
      expect(blocking, `Found ${blocking.length} blocking issues:\n${summary}`).toHaveLength(0);
    }
  });

  test('audit multiple pages and aggregate results', async ({ page }, testInfo) => {
    const urls = [
      'https://playwright.dev/',
      'https://playwright.dev/docs/intro',
      'https://playwright.dev/docs/api/class-page',
    ];

    const allResults: A11yAuditResult[] = [];

    for (const url of urls) {
      await page.goto(url);
      const results = await audit.runFullAudit({ wcagLevel: 'AA' });
      allResults.push(results);
    }

    // Generate combined report
    const combinedReport = {
      totalPages: allResults.length,
      totalViolations: allResults.reduce((sum, r) => sum + r.totalViolations, 0),
      pages: allResults.map(r => ({
        url: r.url,
        violations: r.totalViolations,
        critical: r.summary.critical,
        serious: r.summary.serious,
      })),
      allViolations: allResults.flatMap(r =>
        r.violations.map(v => ({ ...v, pageUrl: r.url }))
      ),
    };

    await testInfo.attach('multi-page-audit', {
      body: JSON.stringify(combinedReport, null, 2),
      contentType: 'application/json',
    });

    // Combined HTML report
    const html = allResults.map(r => generateA11yReport(r)).join('<hr>');
    await testInfo.attach('multi-page-audit-report', {
      body: html,
      contentType: 'text/html',
    });

    const totalCritical = allResults.reduce((sum, r) => sum + r.summary.critical, 0);
    expect(totalCritical, `${totalCritical} critical violations across ${urls.length} pages`).toBe(0);
  });

  test('keyboard navigation audit', async ({ page }) => {
    await page.goto('https://playwright.dev/');

    // Tab through the page and verify focus is always visible and logical
    const focusOrder: string[] = [];
    const maxTabs = 30;

    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press('Tab');

      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          text: el.textContent?.trim().substring(0, 50),
          isVisible: !!(el as HTMLElement).offsetParent,
          rect: el.getBoundingClientRect(),
        };
      });

      if (!focused) break;

      // Verify focused element is visible
      expect(focused.isVisible, `Focused element should be visible: ${focused.tag} "${focused.text}"`).toBe(true);

      // Verify element is within viewport or page has scrolled to it
      expect(
        focused.rect.top >= -10 && focused.rect.top <= (await page.viewportSize())!.height + 10,
        `Focused element should be in viewport: ${focused.tag} "${focused.text}"`
      ).toBe(true);

      focusOrder.push(`${focused.tag}${focused.role ? `[role=${focused.role}]` : ''}: ${focused.text}`);
    }

    expect(focusOrder.length).toBeGreaterThan(0);
  });

  test('viewport reflow at 320px (WCAG 1.4.10)', async ({ page }) => {
    await page.goto('https://playwright.dev/');

    // Test at 320px width (equivalent to 400% zoom on 1280px viewport)
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(500);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

    expect(
      scrollWidth,
      `Page should not have horizontal scroll at 320px. scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`
    ).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test('text spacing override does not clip content (WCAG 1.4.12)', async ({ page }) => {
    await page.goto('https://playwright.dev/');

    // Apply WCAG 1.4.12 required text spacing
    await page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }
      `,
    });

    await page.waitForTimeout(300);

    // Check no content is clipped
    const clippedElements = await page.evaluate(() => {
      const issues: string[] = [];
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        if (style.overflow === 'hidden' && el.scrollHeight > el.clientHeight + 5) {
          issues.push(`${el.tagName}.${el.className}: content clipped (scrollH=${el.scrollHeight}, clientH=${el.clientHeight})`);
        }
      }
      return issues;
    });

    expect(clippedElements, `Content clipped when text spacing applied:\n${clippedElements.join('\n')}`).toHaveLength(0);
  });
});
