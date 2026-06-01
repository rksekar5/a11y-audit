import { test, expect } from '@playwright/test';
import { AccessibilityAudit, A11yAuditResult } from '../utils/accessibility-audit';

/**
 * Unit tests for individual accessibility checks using controlled HTML fixtures.
 * These don't depend on any external site — fully deterministic.
 */
test.describe('Unit: Heading Hierarchy', () => {
  test('detects missing headings', async ({ page }) => {
    await page.setContent('<html lang="en"><body><p>No headings here</p></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'heading-missing')).toBeTruthy();
  });

  test('detects skipped heading level', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Title</h1><h3>Skipped h2</h3></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'heading-skip-level')).toBeTruthy();
  });

  test('detects multiple h1s', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>First</h1><h1>Second</h1></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'heading-multiple-h1')).toBeTruthy();
  });

  test('passes valid heading hierarchy', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Title</h1><h2>Sub</h2><h3>Sub-sub</h3></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'heading-skip-level')).toBeFalsy();
    expect(results.violations.find(v => v.rule === 'heading-multiple-h1')).toBeFalsy();
  });
});

test.describe('Unit: Link Purpose', () => {
  test('detects empty links', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Test</h1><a href="/page"></a></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'link-empty')).toBeTruthy();
  });

  test('detects generic link text', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Test</h1><a href="/page">click here</a></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'link-generic-text')).toBeTruthy();
  });

  test('passes descriptive link text', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Test</h1><a href="/docs">Read the documentation</a></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'link-empty')).toBeFalsy();
    expect(results.violations.find(v => v.rule === 'link-generic-text')).toBeFalsy();
  });
});

test.describe('Unit: Form Labels', () => {
  test('detects input without label', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Form</h1><input type="text" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'form-input-no-label')).toBeTruthy();
  });

  test('detects placeholder-only label', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Form</h1><input type="text" placeholder="Enter name" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'form-placeholder-as-label')).toBeTruthy();
  });

  test('passes input with proper label', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Form</h1><label for="name">Name</label><input id="name" type="text" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'form-input-no-label')).toBeFalsy();
    expect(results.violations.find(v => v.rule === 'form-placeholder-as-label')).toBeFalsy();
  });
});

test.describe('Unit: Language Attributes', () => {
  test('detects missing lang attribute', async ({ page }) => {
    await page.setContent('<html><body><h1>No lang</h1></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'html-lang-missing')).toBeTruthy();
  });

  test('passes with lang attribute', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Has lang</h1></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'html-lang-missing')).toBeFalsy();
  });
});

test.describe('Unit: Image Accessibility', () => {
  test('detects image without alt', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Images</h1><img src="test.png" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'img-no-alt')).toBeTruthy();
  });

  test('detects filename as alt text', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Images</h1><img src="test.png" alt="DSC_0042.jpg" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'img-filename-alt')).toBeTruthy();
  });

  test('passes decorative image with empty alt', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Images</h1><img src="decorative.png" alt="" /></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'img-no-alt')).toBeFalsy();
  });
});

test.describe('Unit: Duplicate IDs', () => {
  test('detects duplicate IDs', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Test</h1><div id="dup">A</div><div id="dup">B</div></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'duplicate-id')).toBeTruthy();
  });

  test('passes unique IDs', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Test</h1><div id="one">A</div><div id="two">B</div></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'duplicate-id')).toBeFalsy();
  });
});

test.describe('Unit: Landmarks', () => {
  test('detects missing main landmark', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>No main</h1><p>Content</p></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'landmark-main-missing')).toBeTruthy();
  });

  test('passes with main landmark', async ({ page }) => {
    await page.setContent('<html lang="en"><body><main><h1>Content</h1></main></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'landmark-main-missing')).toBeFalsy();
  });
});

test.describe('Unit: Autoplay Media', () => {
  test('detects autoplay video with audio', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Media</h1><main><video autoplay src="video.mp4"></video></main></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'media-autoplay-audio')).toBeTruthy();
  });

  test('passes muted autoplay', async ({ page }) => {
    await page.setContent('<html lang="en"><body><h1>Media</h1><main><video autoplay muted src="video.mp4"></video></main></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'media-autoplay-audio')).toBeFalsy();
  });
});

test.describe('Unit: Keyboard Accessibility', () => {
  test('detects clickable div without keyboard access', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body><main><h1>Test</h1>
        <div onclick="alert('hi')">Click me</div>
      </main></body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-clickable-not-focusable')).toBeTruthy();
  });

  test('does not flag div inside a button (no false positive)', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body><main><h1>Test</h1>
        <button><div>Styled inner div</div></button>
      </main></body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-clickable-not-focusable')).toBeFalsy();
  });
});

test.describe('Unit: Table Accessibility', () => {
  test('detects data table without headers', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body><main><h1>Tables</h1>
        <table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>
      </main></body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'table-no-headers')).toBeTruthy();
  });

  test('passes layout table with role=presentation', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body><main><h1>Tables</h1>
        <table role="presentation"><tr><td>Layout</td></tr></table>
      </main></body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'table-no-headers')).toBeFalsy();
  });
});

test.describe('Unit: Try/Catch Resilience', () => {
  test('audit completes even with broken page state', async ({ page }) => {
    // Minimal valid page — audit should not crash
    await page.setContent('<html lang="en"><body><main><h1>Minimal</h1></main></body></html>');
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA', includeExperimental: true });
    // Should complete without throwing
    expect(results.url).toBeTruthy();
    expect(results.timestamp).toBeTruthy();
    expect(typeof results.totalViolations).toBe('number');
  });
});

test.describe('Unit: Deduplication', () => {
  test('does not report same element with same rule twice', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body><main><h1>Test</h1>
        <a href="/page"></a>
      </main></body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });

    // Should only have one violation per unique rule+element combo
    const emptyLinkViolations = results.violations.filter(v =>
      v.rule.includes('link') && v.elements[0]?.includes('href="/page"')
    );
    const ruleSet = new Set(emptyLinkViolations.map(v => v.rule));
    expect(emptyLinkViolations.length).toBe(ruleSet.size);
  });
});
