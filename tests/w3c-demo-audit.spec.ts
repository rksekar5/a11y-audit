import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { AccessibilityAudit, generateA11yReport } from '../utils/accessibility-audit';
import fs from 'fs';
import path from 'path';

const BEFORE_URL = 'https://www.w3.org/WAI/demos/bad/before/home.html';
const AFTER_URL = 'https://www.w3.org/WAI/demos/bad/after/home.html';
const REPORTS_DIR = path.resolve(__dirname, '../test-results/a11y-reports');

test.describe('W3C WAI BAD Demo - Before vs After Comparison', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  });

  test('axe-core audit — BEFORE (intentionally broken)', async ({ page }) => {
    await page.goto(BEFORE_URL, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();

    const html = generateAxeReport(results, BEFORE_URL);
    fs.writeFileSync(path.join(REPORTS_DIR, 'axe-core-before.html'), html);
    console.log(`Axe-core BEFORE: ${results.violations.length} violations`);

    // The "before" page is intentionally broken — we expect violations
    expect(results.violations.length).toBeGreaterThan(0);
  });

  test('axe-core audit — AFTER (fixed version)', async ({ page }) => {
    await page.goto(AFTER_URL, { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();

    const html = generateAxeReport(results, AFTER_URL);
    fs.writeFileSync(path.join(REPORTS_DIR, 'axe-core-after.html'), html);
    console.log(`Axe-core AFTER: ${results.violations.length} violations`);
  });

  test('deep audit — BEFORE (intentionally broken)', async ({ page }) => {
    await page.goto(BEFORE_URL, { waitUntil: 'networkidle' });

    const screenshotDir = path.join(REPORTS_DIR, 'screenshots');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({
      wcagLevel: 'AA',
      includeExperimental: true,
      screenshotDir,
    });

    const html = generateA11yReport(results);
    fs.writeFileSync(path.join(REPORTS_DIR, 'deep-a11y-before.html'), html);
    console.log(`Deep audit BEFORE: ${results.totalViolations} violations`);

    // The "before" page should have many issues
    expect(results.totalViolations).toBeGreaterThan(5);
  });

  test('deep audit — AFTER (fixed version)', async ({ page }) => {
    await page.goto(AFTER_URL, { waitUntil: 'networkidle' });

    const screenshotDir = path.join(REPORTS_DIR, 'screenshots');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({
      wcagLevel: 'AA',
      includeExperimental: true,
      screenshotDir,
    });

    const html = generateA11yReport(results);
    fs.writeFileSync(path.join(REPORTS_DIR, 'deep-a11y-after.html'), html);
    console.log(`Deep audit AFTER: ${results.totalViolations} violations`);

    // The "after" page should have significantly fewer issues
    // (still may have some — it's not 100% perfect)
  });

  test('comparison: before should have MORE violations than after', async ({ page }) => {
    // Run audit on "before"
    await page.goto(BEFORE_URL, { waitUntil: 'networkidle' });
    const auditBefore = new AccessibilityAudit(page);
    const beforeResults = await auditBefore.runFullAudit({ wcagLevel: 'AA' });

    // Run audit on "after"
    await page.goto(AFTER_URL, { waitUntil: 'networkidle' });
    const auditAfter = new AccessibilityAudit(page);
    const afterResults = await auditAfter.runFullAudit({ wcagLevel: 'AA' });

    console.log(`BEFORE: ${beforeResults.totalViolations} violations`);
    console.log(`AFTER:  ${afterResults.totalViolations} violations`);
    console.log(`Improvement: ${beforeResults.totalViolations - afterResults.totalViolations} fewer violations`);

    // The fixed version should have fewer violations than the broken one
    expect(afterResults.totalViolations).toBeLessThan(beforeResults.totalViolations);
  });
});

function generateAxeReport(results: Awaited<ReturnType<AxeBuilder['analyze']>>, url: string): string {
  const impactColors: Record<string, string> = {
    critical: '#d32f2f',
    serious: '#f57c00',
    moderate: '#fbc02d',
    minor: '#1976d2',
  };

  const summary = {
    critical: results.violations.filter(v => v.impact === 'critical').length,
    serious: results.violations.filter(v => v.impact === 'serious').length,
    moderate: results.violations.filter(v => v.impact === 'moderate').length,
    minor: results.violations.filter(v => v.impact === 'minor').length,
  };

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Axe-Core Accessibility Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #fafafa; }
    h1 { color: #1a237e; }
    .meta { color: #666; margin-bottom: 20px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 20px 0; }
    .summary-card { padding: 15px; border-radius: 8px; text-align: center; color: white; }
    .violation { border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin: 10px 0; border-left: 4px solid; background: white; }
    .impact-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; color: white; font-size: 12px; font-weight: bold; }
    .element { background: #f5f5f5; padding: 8px; border-radius: 4px; font-family: monospace; font-size: 12px; margin: 5px 0; overflow-x: auto; word-break: break-all; }
    .fix { background: #e8f5e9; padding: 10px; border-radius: 4px; margin-top: 10px; }
    .tag { display: inline-block; background: #e3f2fd; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin: 2px; }
    .tool-badge { background: #4527a0; color: white; padding: 4px 12px; border-radius: 4px; font-size: 13px; display: inline-block; margin-bottom: 10px; }
    .nodes-count { color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <span class="tool-badge">axe-core only</span>
  <h1>Axe-Core Accessibility Report</h1>
  <div class="meta">
    <p><strong>URL:</strong> ${url}</p>
    <p><strong>Date:</strong> ${new Date().toISOString()}</p>
    <p><strong>Tool:</strong> axe-core via @axe-core/playwright</p>
    <p><strong>Total Violations:</strong> ${results.violations.length} rules, ${results.violations.reduce((s, v) => s + v.nodes.length, 0)} elements</p>
  </div>

  <div class="summary">
    <div class="summary-card" style="background:${impactColors.critical}">
      <div style="font-size:24px;font-weight:bold">${summary.critical}</div>
      <div>Critical</div>
    </div>
    <div class="summary-card" style="background:${impactColors.serious}">
      <div style="font-size:24px;font-weight:bold">${summary.serious}</div>
      <div>Serious</div>
    </div>
    <div class="summary-card" style="background:${impactColors.moderate}">
      <div style="font-size:24px;font-weight:bold">${summary.moderate}</div>
      <div>Moderate</div>
    </div>
    <div class="summary-card" style="background:${impactColors.minor}">
      <div style="font-size:24px;font-weight:bold">${summary.minor}</div>
      <div>Minor</div>
    </div>
  </div>

  <h2>Violations (${results.violations.length} rules)</h2>
`;

  for (const v of results.violations) {
    const color = impactColors[v.impact || 'minor'];
    html += `
  <div class="violation" style="border-left-color:${color}">
    <div>
      <span class="impact-badge" style="background:${color}">${(v.impact || 'unknown').toUpperCase()}</span>
      <strong>${v.id}</strong>
      <span class="nodes-count">(${v.nodes.length} element${v.nodes.length > 1 ? 's' : ''})</span>
    </div>
    <p>${v.description}</p>
    <div>${v.tags.filter(t => t.startsWith('wcag') || t === 'best-practice').map(t => `<span class="tag">${t}</span>`).join(' ')}</div>
    <div class="fix"><strong>How to fix:</strong> ${v.help} — <a href="${v.helpUrl}" target="_blank">Learn more</a></div>
    <details>
      <summary>Affected elements (${v.nodes.length})</summary>
      ${v.nodes.slice(0, 10).map(n => `<div class="element">${escapeHtml(n.html)}</div>`).join('')}
      ${v.nodes.length > 10 ? `<p>...and ${v.nodes.length - 10} more</p>` : ''}
    </details>
  </div>`;
  }

  html += `
  <h2>Passes (${results.passes.length} rules)</h2>
  <p>${results.passes.length} rules passed successfully.</p>
</body>
</html>`;
  return html;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
