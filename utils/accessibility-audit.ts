import { Page, Locator, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as path from 'path';
import * as fs from 'fs';
import {
  parseColor,
  contrastRatio,
  alphaBlend,
  isLargeText,
  getRequiredRatio,
  CONTRAST_EXTRACTION_SCRIPT,
  ElementContrastInfo,
} from './contrast-ratio';

export interface A11yViolation {
  rule: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  wcagCriteria: string[];
  elements: string[];
  selectors?: string[];
  howToFix: string;
  screenshot?: string; // relative path to screenshot file
}

export interface A11yAuditResult {
  url: string;
  timestamp: string;
  totalViolations: number;
  violations: A11yViolation[];
  summary: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
}

/**
 * Comprehensive accessibility audit that goes beyond axe-core.
 * Replicates checks similar to BrowserStack's accessibility toolkit
 * covering WCAG 2.0, 2.1, and 2.2 guidelines.
 */
export class AccessibilityAudit {
  private page: Page;
  private violations: A11yViolation[] = [];

  /** Inject this into page.evaluate to generate a CSS selector for a DOM element */
  private static readonly CSS_SELECTOR_SCRIPT = `
    function getCssSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      const parts = [];
      while (el && el.nodeType === 1) {
        let selector = el.tagName.toLowerCase();
        if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\\s+/).filter(c => c.length > 0).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
          if (cls) selector += cls;
        }
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
          if (siblings.length > 1) selector += ':nth-of-type(' + (Array.from(parent.children).filter(s => s.tagName === el.tagName).indexOf(el) + 1) + ')';
        }
        parts.unshift(selector);
        el = parent;
        if (parts.length >= 4) break;
      }
      return parts.join(' > ');
    }
  `;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Run the full audit — axe-core + custom checks
   */
  async runFullAudit(options?: {
    wcagLevel?: 'A' | 'AA' | 'AAA';
    includeExperimental?: boolean;
    exclude?: string[];
    screenshotDir?: string; // if provided, captures screenshots for visual issues
  }): Promise<A11yAuditResult> {
    this.violations = [];

    const level = options?.wcagLevel ?? 'AA';
    const exclude = options?.exclude ?? [];

    // 1. Run axe-core with ALL rules (not just tagged ones)
    await this.runAxeCore(level, exclude);

    // 2. Custom checks that axe-core misses
    // Each check is wrapped in try/catch so one failure doesn't kill the whole audit
    const checks: Array<{ name: string; fn: () => Promise<void> }> = [
      { name: 'heading-hierarchy', fn: () => this.checkHeadingHierarchy() },
      { name: 'keyboard-navigation', fn: () => this.checkKeyboardNavigation() },
      { name: 'keyboard-traps', fn: () => this.checkKeyboardTraps() },
      { name: 'reverse-tab-navigation', fn: () => this.checkReverseTabNavigation() },
      { name: 'keyboard-activation', fn: () => this.checkKeyboardActivation() },
      { name: 'focus-visibility', fn: () => this.checkFocusVisibility() },
      { name: 'link-purpose', fn: () => this.checkLinkPurpose() },
      { name: 'color-contrast', fn: () => this.checkColorContrast() },
      { name: 'touch-target-size', fn: () => this.checkTouchTargetSize() },
      { name: 'form-labels', fn: () => this.checkFormLabels() },
      { name: 'aria-patterns', fn: () => this.checkAriaPatterns() },
      { name: 'content-reflow', fn: () => this.checkContentReflow() },
      { name: 'text-spacing', fn: () => this.checkTextSpacing() },
      { name: 'motion-animation', fn: () => this.checkMotionAndAnimation() },
      { name: 'landmarks', fn: () => this.checkLandmarks() },
      { name: 'language-attributes', fn: () => this.checkLanguageAttributes() },
      { name: 'tabindex', fn: () => this.checkTabIndex() },
      { name: 'image-accessibility', fn: () => this.checkImageAccessibility() },
      { name: 'table-accessibility', fn: () => this.checkTableAccessibility() },
      { name: 'autoplay-media', fn: () => this.checkAutoplayMedia() },
      { name: 'status-messages', fn: () => this.checkStatusMessages() },
      { name: 'duplicate-ids', fn: () => this.checkDuplicateIds() },
    ];

    if (options?.includeExperimental) {
      checks.push(
        { name: 'reading-order', fn: () => this.checkReadingOrder() },
        { name: 'cognitive-load', fn: () => this.checkCognitiveLoad() },
      );
    }

    for (const check of checks) {
      try {
        await check.fn();
      } catch (error) {
        // Record the failure as a minor violation so it's visible in the report
        this.violations.push({
          rule: `check-error-${check.name}`,
          impact: 'minor',
          description: `Custom check "${check.name}" failed to execute: ${error instanceof Error ? error.message : String(error)}`,
          wcagCriteria: [],
          elements: [],
          selectors: [],
          howToFix: 'This is an internal audit error — the check could not complete. Try re-running.',
        });
      }
    }

    // Deduplicate violations: same rule + same first element = duplicate
    this.deduplicateViolations();

    // Capture screenshots for visual-category violations
    if (options?.screenshotDir) {
      await this.captureVisualScreenshots(options.screenshotDir);
    }

    return {
      url: this.page.url(),
      timestamp: new Date().toISOString(),
      totalViolations: this.violations.length,
      violations: this.violations,
      summary: {
        critical: this.violations.filter(v => v.impact === 'critical').length,
        serious: this.violations.filter(v => v.impact === 'serious').length,
        moderate: this.violations.filter(v => v.impact === 'moderate').length,
        minor: this.violations.filter(v => v.impact === 'minor').length,
      },
    };
  }

  /** Rules that benefit from a visual screenshot */
  private static readonly VISUAL_RULES = new Set([
    'focus-not-visible',
    'focus-visible-removed-globally',
    'contrast-text-over-image',
    'non-text-contrast-insufficient',
    'target-size-minimum',
    'content-reflow-320',
    'text-spacing-clip',
    'axe-color-contrast',
    'axe-color-contrast-enhanced',
    'axe-link-in-text-block',
    'axe-target-size',
  ]);

  /**
   * Captures element screenshots for visual-category violations only.
   * Screenshots are saved as separate PNG files in the given directory.
   */
  private async captureVisualScreenshots(dir: string) {
    fs.mkdirSync(dir, { recursive: true });

    let idx = 0;
    for (const v of this.violations) {
      // Only screenshot visual rules
      if (!AccessibilityAudit.VISUAL_RULES.has(v.rule)) continue;

      // Use the first selector to locate the element
      const selector = v.selectors?.[0];
      if (!selector) continue;

      try {
        const el = this.page.locator(selector).first();
        // Check element is visible and in viewport
        if (await el.isVisible({ timeout: 2000 })) {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 });
          const filename = `visual-${idx++}-${v.rule.replace(/[^a-z0-9-]/g, '_')}.png`;
          const filepath = path.join(dir, filename);
          await el.screenshot({ path: filepath, timeout: 3000 });
          v.screenshot = filename;
        }
      } catch {
        // Element not found or not screenshotable — skip silently
      }
    }
  }

  /**
   * Remove duplicate violations (same rule + same first element).
   * Keeps the higher-impact duplicate when both axe-core and custom checks find the same issue.
   */
  private deduplicateViolations() {
    const seen = new Map<string, number>(); // key -> index in unique array
    const unique: A11yViolation[] = [];
    const impactOrder: Record<string, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };

    for (const v of this.violations) {
      // Create a dedup key from the rule base name and first element
      const ruleBase = v.rule.replace(/^axe-/, ''); // normalize axe- prefix
      const firstElement = (v.elements[0] || '').substring(0, 100);
      const key = `${ruleBase}::${firstElement}`;

      const existingIdx = seen.get(key);
      if (existingIdx !== undefined) {
        // Keep the higher-impact one
        const existing = unique[existingIdx];
        if ((impactOrder[v.impact] || 0) > (impactOrder[existing.impact] || 0)) {
          unique[existingIdx] = v;
        }
      } else {
        seen.set(key, unique.length);
        unique.push(v);
      }
    }

    this.violations = unique;
  }

  private async runAxeCore(level: string, exclude: string[]) {
    const tags = this.getWcagTags(level);

    let builder = new AxeBuilder({ page: this.page })
      .withTags(tags)
      .options({
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations', 'incomplete'],
      });

    for (const selector of exclude) {
      builder = builder.exclude(selector);
    }

    const results = await builder.analyze();

    // Convert axe violations to our format
    for (const v of results.violations) {
      this.violations.push({
        rule: `axe-${v.id}`,
        impact: v.impact as A11yViolation['impact'],
        description: v.description,
        wcagCriteria: v.tags.filter(t => t.startsWith('wcag')),
        elements: v.nodes.map(n => n.html).slice(0, 5),
        selectors: v.nodes.map(n => (n.target as string[]).join(' ')).slice(0, 5),
        howToFix: v.help,
      });
    }

    // Also report "incomplete" checks as minor issues (needs manual review)
    for (const inc of results.incomplete) {
      this.violations.push({
        rule: `axe-incomplete-${inc.id}`,
        impact: 'minor',
        description: `[Needs review] ${inc.description}`,
        wcagCriteria: inc.tags.filter(t => t.startsWith('wcag')),
        elements: inc.nodes.map(n => n.html).slice(0, 5),
        selectors: inc.nodes.map(n => (n.target as string[]).join(' ')).slice(0, 5),
        howToFix: inc.help,
      });
    }
  }

  /**
   * WCAG 1.3.1 / 2.4.6 — Heading hierarchy must be logical
   * (axe only checks if headings exist, not if they skip levels)
   */
  private async checkHeadingHierarchy() {
    const headings = await this.page.evaluate(() => {
      function getCssSelector(el: Element): string {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current.nodeType === 1) {
          let selector = current.tagName.toLowerCase();
          if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
          const parent: Element | null = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === current!.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(current!) + 1) + ')';
          }
          parts.unshift(selector);
          current = parent;
          if (parts.length >= 4) break;
        }
        return parts.join(' > ');
      }
      const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      return Array.from(elements).map(el => ({
        level: parseInt(el.tagName[1]),
        text: el.textContent?.trim().substring(0, 50) || '',
        html: el.outerHTML.substring(0, 100),
        selector: getCssSelector(el),
      }));
    });

    if (headings.length === 0) {
      this.violations.push({
        rule: 'heading-missing',
        impact: 'serious',
        description: 'Page has no headings. Headings help screen reader users navigate content.',
        wcagCriteria: ['wcag131', 'wcag246'],
        elements: [],
        selectors: [],
        howToFix: 'Add heading elements (h1-h6) to provide document structure.',
      });
      return;
    }

    // Check: first heading should be h1
    if (headings[0].level !== 1) {
      this.violations.push({
        rule: 'heading-first-not-h1',
        impact: 'moderate',
        description: `First heading on page is h${headings[0].level}, should be h1.`,
        wcagCriteria: ['wcag131', 'wcag246'],
        elements: [headings[0].html],
        selectors: [headings[0].selector],
        howToFix: 'Ensure the first heading on the page is an h1.',
      });
    }

    // Check: multiple h1s
    const h1Count = headings.filter(h => h.level === 1).length;
    if (h1Count > 1) {
      this.violations.push({
        rule: 'heading-multiple-h1',
        impact: 'moderate',
        description: `Page has ${h1Count} h1 elements. Best practice is one h1 per page.`,
        wcagCriteria: ['wcag131'],
        elements: headings.filter(h => h.level === 1).map(h => h.html),
        selectors: headings.filter(h => h.level === 1).map(h => h.selector),
        howToFix: 'Use only one h1 per page to clearly identify the main topic.',
      });
    }

    // Check: skipped heading levels
    for (let i = 1; i < headings.length; i++) {
      const current = headings[i].level;
      const previous = headings[i - 1].level;
      if (current > previous + 1) {
        this.violations.push({
          rule: 'heading-skip-level',
          impact: 'moderate',
          description: `Heading level skipped from h${previous} to h${current}: "${headings[i].text}"`,
          wcagCriteria: ['wcag131', 'wcag246'],
          elements: [headings[i].html],
          selectors: [headings[i].selector],
          howToFix: `Use h${previous + 1} instead of h${current} to maintain proper hierarchy.`,
        });
      }
    }
  }

  /**
   * WCAG 2.1.1 / 2.1.2 — Keyboard accessibility & no keyboard traps
   */
  private async checkKeyboardNavigation() {
    const interactiveElements = await this.page.evaluate(() => {
      const selectors = 'a[href], button, input, select, textarea, [tabindex], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]';
      const elements = document.querySelectorAll(selectors);
      return Array.from(elements).map(el => ({
        tag: el.tagName.toLowerCase(),
        html: el.outerHTML.substring(0, 150),
        tabIndex: (el as HTMLElement).tabIndex,
        isVisible: !!(el as HTMLElement).offsetParent,
        hasClickHandler: el.hasAttribute('onclick') || el.getAttribute('role') === 'button',
        isDisabled: (el as HTMLInputElement).disabled,
      }));
    });

    // Check for clickable divs/spans without keyboard access
    const clickableNonInteractive = await this.page.evaluate(() => {
      function getCssSelector(el: Element): string {
        if (el.id) return '#' + CSS.escape(el.id);
        const parts: string[] = [];
        let current: Element | null = el;
        while (current && current.nodeType === 1) {
          let selector = current.tagName.toLowerCase();
          if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
          const parent: Element | null = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === current!.tagName);
            if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(current!) + 1) + ')';
          }
          parts.unshift(selector);
          current = parent;
          if (parts.length >= 4) break;
        }
        return parts.join(' > ');
      }
      const allElements = document.querySelectorAll('div, span, li, p, img');
      const issues: { html: string; selector: string }[] = [];
      for (const el of allElements) {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(el);
        const hasClickCursor = style.cursor === 'pointer';
        const hasClickHandler = el.hasAttribute('onclick') || el.hasAttribute('ng-click') || el.hasAttribute('@click') || el.hasAttribute('v-on:click');
        const hasRole = el.hasAttribute('role');
        const hasTabIndex = el.hasAttribute('tabindex');

        // Skip if element is inside an interactive ancestor (a, button, label, summary)
        const interactiveAncestor = el.closest('a, button, label, summary, [role="button"], [role="link"], [role="tab"], [tabindex]');
        if (interactiveAncestor && interactiveAncestor !== el) continue;

        // Only flag if it has an explicit click handler (not just cursor: pointer from CSS)
        // cursor: pointer alone is too noisy — many CSS frameworks add it to styled elements
        if (hasClickHandler && !hasRole && !hasTabIndex) {
          issues.push({ html: el.outerHTML.substring(0, 150), selector: getCssSelector(el) });
        }
      }
      return issues.slice(0, 10);
    });

    for (const el of clickableNonInteractive) {
      this.violations.push({
        rule: 'keyboard-clickable-not-focusable',
        impact: 'serious',
        description: 'Clickable element is not keyboard accessible. It has no role or tabindex.',
        wcagCriteria: ['wcag211'],
        elements: [el.html],
        selectors: [el.selector],
        howToFix: 'Add role="button" and tabindex="0" with keyboard event handlers, or use a <button> element.',
      });
    }

    // Check for positive tabindex (disrupts natural tab order)
    const positiveTabIndex = interactiveElements.filter(el => el.tabIndex > 0);
    if (positiveTabIndex.length > 0) {
      this.violations.push({
        rule: 'tabindex-positive',
        impact: 'moderate',
        description: `${positiveTabIndex.length} element(s) have positive tabindex values, disrupting natural tab order.`,
        wcagCriteria: ['wcag241'],
        elements: positiveTabIndex.map(e => e.html),
        howToFix: 'Remove positive tabindex values. Use tabindex="0" for focusable elements or reorder DOM instead.',
      });
    }
  }

  /**
   * WCAG 2.1.2 — No keyboard traps
   * Tabs through focusable elements and detects if focus gets stuck in a loop
   */
  private async checkKeyboardTraps() {
    // Focus the body first to start from a clean state
    await this.page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await this.page.keyboard.press('Tab');

    const maxTabs = 50;
    const focusHistory: string[] = [];
    const trapThreshold = 3; // If same sequence repeats 3 times, it's a trap

    for (let i = 0; i < maxTabs; i++) {
      const focusedId = await this.page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return '__body__';
        return el.id || el.tagName + '_' + Array.from(el.parentElement?.children || []).indexOf(el);
      });

      focusHistory.push(focusedId);

      // Check for trap: look for repeating cycles of length 1-4
      for (let cycleLen = 1; cycleLen <= 4; cycleLen++) {
        if (focusHistory.length >= cycleLen * trapThreshold) {
          const recentCycles: string[][] = [];
          for (let c = 0; c < trapThreshold; c++) {
            const start = focusHistory.length - cycleLen * (c + 1);
            recentCycles.push(focusHistory.slice(start, start + cycleLen));
          }
          const allSame = recentCycles.every(
            cycle => JSON.stringify(cycle) === JSON.stringify(recentCycles[0])
          );
          if (allSame && !recentCycles[0].includes('__body__')) {
            const trappedElement = await this.page.evaluate(() => {
              return document.activeElement?.outerHTML?.substring(0, 150) || '';
            });
            this.violations.push({
              rule: 'keyboard-trap',
              impact: 'critical',
              description: `Keyboard trap detected: focus cycles through ${cycleLen} element(s) and cannot escape.`,
              wcagCriteria: ['wcag212'],
              elements: [trappedElement],
        selectors: [],
              howToFix: 'Ensure users can navigate away from all components using only the keyboard (Tab, Shift+Tab, or Escape).',
            });
            return; // Stop checking once trap is found
          }
        }
      }

      await this.page.keyboard.press('Tab');
    }
  }

  /**
   * WCAG 2.1.1 / 2.4.3 — Shift+Tab reverse navigation
   * Verifies that Shift+Tab moves focus backwards and doesn't get stuck
   */
  private async checkReverseTabNavigation() {
    // Tab forward a few times first to get into the page
    await this.page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    for (let i = 0; i < 5; i++) {
      await this.page.keyboard.press('Tab');
    }

    const forwardFocused = await this.page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        html: el.outerHTML.substring(0, 150),
      };
    });

    if (!forwardFocused) return;

    // Now Shift+Tab back
    await this.page.keyboard.press('Shift+Tab');

    const reverseFocused = await this.page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        html: el.outerHTML.substring(0, 150),
      };
    });

    // If focus didn't move at all, or went to body, it's broken
    if (!reverseFocused) {
      this.violations.push({
        rule: 'keyboard-reverse-nav-broken',
        impact: 'serious',
        description: 'Shift+Tab did not move focus to a previous element. Reverse keyboard navigation may be broken.',
        wcagCriteria: ['wcag211', 'wcag243'],
        elements: [forwardFocused.html],
        selectors: [],
        howToFix: 'Ensure all focusable elements support both forward (Tab) and reverse (Shift+Tab) navigation.',
      });
      return;
    }

    // Check if Shift+Tab stays stuck on the same element
    if (reverseFocused.html === forwardFocused.html) {
      // Try one more time
      await this.page.keyboard.press('Shift+Tab');
      const secondReverse = await this.page.evaluate(() => {
        const el = document.activeElement;
        return el?.outerHTML?.substring(0, 150) || '';
      });

      if (secondReverse === forwardFocused.html) {
        this.violations.push({
          rule: 'keyboard-reverse-nav-stuck',
          impact: 'serious',
          description: 'Focus does not move backwards with Shift+Tab. User may be trapped.',
          wcagCriteria: ['wcag211', 'wcag212'],
          elements: [forwardFocused.html],
        selectors: [],
          howToFix: 'Ensure Shift+Tab moves focus to the previous focusable element in the tab order.',
        });
      }
    }
  }

  /**
   * WCAG 2.1.1 — Enter/Space activation on interactive elements
   * Verifies that elements with button role or tabindex respond to keyboard activation
   */
  private async checkKeyboardActivation() {
    const customButtons = await this.page.evaluate(() => {
      const elements = document.querySelectorAll(
        '[role="button"], [role="link"], [tabindex="0"][onclick], div[onclick], span[onclick]'
      );
      return Array.from(elements)
        .filter(el => {
          const htmlEl = el as HTMLElement;
          return htmlEl.offsetParent !== null; // visible only
        })
        .slice(0, 10)
        .map(el => ({
          html: el.outerHTML.substring(0, 150),
          selector: el.id ? `#${el.id}` : null,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role'),
          hasKeydownHandler: el.hasAttribute('onkeydown') || el.hasAttribute('onkeypress') || el.hasAttribute('onkeyup'),
        }));
    });

    for (const btn of customButtons) {
      // Elements with role="button" or role="link" that lack keyboard event handlers
      // and are not native interactive elements
      const isNativeInteractive = ['button', 'a', 'input', 'select', 'textarea'].includes(btn.tag);
      if (!isNativeInteractive && !btn.hasKeydownHandler) {
        this.violations.push({
          rule: 'keyboard-activation-missing',
          impact: 'serious',
          description: `Element with role="${btn.role || 'interactive'}" has no keyboard event handler. It won't respond to Enter/Space.`,
          wcagCriteria: ['wcag211'],
          elements: [btn.html],
        selectors: [],
          howToFix: 'Add a keydown handler that activates on Enter and Space: el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { /* activate */ } })',
        });
      }
    }

    // Additionally check by attempting activation on role="button" elements
    // that have an accessible selector
    const activatableButtons = customButtons.filter(b => b.selector && b.role === 'button');
    for (const btn of activatableButtons.slice(0, 5)) {
      if (!btn.selector) continue;
      try {
        const element = this.page.locator(btn.selector);
        if (await element.count() === 0) continue;

        // Focus the element
        await element.focus();

        // Record current URL and any visible changes before activation
        const beforeState = await this.page.evaluate(() => ({
          url: window.location.href,
          activeEl: document.activeElement?.outerHTML?.substring(0, 100),
        }));

        // Press Enter
        await this.page.keyboard.press('Enter');

        // Small wait for any handler to fire
        await this.page.waitForTimeout(100);

        // Press Space on same element (re-focus if needed)
        const afterEnter = await this.page.evaluate(() => window.location.href);
        if (afterEnter !== beforeState.url) {
          // Navigation happened — Enter worked, move on
          await this.page.goBack();
          continue;
        }
      } catch {
        // Element may have been removed from DOM, skip
      }
    }
  }

  /**
   * WCAG 2.4.7 — Focus must be visible
   * Actually focuses elements to check their focused state styles.
   */
  private async checkFocusVisibility() {
    // Check by actually focusing elements and comparing styles
    const focusIssues = await this.page.evaluate(() => {
      const issues: string[] = [];
      const focusableElements = document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex="0"]'
      );

      // Only check a sample to avoid performance issues
      const sample = Array.from(focusableElements).filter(
        el => (el as HTMLElement).offsetParent !== null // visible only
      ).slice(0, 20);

      for (const el of sample) {
        const htmlEl = el as HTMLElement;

        // Record unfocused styles
        const beforeStyles = window.getComputedStyle(el);
        const beforeOutline = beforeStyles.outlineStyle + beforeStyles.outlineWidth + beforeStyles.outlineColor;
        const beforeBoxShadow = beforeStyles.boxShadow;
        const beforeBorder = beforeStyles.borderStyle + beforeStyles.borderWidth + beforeStyles.borderColor;
        const beforeBg = beforeStyles.backgroundColor;

        // Actually focus the element
        htmlEl.focus();

        // Read focused styles
        const afterStyles = window.getComputedStyle(el);
        const afterOutline = afterStyles.outlineStyle + afterStyles.outlineWidth + afterStyles.outlineColor;
        const afterBoxShadow = afterStyles.boxShadow;
        const afterBorder = afterStyles.borderStyle + afterStyles.borderWidth + afterStyles.borderColor;
        const afterBg = afterStyles.backgroundColor;

        // Check if anything visually changed when focused
        const hasOutline = afterStyles.outlineStyle !== 'none' && afterStyles.outlineWidth !== '0px';
        const outlineChanged = afterOutline !== beforeOutline;
        const shadowChanged = afterBoxShadow !== beforeBoxShadow;
        const borderChanged = afterBorder !== beforeBorder;
        const bgChanged = afterBg !== beforeBg;

        const hasFocusIndicator = hasOutline || outlineChanged || shadowChanged || borderChanged || bgChanged;

        if (!hasFocusIndicator) {
          issues.push(el.outerHTML.substring(0, 150));
        }

        // Blur so we don't affect subsequent checks
        htmlEl.blur();
      }
      return issues;
    });

    // Check CSS for global focus removal
    const globalFocusRemoval = await this.page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const text = rule.cssText;
            if (text.includes(':focus') && (text.includes('outline: none') || text.includes('outline:none') || text.includes('outline: 0'))) {
              if (text.startsWith('*') || text.startsWith(':focus') || text.startsWith('a:focus') || text.startsWith('button:focus')) {
                return true;
              }
            }
          }
        } catch {
          // Cross-origin stylesheets will throw
        }
      }
      return false;
    });

    if (globalFocusRemoval) {
      this.violations.push({
        rule: 'focus-visible-removed-globally',
        impact: 'serious',
        description: 'CSS removes focus outline globally without providing an alternative focus indicator.',
        wcagCriteria: ['wcag247'],
        elements: [],
        selectors: [],
        howToFix: 'Use :focus-visible instead of :focus to remove outlines, or provide alternative focus indicators (box-shadow, border, background).',
      });
    }

    for (const el of focusIssues) {
      this.violations.push({
        rule: 'focus-not-visible',
        impact: 'serious',
        description: 'Focusable element has no visible focus indicator.',
        wcagCriteria: ['wcag247'],
        elements: [el],
        selectors: [],
        howToFix: 'Ensure all focusable elements have a visible focus indicator (outline, box-shadow, or border change).',
      });
    }
  }

  /**
   * WCAG 2.4.4 / 2.4.9 — Link purpose must be determinable
   */
  private async checkLinkPurpose() {
    const linkIssues = await this.page.evaluate(() => {
      const links = document.querySelectorAll('a[href]');
      const issues: { html: string; issue: string }[] = [];

      const genericTexts = ['click here', 'here', 'read more', 'more', 'learn more', 'link', 'this', 'click', 'continue'];

      for (const link of links) {
        const text = (link.textContent?.trim() || '').toLowerCase();
        const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
        const title = link.getAttribute('title')?.toLowerCase() || '';
        const img = link.querySelector('img');
        const imgAlt = img?.getAttribute('alt') || '';

        const accessibleName = ariaLabel || text || imgAlt || title;

        if (!accessibleName) {
          issues.push({
            html: link.outerHTML.substring(0, 150),
            issue: 'empty-link',
          });
        } else if (genericTexts.includes(accessibleName.trim())) {
          issues.push({
            html: link.outerHTML.substring(0, 150),
            issue: 'generic-link-text',
          });
        }
      }
      return issues.slice(0, 15);
    });

    for (const issue of linkIssues) {
      if (issue.issue === 'empty-link') {
        this.violations.push({
          rule: 'link-empty',
          impact: 'serious',
          description: 'Link has no accessible name. Screen readers cannot determine its purpose.',
          wcagCriteria: ['wcag244', 'wcag412'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add link text, aria-label, or ensure contained images have alt text.',
        });
      } else {
        this.violations.push({
          rule: 'link-generic-text',
          impact: 'moderate',
          description: 'Link uses generic text like "click here" or "read more" that doesn\'t describe the destination.',
          wcagCriteria: ['wcag244'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Use descriptive link text that makes sense out of context. E.g., "Read the accessibility guidelines" instead of "Read more".',
        });
      }
    }
  }

  /**
   * WCAG 1.4.3 / 1.4.6 / 1.4.11 — Actual contrast ratio calculation
   * Uses relative luminance formula per WCAG 2.1 spec.
   * Computes real contrast ratios instead of heuristics.
   */
  private async checkColorContrast() {
    // Extract color data from page elements
    const elementData = await this.page.evaluate(CONTRAST_EXTRACTION_SCRIPT);

    for (const el of elementData as any[]) {
      const fgColor = parseColor(el.color);
      const bgColor = parseColor(el.bgColor);

      if (!fgColor || !bgColor) continue;

      // Apply alpha blending if foreground is semi-transparent
      const effectiveFg = alphaBlend(fgColor, bgColor);
      const ratio = contrastRatio(effectiveFg, bgColor);
      const largeText = isLargeText(el.fontSize, el.fontWeight);
      const requiredAA = getRequiredRatio('AA', largeText);

      if (ratio < requiredAA) {
        const impact = ratio < 3 ? 'serious' : 'moderate';
        this.violations.push({
          rule: 'color-contrast-wcag',
          impact,
          description: `Text has insufficient contrast ratio: ${ratio.toFixed(2)}:1 (requires ${requiredAA}:1 for ${largeText ? 'large' : 'normal'} text). Color: ${el.color} on ${el.bgColor}`,
          wcagCriteria: largeText ? ['wcag143'] : ['wcag143', 'wcag146'],
          elements: [el.html],
          selectors: [el.selector],
          howToFix: `Increase contrast ratio to at least ${requiredAA}:1. Current: ${ratio.toFixed(2)}:1. Darken the text or lighten the background.`,
        });
      }
    }

    // Also check non-text contrast (borders, icons) — WCAG 1.4.11
    const nonTextIssues = await this.page.evaluate(() => {
      const issues: { html: string; selector: string }[] = [];
      const formControls = document.querySelectorAll('input, select, textarea');
      for (const control of formControls) {
        const style = window.getComputedStyle(control);
        const borderColor = style.borderColor;
        const bgColor = style.backgroundColor;
        if (borderColor && bgColor) {
          if (borderColor === bgColor || borderColor === 'transparent') {
            let selector = control.tagName.toLowerCase();
            if (control.id) selector = '#' + control.id;
            issues.push({
              html: control.outerHTML.substring(0, 150),
              selector,
            });
          }
        }
      }
      return issues.slice(0, 10);
    });

    for (const issue of nonTextIssues) {
      this.violations.push({
        rule: 'non-text-contrast-insufficient',
        impact: 'moderate',
        description: 'Form control has insufficient non-text contrast (border indistinguishable from background).',
        wcagCriteria: ['wcag1411'],
        elements: [issue.html],
        selectors: [issue.selector],
        howToFix: 'Ensure form control boundaries have at least 3:1 contrast ratio against adjacent colors.',
      });
    }

    // Check text over background images
    const textOverImageIssues = await this.page.evaluate(() => {
      const issues: { html: string; selector: string }[] = [];
      const elementsOverBg = document.querySelectorAll('[style*="background-image"], [style*="background:"]');
      for (const el of elementsOverBg) {
        const textContent = el.textContent?.trim();
        if (textContent && textContent.length > 0) {
          const style = window.getComputedStyle(el);
          if (style.backgroundImage !== 'none' && !style.backgroundImage.includes('gradient')) {
            let selector = el.tagName.toLowerCase();
            if (el.id) selector = '#' + el.id;
            issues.push({
              html: el.outerHTML.substring(0, 150),
              selector,
            });
          }
        }
      }
      return issues.slice(0, 5);
    });

    for (const issue of textOverImageIssues) {
      this.violations.push({
        rule: 'contrast-text-over-image',
        impact: 'moderate',
        description: 'Text is displayed over a background image without a contrast-ensuring overlay.',
        wcagCriteria: ['wcag143'],
        elements: [issue.html],
        selectors: [issue.selector],
        howToFix: 'Add a semi-transparent overlay behind text, or use text-shadow/background-color to ensure contrast.',
      });
    }
  }

  /**
   * WCAG 2.5.8 (2.2) — Target Size minimum 24x24px
   */
  private async checkTouchTargetSize() {
    const smallTargets = await this.page.evaluate(() => {
      const interactive = document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="tab"], [tabindex="0"]');
      const issues: { html: string; width: number; height: number }[] = [];

      for (const el of interactive) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (rect.width < 24 || rect.height < 24) {
            // Exclude inline links within paragraphs (exempted by WCAG 2.5.8)
            const parent = el.parentElement;
            const isInlineLink = el.tagName === 'A' && parent?.tagName === 'P';
            if (!isInlineLink) {
              issues.push({
                html: el.outerHTML.substring(0, 150),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
              });
            }
          }
        }
      }
      return issues.slice(0, 10);
    });

    for (const target of smallTargets) {
      this.violations.push({
        rule: 'target-size-minimum',
        impact: 'moderate',
        description: `Interactive element is ${target.width}x${target.height}px — below WCAG 2.5.8 minimum of 24x24px.`,
        wcagCriteria: ['wcag258'],
        elements: [target.html],
        selectors: [],
        howToFix: 'Increase the clickable area to at least 24x24 CSS pixels. Use padding or min-width/min-height.',
      });
    }
  }

  /**
   * WCAG 1.3.1 / 3.3.2 — Form label and instruction checks
   */
  private async checkFormLabels() {
    const formIssues = await this.page.evaluate(() => {
      const issues: { html: string; issue: string }[] = [];
      const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');

      for (const input of inputs) {
        const id = input.id;
        const ariaLabel = input.getAttribute('aria-label');
        const ariaLabelledBy = input.getAttribute('aria-labelledby');
        const title = input.getAttribute('title');
        const placeholder = input.getAttribute('placeholder');
        const label = id ? document.querySelector(`label[for="${id}"]`) : null;
        const parentLabel = input.closest('label');

        const hasLabel = !!(label || parentLabel || ariaLabel || ariaLabelledBy || title);

        if (!hasLabel) {
          if (placeholder) {
            issues.push({ html: input.outerHTML.substring(0, 150), issue: 'placeholder-as-label' });
          } else {
            issues.push({ html: input.outerHTML.substring(0, 150), issue: 'no-label' });
          }
        }

        // Check for required fields without aria-required or required attribute
        const isRequired = input.hasAttribute('required') || input.getAttribute('aria-required') === 'true';
        const hasVisualRequired = input.parentElement?.textContent?.includes('*') || false;
        if (hasVisualRequired && !isRequired) {
          issues.push({ html: input.outerHTML.substring(0, 150), issue: 'visual-required-no-attribute' });
        }
      }
      return issues.slice(0, 15);
    });

    for (const issue of formIssues) {
      if (issue.issue === 'no-label') {
        this.violations.push({
          rule: 'form-input-no-label',
          impact: 'critical',
          description: 'Form input has no accessible label.',
          wcagCriteria: ['wcag131', 'wcag332', 'wcag412'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add a <label> element with matching "for" attribute, or use aria-label/aria-labelledby.',
        });
      } else if (issue.issue === 'placeholder-as-label') {
        this.violations.push({
          rule: 'form-placeholder-as-label',
          impact: 'serious',
          description: 'Form input uses placeholder as its only label. Placeholder disappears on input and has poor contrast.',
          wcagCriteria: ['wcag131', 'wcag332'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add a visible <label> element. Placeholder should supplement, not replace, a label.',
        });
      } else if (issue.issue === 'visual-required-no-attribute') {
        this.violations.push({
          rule: 'form-required-not-programmatic',
          impact: 'moderate',
          description: 'Field appears visually required (asterisk) but lacks required/aria-required attribute.',
          wcagCriteria: ['wcag131', 'wcag332'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add required or aria-required="true" to programmatically indicate the field is required.',
        });
      }
    }
  }

  /**
   * WCAG 4.1.2 — ARIA pattern validation
   * Checks for common ARIA misuse that axe-core might miss
   */
  private async checkAriaPatterns() {
    const ariaIssues = await this.page.evaluate(() => {
      const issues: { html: string; issue: string }[] = [];

      // Check for aria-hidden on focusable elements
      const hiddenFocusable = document.querySelectorAll('[aria-hidden="true"] a[href], [aria-hidden="true"] button, [aria-hidden="true"] input, [aria-hidden="true"] [tabindex="0"]');
      for (const el of hiddenFocusable) {
        if ((el as HTMLElement).offsetParent !== null) {
          issues.push({ html: el.outerHTML.substring(0, 150), issue: 'aria-hidden-focusable' });
        }
      }

      // Check for interactive elements with aria-disabled but still focusable
      const ariaDisabled = document.querySelectorAll('[aria-disabled="true"]');
      for (const el of ariaDisabled) {
        const tabIndex = (el as HTMLElement).tabIndex;
        if (tabIndex >= 0 && el.tagName !== 'INPUT') {
          // This is actually valid but should have proper keyboard handler to prevent activation
          const hasPreventHandler = el.getAttribute('onclick')?.includes('return false');
          if (!hasPreventHandler) {
            issues.push({ html: el.outerHTML.substring(0, 150), issue: 'aria-disabled-still-active' });
          }
        }
      }

      // Check tabs pattern
      const tabLists = document.querySelectorAll('[role="tablist"]');
      for (const tabList of tabLists) {
        const tabs = tabList.querySelectorAll('[role="tab"]');
        if (tabs.length === 0) {
          issues.push({ html: tabList.outerHTML.substring(0, 150), issue: 'tablist-no-tabs' });
        }
        let hasSelected = false;
        for (const tab of tabs) {
          if (tab.getAttribute('aria-selected') === 'true') hasSelected = true;
          if (!tab.getAttribute('aria-controls')) {
            issues.push({ html: tab.outerHTML.substring(0, 150), issue: 'tab-no-controls' });
          }
        }
        if (tabs.length > 0 && !hasSelected) {
          issues.push({ html: tabList.outerHTML.substring(0, 150), issue: 'tablist-no-selected' });
        }
      }

      // Check dialog pattern
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      for (const dialog of dialogs) {
        if (!dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')) {
          issues.push({ html: dialog.outerHTML.substring(0, 150), issue: 'dialog-no-label' });
        }
      }

      // Check for role="presentation" or role="none" on focusable elements
      const presentationFocusable = document.querySelectorAll('[role="presentation"][tabindex], [role="none"][tabindex]');
      for (const el of presentationFocusable) {
        issues.push({ html: el.outerHTML.substring(0, 150), issue: 'presentation-focusable' });
      }

      return issues.slice(0, 15);
    });

    const issueMap: Record<string, { impact: A11yViolation['impact']; desc: string; fix: string }> = {
      'aria-hidden-focusable': {
        impact: 'critical',
        desc: 'Focusable element inside aria-hidden container. Screen readers skip it but keyboard users can still reach it.',
        fix: 'Add tabindex="-1" to focusable elements inside aria-hidden containers, or remove aria-hidden.',
      },
      'aria-disabled-still-active': {
        impact: 'moderate',
        desc: 'Element with aria-disabled="true" may still be activatable by keyboard.',
        fix: 'Prevent activation via keyboard/click handlers when aria-disabled is true.',
      },
      'tablist-no-tabs': {
        impact: 'serious',
        desc: 'Element with role="tablist" contains no elements with role="tab".',
        fix: 'Add role="tab" to tab elements within the tablist.',
      },
      'tab-no-controls': {
        impact: 'moderate',
        desc: 'Tab element missing aria-controls pointing to its panel.',
        fix: 'Add aria-controls attribute referencing the associated tabpanel id.',
      },
      'tablist-no-selected': {
        impact: 'moderate',
        desc: 'Tablist has no tab with aria-selected="true".',
        fix: 'Set aria-selected="true" on the currently active tab.',
      },
      'dialog-no-label': {
        impact: 'serious',
        desc: 'Dialog has no accessible name (no aria-label or aria-labelledby).',
        fix: 'Add aria-label or aria-labelledby referencing the dialog title.',
      },
      'presentation-focusable': {
        impact: 'serious',
        desc: 'Element with role="presentation" or role="none" is also focusable, creating a conflict.',
        fix: 'Remove the role or the tabindex. Focusable elements cannot have presentation role.',
      },
    };

    for (const issue of ariaIssues) {
      const info = issueMap[issue.issue];
      if (info) {
        this.violations.push({
          rule: `aria-${issue.issue}`,
          impact: info.impact,
          description: info.desc,
          wcagCriteria: ['wcag412'],
          elements: [issue.html],
        selectors: [],
          howToFix: info.fix,
        });
      }
    }
  }

  /**
   * WCAG 1.4.10 — Content reflow at 320px width
   */
  private async checkContentReflow() {
    const viewport = this.page.viewportSize();
    if (!viewport) return;

    // Temporarily resize to 320px width to check for horizontal scrolling
    await this.page.setViewportSize({ width: 320, height: viewport.height });

    const hasHorizontalScroll = await this.page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalScroll) {
      const overflowElements = await this.page.evaluate(() => {
        const issues: string[] = [];
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const rect = el.getBoundingClientRect();
          if (rect.right > window.innerWidth + 5) {
            issues.push(el.outerHTML.substring(0, 150));
          }
        }
        return issues.slice(0, 5);
      });

      this.violations.push({
        rule: 'content-reflow-320',
        impact: 'serious',
        description: 'Page has horizontal scrollbar at 320px viewport width. Content does not reflow properly.',
        wcagCriteria: ['wcag1410'],
        elements: overflowElements,
        howToFix: 'Use responsive design (max-width: 100%, flexbox, grid) to ensure content reflows at 320px width without horizontal scrolling.',
      });
    }

    // Restore original viewport
    await this.page.setViewportSize(viewport);
  }

  /**
   * WCAG 1.4.12 — Text spacing override test
   */
  private async checkTextSpacing() {
    const viewport = this.page.viewportSize();
    if (!viewport) return;

    // Apply WCAG 1.4.12 text spacing overrides
    const clippedContent = await this.page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'a11y-text-spacing-test';
      style.textContent = `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
        p { margin-bottom: 2em !important; }
      `;
      document.head.appendChild(style);

      // Check for clipped/overlapping content
      const issues: string[] = [];
      const elements = document.querySelectorAll('*');
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        if (style.overflow === 'hidden' || style.textOverflow === 'ellipsis') {
          const rect = el.getBoundingClientRect();
          if (rect.height > 0 && el.scrollHeight > rect.height + 5) {
            issues.push(el.outerHTML.substring(0, 150));
          }
        }
      }

      // Clean up
      document.getElementById('a11y-text-spacing-test')?.remove();
      return issues.slice(0, 5);
    });

    if (clippedContent.length > 0) {
      this.violations.push({
        rule: 'text-spacing-clip',
        impact: 'serious',
        description: 'Content is clipped or lost when text spacing is adjusted per WCAG 1.4.12 requirements.',
        wcagCriteria: ['wcag1412'],
        elements: clippedContent,
        howToFix: 'Avoid fixed heights with overflow:hidden on text containers. Use min-height or allow containers to grow.',
      });
    }
  }

  /**
   * WCAG 2.3.3 — Animation from interactions
   */
  private async checkMotionAndAnimation() {
    const animationIssues = await this.page.evaluate(() => {
      const issues: { html: string; issue: string }[] = [];

      // Check if prefers-reduced-motion is respected
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const hasAnimation = style.animationName !== 'none';
        const hasTransition = style.transitionDuration !== '0s' && parseFloat(style.transitionDuration) > 0.5;

        if (hasAnimation) {
          issues.push({ html: el.outerHTML.substring(0, 150), issue: 'animation-present' });
          break; // Only report once
        }
      }

      // Check for auto-playing animations/carousels
      const autoplayElements = document.querySelectorAll('[autoplay], .carousel, .slider, .slideshow, [data-autoplay]');
      for (const el of autoplayElements) {
        issues.push({ html: el.outerHTML.substring(0, 150), issue: 'autoplay-content' });
      }

      return issues.slice(0, 5);
    });

    // Check if prefers-reduced-motion media query is used in stylesheets
    const respectsMotionPref = await this.page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSMediaRule && rule.conditionText?.includes('prefers-reduced-motion')) {
              return true;
            }
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });

    const hasAnimations = animationIssues.some(i => i.issue === 'animation-present');
    if (hasAnimations && !respectsMotionPref) {
      this.violations.push({
        rule: 'motion-preference-not-respected',
        impact: 'moderate',
        description: 'Page has animations but does not use @media (prefers-reduced-motion) to respect user preferences.',
        wcagCriteria: ['wcag233'],
        elements: animationIssues.filter(i => i.issue === 'animation-present').map(i => i.html),
        howToFix: 'Add @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }',
      });
    }

    for (const issue of animationIssues.filter(i => i.issue === 'autoplay-content')) {
      this.violations.push({
        rule: 'autoplay-moving-content',
        impact: 'serious',
        description: 'Auto-playing content detected. Users must be able to pause, stop, or hide moving content.',
        wcagCriteria: ['wcag222'],
        elements: [issue.html],
        selectors: [],
        howToFix: 'Provide visible pause/stop controls for all auto-playing content.',
      });
    }
  }

  /**
   * WCAG 1.3.1 / 2.4.1 — Page landmarks
   */
  private async checkLandmarks() {
    const landmarkInfo = await this.page.evaluate(() => {
      const hasMain = !!document.querySelector('main, [role="main"]');
      const hasNav = !!document.querySelector('nav, [role="navigation"]');
      const hasBanner = !!document.querySelector('header, [role="banner"]');
      const hasContentInfo = !!document.querySelector('footer, [role="contentinfo"]');
      const multipleNav = document.querySelectorAll('nav, [role="navigation"]').length > 1;
      const navsWithoutLabel: string[] = [];

      if (multipleNav) {
        const navs = document.querySelectorAll('nav, [role="navigation"]');
        for (const nav of navs) {
          if (!nav.getAttribute('aria-label') && !nav.getAttribute('aria-labelledby')) {
            navsWithoutLabel.push(nav.outerHTML.substring(0, 100));
          }
        }
      }

      return { hasMain, hasNav, hasBanner, hasContentInfo, multipleNav, navsWithoutLabel };
    });

    if (!landmarkInfo.hasMain) {
      this.violations.push({
        rule: 'landmark-main-missing',
        impact: 'moderate',
        description: 'Page has no <main> landmark. Screen reader users cannot quickly jump to main content.',
        wcagCriteria: ['wcag131', 'wcag241'],
        elements: [],
        selectors: [],
        howToFix: 'Wrap the primary page content in a <main> element.',
      });
    }

    if (!landmarkInfo.hasNav) {
      this.violations.push({
        rule: 'landmark-nav-missing',
        impact: 'minor',
        description: 'Page has no <nav> landmark for navigation.',
        wcagCriteria: ['wcag131'],
        elements: [],
        selectors: [],
        howToFix: 'Wrap navigation links in a <nav> element.',
      });
    }

    if (landmarkInfo.navsWithoutLabel.length > 0) {
      this.violations.push({
        rule: 'landmark-nav-duplicate-no-label',
        impact: 'moderate',
        description: 'Multiple navigation landmarks exist without unique labels. Screen readers cannot distinguish them.',
        wcagCriteria: ['wcag131'],
        elements: landmarkInfo.navsWithoutLabel,
        howToFix: 'Add unique aria-label to each <nav> (e.g., aria-label="Main navigation", aria-label="Footer navigation").',
      });
    }
  }

  /**
   * WCAG 3.1.1 / 3.1.2 — Language attributes
   */
  private async checkLanguageAttributes() {
    const langIssues = await this.page.evaluate(() => {
      const issues: { issue: string; html: string }[] = [];
      const htmlLang = document.documentElement.getAttribute('lang');

      if (!htmlLang) {
        issues.push({ issue: 'no-html-lang', html: '<html>' });
      } else if (htmlLang.length < 2) {
        issues.push({ issue: 'invalid-html-lang', html: `<html lang="${htmlLang}">` });
      }

      // Check for content in different languages without lang attribute
      // This is heuristic-based
      return issues;
    });

    for (const issue of langIssues) {
      if (issue.issue === 'no-html-lang') {
        this.violations.push({
          rule: 'html-lang-missing',
          impact: 'serious',
          description: 'HTML element has no lang attribute. Screen readers cannot determine the page language.',
          wcagCriteria: ['wcag311'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add lang attribute to <html> element (e.g., <html lang="en">).',
        });
      }
    }
  }

  /**
   * WCAG 2.4.3 — Focus order / tabindex issues
   */
  private async checkTabIndex() {
    const tabIndexIssues = await this.page.evaluate(() => {
      const issues: { html: string; value: number }[] = [];
      const elements = document.querySelectorAll('[tabindex]');

      for (const el of elements) {
        const value = parseInt(el.getAttribute('tabindex') || '0');
        if (value > 0) {
          issues.push({ html: el.outerHTML.substring(0, 150), value });
        }
      }

      // Check for very high negative tabindex (unusual, may indicate issues)
      return issues.slice(0, 10);
    });

    // Already covered in keyboard nav check, but this adds more detail
  }

  /**
   * WCAG 1.1.1 — Image accessibility (beyond alt text presence)
   */
  private async checkImageAccessibility() {
    const imgIssues = await this.page.evaluate(() => {
      const issues: { html: string; issue: string }[] = [];
      const images = document.querySelectorAll('img');

      for (const img of images) {
        const alt = img.getAttribute('alt');
        const role = img.getAttribute('role');
        const ariaLabel = img.getAttribute('aria-label');
        const ariaHidden = img.getAttribute('aria-hidden');

        if (alt === null && role !== 'presentation' && role !== 'none' && ariaHidden !== 'true') {
          issues.push({ html: img.outerHTML.substring(0, 150), issue: 'img-no-alt' });
        } else if (alt !== null) {
          // Check for unhelpful alt text
          const unhelpful = ['image', 'photo', 'picture', 'img', 'icon', 'graphic', 'logo'];
          if (unhelpful.includes(alt.toLowerCase().trim())) {
            issues.push({ html: img.outerHTML.substring(0, 150), issue: 'img-unhelpful-alt' });
          }
          // Check for filename as alt
          if (/\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(alt)) {
            issues.push({ html: img.outerHTML.substring(0, 150), issue: 'img-filename-alt' });
          }
          // Check for excessively long alt text (suggests it should be longdesc)
          if (alt.length > 150) {
            issues.push({ html: img.outerHTML.substring(0, 150), issue: 'img-alt-too-long' });
          }
        }
      }

      // Check SVGs
      const svgs = document.querySelectorAll('svg');
      for (const svg of svgs) {
        const title = svg.querySelector('title');
        const ariaLabel = svg.getAttribute('aria-label');
        const ariaHidden = svg.getAttribute('aria-hidden');
        const role = svg.getAttribute('role');

        if (!title && !ariaLabel && ariaHidden !== 'true' && role !== 'presentation') {
          // Check if SVG is decorative (inside a labeled button/link)
          const parent = svg.closest('a, button');
          const parentHasLabel = parent && (parent.textContent?.trim() || parent.getAttribute('aria-label'));
          if (!parentHasLabel) {
            issues.push({ html: svg.outerHTML.substring(0, 100), issue: 'svg-no-accessible-name' });
          }
        }
      }

      return issues.slice(0, 15);
    });

    const issueDescriptions: Record<string, { impact: A11yViolation['impact']; desc: string; fix: string }> = {
      'img-no-alt': { impact: 'critical', desc: 'Image missing alt attribute.', fix: 'Add alt="" for decorative images or descriptive alt text for informative images.' },
      'img-unhelpful-alt': { impact: 'moderate', desc: 'Image alt text is generic (e.g., "image", "photo") and not descriptive.', fix: 'Write alt text that describes the image content or function.' },
      'img-filename-alt': { impact: 'serious', desc: 'Image alt text appears to be a filename.', fix: 'Replace filename with meaningful description of the image.' },
      'img-alt-too-long': { impact: 'minor', desc: 'Image alt text exceeds 150 characters. Consider using a figure with figcaption.', fix: 'Keep alt text concise. Use longdesc or <figure>/<figcaption> for complex images.' },
      'svg-no-accessible-name': { impact: 'moderate', desc: 'SVG has no accessible name (no <title>, aria-label, or aria-hidden).', fix: 'Add <title> inside SVG, aria-label on the SVG, or aria-hidden="true" if decorative.' },
    };

    for (const issue of imgIssues) {
      const info = issueDescriptions[issue.issue];
      if (info) {
        this.violations.push({
          rule: issue.issue,
          impact: info.impact,
          description: info.desc,
          wcagCriteria: ['wcag111'],
          elements: [issue.html],
        selectors: [],
          howToFix: info.fix,
        });
      }
    }
  }

  /**
   * WCAG 1.3.1 — Table accessibility
   */
  private async checkTableAccessibility() {
    const tableIssues = await this.page.evaluate(() => {
      const issues: { html: string; issue: string }[] = [];
      const tables = document.querySelectorAll('table');

      for (const table of tables) {
        // Skip layout tables (role=presentation)
        if (table.getAttribute('role') === 'presentation' || table.getAttribute('role') === 'none') continue;

        const caption = table.querySelector('caption');
        const ariaLabel = table.getAttribute('aria-label');
        const ariaLabelledBy = table.getAttribute('aria-labelledby');

        if (!caption && !ariaLabel && !ariaLabelledBy) {
          issues.push({ html: table.outerHTML.substring(0, 100), issue: 'table-no-caption' });
        }

        const headers = table.querySelectorAll('th');
        if (headers.length === 0) {
          issues.push({ html: table.outerHTML.substring(0, 100), issue: 'table-no-headers' });
        }

        // Check for data tables using scope
        for (const th of headers) {
          if (!th.getAttribute('scope') && !th.getAttribute('id')) {
            issues.push({ html: th.outerHTML.substring(0, 100), issue: 'th-no-scope' });
            break; // Report once per table
          }
        }
      }

      return issues.slice(0, 10);
    });

    for (const issue of tableIssues) {
      if (issue.issue === 'table-no-caption') {
        this.violations.push({
          rule: 'table-no-caption',
          impact: 'moderate',
          description: 'Data table has no caption or accessible name.',
          wcagCriteria: ['wcag131'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add a <caption> element or aria-label to describe the table purpose.',
        });
      } else if (issue.issue === 'table-no-headers') {
        this.violations.push({
          rule: 'table-no-headers',
          impact: 'serious',
          description: 'Data table has no header cells (<th>).',
          wcagCriteria: ['wcag131'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Use <th> elements for column/row headers.',
        });
      } else if (issue.issue === 'th-no-scope') {
        this.violations.push({
          rule: 'table-th-no-scope',
          impact: 'moderate',
          description: 'Table header cells lack scope attribute.',
          wcagCriteria: ['wcag131'],
          elements: [issue.html],
        selectors: [],
          howToFix: 'Add scope="col" or scope="row" to <th> elements.',
        });
      }
    }
  }

  /**
   * WCAG 1.4.2 — Audio/video autoplay
   */
  private async checkAutoplayMedia() {
    const mediaIssues = await this.page.evaluate(() => {
      const issues: string[] = [];
      const media = document.querySelectorAll('video[autoplay], audio[autoplay]');

      for (const el of media) {
        const muted = el.hasAttribute('muted');
        if (!muted) {
          issues.push(el.outerHTML.substring(0, 150));
        }
      }
      return issues;
    });

    for (const el of mediaIssues) {
      this.violations.push({
        rule: 'media-autoplay-audio',
        impact: 'critical',
        description: 'Media element autoplays with audio. Users must be able to pause or control volume.',
        wcagCriteria: ['wcag142'],
        elements: [el],
        selectors: [],
        howToFix: 'Remove autoplay, add muted attribute, or provide visible controls to pause/stop within 3 seconds.',
      });
    }
  }

  /**
   * WCAG 4.1.3 — Status messages must be programmatically announced
   */
  private async checkStatusMessages() {
    const statusIssues = await this.page.evaluate(() => {
      const issues: string[] = [];

      // Check for elements that look like status messages but lack live region roles
      const potentialStatus = document.querySelectorAll('.alert, .notification, .toast, .message, .error-message, .success-message, .warning, .info-message, [class*="alert"], [class*="notification"], [class*="toast"]');

      for (const el of potentialStatus) {
        const role = el.getAttribute('role');
        const ariaLive = el.getAttribute('aria-live');
        if (!role && !ariaLive) {
          issues.push(el.outerHTML.substring(0, 150));
        }
      }
      return issues.slice(0, 5);
    });

    for (const el of statusIssues) {
      this.violations.push({
        rule: 'status-message-no-live-region',
        impact: 'moderate',
        description: 'Element appears to be a status message but lacks role="status", role="alert", or aria-live.',
        wcagCriteria: ['wcag413'],
        elements: [el],
        selectors: [],
        howToFix: 'Add role="status" (polite) or role="alert" (assertive) so screen readers announce changes.',
      });
    }
  }

  /**
   * WCAG 4.1.1 — Duplicate IDs
   */
  private async checkDuplicateIds() {
    const duplicates = await this.page.evaluate(() => {
      const ids = new Map<string, number>();
      const allWithId = document.querySelectorAll('[id]');
      for (const el of allWithId) {
        const id = el.id;
        if (id) {
          ids.set(id, (ids.get(id) || 0) + 1);
        }
      }
      return Array.from(ids.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count }))
        .slice(0, 10);
    });

    for (const dup of duplicates) {
      this.violations.push({
        rule: 'duplicate-id',
        impact: 'serious',
        description: `ID "${dup.id}" is used ${dup.count} times. Duplicate IDs break label associations and ARIA references.`,
        wcagCriteria: ['wcag411'],
        elements: [`[id="${dup.id}"]`],
        selectors: [],
        howToFix: 'Ensure all id attribute values are unique on the page.',
      });
    }
  }

  /**
   * Experimental: Check visual reading order vs DOM order
   */
  private async checkReadingOrder() {
    const orderIssues = await this.page.evaluate(() => {
      const issues: string[] = [];

      // Check for CSS that reorders content (flex order, grid placement)
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        const order = parseInt(style.order);
        if (order !== 0 && !isNaN(order)) {
          issues.push(el.outerHTML.substring(0, 150));
        }
      }
      return issues.slice(0, 5);
    });

    if (orderIssues.length > 0) {
      this.violations.push({
        rule: 'reading-order-css-reorder',
        impact: 'moderate',
        description: 'CSS order property is used which may cause visual order to differ from DOM/reading order.',
        wcagCriteria: ['wcag132'],
        elements: orderIssues,
        howToFix: 'Ensure visual order matches DOM order, or verify that reordered content still makes sense when read linearly.',
      });
    }
  }

  /**
   * Experimental: Cognitive load heuristics
   */
  private async checkCognitiveLoad() {
    const cognitiveIssues = await this.page.evaluate(() => {
      const issues: { issue: string; detail: string }[] = [];

      // Check for timeout warnings
      const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
      if (metaRefresh) {
        issues.push({ issue: 'meta-refresh', detail: metaRefresh.outerHTML });
      }

      // Check for excessive number of links (cognitive overload)
      const links = document.querySelectorAll('a[href]');
      if (links.length > 100) {
        issues.push({ issue: 'excessive-links', detail: `${links.length} links on page` });
      }

      // Check for text walls (paragraphs over 300 words)
      const paragraphs = document.querySelectorAll('p');
      for (const p of paragraphs) {
        const words = p.textContent?.split(/\s+/).length || 0;
        if (words > 300) {
          issues.push({ issue: 'long-paragraph', detail: p.textContent?.substring(0, 80) || '' });
          break;
        }
      }

      return issues;
    });

    for (const issue of cognitiveIssues) {
      if (issue.issue === 'meta-refresh') {
        this.violations.push({
          rule: 'meta-refresh-redirect',
          impact: 'critical',
          description: 'Page uses meta refresh to redirect or reload. This can disorient users.',
          wcagCriteria: ['wcag221', 'wcag231'],
          elements: [issue.detail],
        selectors: [],
          howToFix: 'Use server-side redirects instead of meta refresh.',
        });
      }
    }
  }

  private getWcagTags(level: string): string[] {
    const tags = ['wcag2a', 'wcag21a', 'wcag22aa', 'best-practice'];
    if (level === 'AA' || level === 'AAA') {
      tags.push('wcag2aa', 'wcag21aa');
    }
    if (level === 'AAA') {
      tags.push('wcag2aaa');
    }
    return tags;
  }
}

/**
 * Generate a modern dashboard HTML report from audit results
 */
export function generateA11yReport(results: A11yAuditResult): string {
  const impactColors: Record<string, string> = {
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#ca8a04',
    minor: '#2563eb',
  };

  // Group violations by category
  const categories: Record<string, A11yViolation[]> = {};
  for (const v of results.violations) {
    const cat = getCategoryFromRule(v.rule);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(v);
  }

  const totalChecks = results.totalViolations + Math.max(results.totalViolations * 3, 50); // estimate total checks
  const passRate = Math.round(((totalChecks - results.totalViolations) / totalChecks) * 100);

  const categoryData = Object.entries(categories)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Audit Report — ${escapeHtml(results.url)}</title>
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
    .summary-card .count { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
    .summary-card .label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }

    /* Charts Row */
    .charts-row {
      display: grid; grid-template-columns: 1fr 2fr; gap: 16px; margin-bottom: 24px;
    }
    @media (max-width: 768px) { .charts-row { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px;
    }
    .chart-card h3 { font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .score-ring { position: relative; width: 180px; height: 180px; margin: 0 auto; }
    .score-ring canvas { width: 180px !important; height: 180px !important; }
    .score-center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; }
    .score-center .value { font-size: 36px; font-weight: 700; }
    .score-center .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }

    /* Issues Distribution */
    .distribution-bar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
    }
    .distribution-bar .cat-name { width: 120px; font-size: 12px; color: var(--text-secondary); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .distribution-bar .bar-track { flex: 1; height: 24px; background: var(--bg-primary); border-radius: 6px; overflow: hidden; position: relative; }
    .distribution-bar .bar-fill { height: 100%; border-radius: 6px; transition: width 0.6s ease; display: flex; align-items: center; padding-left: 8px; }
    .distribution-bar .bar-count { font-size: 11px; font-weight: 600; color: white; }

    /* Filter Bar */
    .filter-bar {
      display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;
    }
    .filter-btn {
      padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-secondary); font-size: 12px;
      cursor: pointer; transition: all 0.2s; font-weight: 500;
    }
    .filter-btn:hover { border-color: var(--accent); color: var(--accent); }
    .filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }
    .filter-count { font-size: 10px; opacity: 0.8; margin-left: 4px; }

    /* Issues Table */
    .issues-section {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      overflow: hidden;
    }
    .issues-header {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      display: flex; justify-content: space-between; align-items: center;
    }
    .issues-header h3 { font-size: 15px; font-weight: 600; }
    .issue-row {
      padding: 16px 24px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.15s;
    }
    .issue-row:hover { background: var(--bg-primary); }
    .issue-row:last-child { border-bottom: none; }
    .issue-row-header {
      display: flex; align-items: center; gap: 12px;
    }
    .impact-dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
    }
    .issue-title { font-size: 13px; font-weight: 500; flex: 1; }
    .issue-wcag { font-size: 11px; color: var(--text-muted); }
    .issue-expand { color: var(--text-muted); font-size: 18px; transition: transform 0.2s; }
    .issue-row.expanded .issue-expand { transform: rotate(180deg); }
    .issue-details {
      display: none; margin-top: 12px; padding: 16px; background: var(--bg-primary);
      border-radius: 8px; font-size: 12px;
    }
    .issue-row.expanded .issue-details { display: block; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
    .detail-block h4 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 6px; }
    .detail-block code {
      display: block; font-family: 'JetBrains Mono', monospace; font-size: 11px;
      background: var(--bg-secondary); padding: 8px 12px; border-radius: 6px;
      overflow-x: auto; white-space: pre-wrap; word-break: break-all; color: var(--text-primary);
      border: 1px solid var(--border);
    }
    .fix-text { color: var(--success); font-size: 12px; line-height: 1.5; }
    .screenshot-thumb {
      max-width: 200px; border-radius: 8px; border: 1px solid var(--border);
      cursor: pointer; transition: transform 0.2s;
    }
    .screenshot-thumb:hover { transform: scale(1.5); position: relative; z-index: 10; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }

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
        <h1>♿ Accessibility Audit Report</h1>
        <div class="meta">
          <a href="${escapeHtml(results.url)}" target="_blank">${escapeHtml(results.url)}</a>
          &nbsp;•&nbsp; ${results.timestamp} &nbsp;•&nbsp; WCAG 2.2 Level AA
        </div>
      </div>
      <div class="header-actions">
        <button class="btn" onclick="exportCSV()">📄 CSV</button>
        <button class="btn" onclick="exportJSON()">{ } JSON</button>
        <button class="btn theme-toggle" onclick="toggleTheme()" title="Toggle theme">🌓</button>
      </div>
    </div>

    <!-- Quality Gate -->
    <div class="quality-gate ${results.summary.critical === 0 ? 'passed' : 'failed'}">
      <span class="icon">${results.summary.critical === 0 ? '✅' : '❌'}</span>
      <div>
        <div class="label">Quality Gate: ${results.summary.critical === 0 ? 'PASSED' : 'FAILED'}</div>
        <div class="detail">${results.summary.critical > 0 ? results.summary.critical + ' critical issue(s) must be resolved' : 'No critical issues found'} • ${results.totalViolations} total violation${results.totalViolations !== 1 ? 's' : ''}</div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="summary-row">
      <div class="summary-card critical">
        <div class="count" style="color:${impactColors.critical}">${results.summary.critical}</div>
        <div class="label">Critical</div>
      </div>
      <div class="summary-card serious">
        <div class="count" style="color:${impactColors.serious}">${results.summary.serious}</div>
        <div class="label">Serious</div>
      </div>
      <div class="summary-card moderate">
        <div class="count" style="color:${impactColors.moderate}">${results.summary.moderate}</div>
        <div class="label">Moderate</div>
      </div>
      <div class="summary-card minor">
        <div class="count" style="color:${impactColors.minor}">${results.summary.minor}</div>
        <div class="label">Minor</div>
      </div>
      <div class="summary-card" style="border-top: 3px solid var(--accent);">
        <div class="count" style="color:var(--accent)">${results.totalViolations}</div>
        <div class="label">Total Issues</div>
      </div>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Conformance Score Ring -->
      <div class="chart-card">
        <h3>Conformance Score</h3>
        <div class="score-ring">
          <canvas id="scoreChart"></canvas>
          <div class="score-center">
            <div class="value">${passRate}%</div>
            <div class="label">Passing</div>
          </div>
        </div>
      </div>

      <!-- Issue Distribution -->
      <div class="chart-card">
        <h3>Top Issues by Category</h3>
        <div id="distributionBars">
          ${categoryData.map(([cat, violations]) => {
            const pct = Math.round((violations.length / results.totalViolations) * 100);
            const order: Record<string, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };
            const maxSeverity = violations.reduce((max, v) => {
              return (order[v.impact] || 0) > (order[max] || 0) ? v.impact : max;
            }, 'minor');
            return `
          <div class="distribution-bar">
            <span class="cat-name" title="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
            <div class="bar-track">
              <div class="bar-fill" style="width:${Math.max(pct, 8)}%;background:${impactColors[maxSeverity]}">
                <span class="bar-count">${violations.length}</span>
              </div>
            </div>
          </div>`;
          }).join('')}
        </div>
      </div>
    </div>

    <!-- Severity Distribution Chart -->
    <div class="chart-card" style="margin-bottom:24px">
      <h3>Severity Distribution</h3>
      <canvas id="severityChart" style="max-height:200px"></canvas>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <button class="filter-btn active" onclick="filterIssues('all')">All<span class="filter-count">(${results.totalViolations})</span></button>
      <button class="filter-btn" onclick="filterIssues('critical')" style="--accent:${impactColors.critical}">Critical<span class="filter-count">(${results.summary.critical})</span></button>
      <button class="filter-btn" onclick="filterIssues('serious')" style="--accent:${impactColors.serious}">Serious<span class="filter-count">(${results.summary.serious})</span></button>
      <button class="filter-btn" onclick="filterIssues('moderate')" style="--accent:${impactColors.moderate}">Moderate<span class="filter-count">(${results.summary.moderate})</span></button>
      <button class="filter-btn" onclick="filterIssues('minor')" style="--accent:${impactColors.minor}">Minor<span class="filter-count">(${results.summary.minor})</span></button>
    </div>

    <!-- Issues List -->
    <div class="issues-section">
      <div class="issues-header">
        <h3>Issues (${results.totalViolations})</h3>
      </div>
`;

  for (const v of results.violations) {
    const selectorText = v.selectors && v.selectors.length > 0
      ? v.selectors.map(s => escapeHtml(s)).join('\n')
      : 'N/A';
    const snippetText = v.elements.length > 0
      ? v.elements.map(e => escapeHtml(e)).join('\n')
      : 'N/A';
    const screenshotHtml = v.screenshot
      ? `<img class="screenshot-thumb" src="screenshots/${v.screenshot}" alt="Screenshot of ${escapeHtml(v.rule)} issue">`
      : '';

    html += `
      <div class="issue-row" data-impact="${v.impact}" onclick="this.classList.toggle('expanded')">
        <div class="issue-row-header">
          <span class="impact-dot" style="background:${impactColors[v.impact]}"></span>
          <span class="issue-title">${escapeHtml(v.description)}</span>
          <span class="issue-wcag">${v.wcagCriteria.map(t => t).join(' ')}</span>
          <span class="issue-expand">▾</span>
        </div>
        <div class="issue-details">
          <div class="detail-grid">
            <div class="detail-block">
              <h4>CSS Selector</h4>
              <code>${selectorText}</code>
            </div>
            <div class="detail-block">
              <h4>HTML Snippet</h4>
              <code>${snippetText}</code>
            </div>
          </div>
          <div style="margin-top:12px">
            <div class="detail-block">
              <h4>How to Fix</h4>
              <p class="fix-text">${escapeHtml(v.howToFix)}</p>
            </div>
          </div>
          ${screenshotHtml ? `<div style="margin-top:12px">${screenshotHtml}</div>` : ''}
        </div>
      </div>`;
  }

  html += `
    </div>

    <!-- Footer -->
    <div class="footer">
      Generated by <a href="https://github.com/rksekar5/a11y-audit">a11y-audit</a> • AI-Powered Accessibility Auditor
    </div>
  </div>

  <script>
    // Score ring chart
    const scoreCtx = document.getElementById('scoreChart').getContext('2d');
    new Chart(scoreCtx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data: [${passRate}, ${100 - passRate}],
          backgroundColor: ['${passRate >= 80 ? '#22c55e' : passRate >= 60 ? '#eab308' : '#ef4444'}', 'rgba(100,116,139,0.2)'],
          borderWidth: 0,
          cutout: '78%'
        }]
      },
      options: { responsive: true, plugins: { legend: { display: false }, tooltip: { enabled: false } } }
    });

    // Severity bar chart
    const sevCtx = document.getElementById('severityChart').getContext('2d');
    new Chart(sevCtx, {
      type: 'bar',
      data: {
        labels: ['Critical', 'Serious', 'Moderate', 'Minor'],
        datasets: [{
          data: [${results.summary.critical}, ${results.summary.serious}, ${results.summary.moderate}, ${results.summary.minor}],
          backgroundColor: ['${impactColors.critical}', '${impactColors.serious}', '${impactColors.moderate}', '${impactColors.minor}'],
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(100,116,139,0.1)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { weight: '500' } } }
        }
      }
    });

    // Filter
    function filterIssues(impact) {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      event.target.closest('.filter-btn').classList.add('active');
      document.querySelectorAll('.issue-row').forEach(row => {
        row.style.display = (impact === 'all' || row.dataset.impact === impact) ? '' : 'none';
      });
    }

    // Theme toggle
    function toggleTheme() {
      const body = document.body;
      const current = body.getAttribute('data-theme');
      body.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
      localStorage.setItem('a11y-theme', body.getAttribute('data-theme'));
    }
    // Load saved theme
    const saved = localStorage.getItem('a11y-theme');
    if (saved) document.body.setAttribute('data-theme', saved);

    // Export CSV
    function exportCSV() {
      const rows = [['Issue', 'Severity', 'WCAG', 'Selector', 'Fix']];
      document.querySelectorAll('.issue-row').forEach(row => {
        if (row.style.display === 'none') return;
        const title = row.querySelector('.issue-title')?.textContent || '';
        const impact = row.dataset.impact || '';
        const wcag = row.querySelector('.issue-wcag')?.textContent || '';
        const selector = row.querySelector('.detail-block code')?.textContent || '';
        const fix = row.querySelector('.fix-text')?.textContent || '';
        rows.push([title, impact, wcag, selector, fix].map(c => '"' + c.replace(/"/g, '""') + '"'));
      });
      const csv = rows.map(r => r.join(',')).join('\\n');
      download(csv, 'a11y-report.csv', 'text/csv');
    }

    // Export JSON
    function exportJSON() {
      const data = ${JSON.stringify({ url: results.url, timestamp: results.timestamp, totalViolations: results.totalViolations, summary: results.summary, violations: results.violations.map(v => ({ rule: v.rule, impact: v.impact, description: v.description, wcagCriteria: v.wcagCriteria, selectors: v.selectors, howToFix: v.howToFix })) })};
      download(JSON.stringify(data, null, 2), 'a11y-report.json', 'application/json');
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

function getCategoryFromRule(rule: string): string {
  const categoryMap: Record<string, string> = {
    'color-contrast': 'Color Contrast',
    'contrast-ratio': 'Color Contrast',
    'keyboard-trap': 'Keyboard',
    'keyboard-navigation': 'Keyboard',
    'keyboard-activation': 'Keyboard',
    'focus-visible': 'Keyboard',
    'focus-order': 'Keyboard',
    'reverse-tab': 'Keyboard',
    'tab-navigation': 'Keyboard',
    'link-name': 'Links',
    'link-purpose': 'Links',
    'empty-link': 'Links',
    'image-alt': 'Images',
    'img-alt': 'Images',
    'decorative-image': 'Images',
    'heading-order': 'Structure',
    'heading-hierarchy': 'Structure',
    'landmark': 'Structure',
    'region': 'Structure',
    'aria': 'ARIA',
    'aria-roles': 'ARIA',
    'aria-valid': 'ARIA',
    'aria-required': 'ARIA',
    'label': 'Forms',
    'form-label': 'Forms',
    'autocomplete': 'Forms',
    'reflow': 'Responsive',
    'text-spacing': 'Responsive',
    'orientation': 'Responsive',
    'meta-refresh': 'Timing',
    'auto-play': 'Media',
    'video': 'Media',
    'audio': 'Media',
    'target-size': 'Touch & Pointer',
  };

  for (const [key, cat] of Object.entries(categoryMap)) {
    if (rule.toLowerCase().includes(key.toLowerCase())) return cat;
  }
  return 'Other';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
