import { test, expect } from '@playwright/test';
import { AccessibilityAudit } from '../utils/accessibility-audit';

/**
 * FALSE-POSITIVE TESTS
 *
 * These verify that correctly-implemented accessible components
 * do NOT get flagged by the audit. This is the hardest part of any
 * accessibility tool — avoiding noise on compliant implementations.
 */

test.describe('False Positive: Keyboard Activation', () => {
  test('does NOT flag role="button" with addEventListener click handler', async ({ page }) => {
    // This is the most common React/Vue/Angular pattern — no inline attributes
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div id="btn" role="button" tabindex="0">Click me</div>
        <script>
          const btn = document.getElementById('btn');
          btn.addEventListener('click', () => {
            btn.textContent = 'Clicked!';
          });
          btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              btn.click();
            }
          });
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    const kbIssue = results.violations.find(v => v.rule === 'keyboard-activation-missing');
    expect(kbIssue).toBeFalsy();
  });

  test('does NOT flag role="button" that responds to Enter via click dispatch', async ({ page }) => {
    // Pattern where browser dispatches click on Enter for focused elements with role=button
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div id="toggle" role="button" tabindex="0" aria-pressed="false">Toggle</div>
        <script>
          const toggle = document.getElementById('toggle');
          toggle.addEventListener('click', () => {
            const pressed = toggle.getAttribute('aria-pressed') === 'true';
            toggle.setAttribute('aria-pressed', String(!pressed));
          });
          toggle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle.click();
            }
          });
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-activation-missing')).toBeFalsy();
  });

  test('DOES flag role="button" with no keyboard response at all', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div id="bad-btn" role="button" tabindex="0">Broken button</div>
        <script>
          // Only mouse click — no keyboard handler, and click won't fire on Enter
          document.getElementById('bad-btn').addEventListener('mousedown', () => {
            // nothing useful for keyboard users
          });
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-activation-missing')).toBeTruthy();
  });

  test('does NOT flag native <button> elements', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <button id="native">Native button</button>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-activation-missing')).toBeFalsy();
  });
});

test.describe('False Positive: ARIA Tablist', () => {
  test('does NOT flag properly implemented tablist with arrow key support', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>Tabs Example</h1>
        <div role="tablist" id="tablist">
          <button role="tab" id="tab1" aria-selected="true" aria-controls="panel1" tabindex="0">Tab 1</button>
          <button role="tab" id="tab2" aria-selected="false" aria-controls="panel2" tabindex="-1">Tab 2</button>
          <button role="tab" id="tab3" aria-selected="false" aria-controls="panel3" tabindex="-1">Tab 3</button>
        </div>
        <div role="tabpanel" id="panel1">Content 1</div>
        <div role="tabpanel" id="panel2" hidden>Content 2</div>
        <div role="tabpanel" id="panel3" hidden>Content 3</div>
        <script>
          const tablist = document.getElementById('tablist');
          const tabs = tablist.querySelectorAll('[role="tab"]');
          tablist.addEventListener('keydown', (e) => {
            const currentIndex = Array.from(tabs).indexOf(document.activeElement);
            let nextIndex;
            if (e.key === 'ArrowRight') {
              nextIndex = (currentIndex + 1) % tabs.length;
            } else if (e.key === 'ArrowLeft') {
              nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
            } else {
              return;
            }
            tabs.forEach((t, i) => {
              t.setAttribute('tabindex', i === nextIndex ? '0' : '-1');
              t.setAttribute('aria-selected', i === nextIndex ? 'true' : 'false');
            });
            tabs[nextIndex].focus();
          });
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'aria-tablist-keyboard')).toBeFalsy();
  });

  test('DOES flag tablist where arrow keys do nothing', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>Bad Tabs</h1>
        <div role="tablist" id="tablist">
          <button role="tab" id="tab1" aria-selected="true" aria-controls="panel1" tabindex="0">Tab 1</button>
          <button role="tab" id="tab2" aria-selected="false" aria-controls="panel2" tabindex="0">Tab 2</button>
        </div>
        <div role="tabpanel" id="panel1">Content 1</div>
        <div role="tabpanel" id="panel2" hidden>Content 2</div>
        <!-- No keyboard handler at all -->
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'aria-tablist-keyboard')).toBeTruthy();
  });
});

test.describe('False Positive: Dialog Escape', () => {
  test('does NOT flag dialog that closes on Escape', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div role="dialog" id="modal" aria-label="Settings" style="position: fixed; top: 50px; left: 50px; background: white; padding: 20px; z-index: 100;">
          <button id="close-btn">Save</button>
          <p>Dialog content</p>
        </div>
        <script>
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              document.getElementById('modal').style.display = 'none';
            }
          });
          document.getElementById('close-btn').focus();
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'aria-dialog-no-escape')).toBeFalsy();
  });

  test('does NOT flag dialog with close button (even without Escape handler)', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div role="dialog" id="modal" aria-label="Info" style="position: fixed; top: 50px; left: 50px; background: white; padding: 20px; z-index: 100;">
          <button aria-label="close">X</button>
          <p>This dialog has a close button</p>
        </div>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'aria-dialog-no-escape')).toBeFalsy();
  });
});

test.describe('False Positive: Color Contrast with Opacity', () => {
  test('detects contrast failure caused by ancestor opacity', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body style="background: white;">
        <h1>Heading</h1>
        <div style="opacity: 0.3;">
          <p id="faded" style="color: black;">This text is very faded</p>
        </div>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    // Black text at 0.3 opacity on white bg should have reduced contrast
    const contrastIssue = results.violations.find(
      v => v.rule === 'color-contrast-wcag' && v.elements.some(e => e.includes('faded'))
    );
    expect(contrastIssue).toBeTruthy();
  });

  test('does NOT flag high-contrast text with opacity: 1', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body style="background: white;">
        <h1>Heading</h1>
        <div style="opacity: 1;">
          <p id="solid" style="color: black;">This text has full contrast</p>
        </div>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    const contrastIssue = results.violations.find(
      v => v.rule === 'color-contrast-wcag' && v.elements.some(e => e.includes('solid'))
    );
    expect(contrastIssue).toBeFalsy();
  });
});

test.describe('False Positive: Keyboard Navigation', () => {
  test('does NOT flag div[role=button] inside a native button', async ({ page }) => {
    // Common pattern: icon wrapper div inside a button
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <button><div role="presentation">Icon</div> Submit</button>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    expect(results.violations.find(v => v.rule === 'keyboard-clickable-not-focusable')).toBeFalsy();
  });

  test('does NOT flag elements with tabindex and addEventListener', async ({ page }) => {
    await page.setContent(`
      <html lang="en"><body>
        <h1>App</h1>
        <div id="card" role="button" tabindex="0">Clickable card</div>
        <script>
          const card = document.getElementById('card');
          card.addEventListener('click', () => { card.classList.toggle('active'); });
          card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') card.click();
          });
        </script>
      </body></html>
    `);
    const audit = new AccessibilityAudit(page);
    const results = await audit.runFullAudit({ wcagLevel: 'AA' });
    // Should NOT flag — it has tabindex and role, keyboard works
    expect(results.violations.find(v => v.rule === 'keyboard-clickable-not-focusable')).toBeFalsy();
    expect(results.violations.find(v => v.rule === 'keyboard-activation-missing')).toBeFalsy();
  });
});
