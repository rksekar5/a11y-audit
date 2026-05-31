# A11y Audit

## Context
Accessibility audit framework: Playwright + axe-core + 22 custom WCAG checks + site crawler + trend tracking.

## Conventions
- Test runner: `@playwright/test`
- Baseline checks: `@axe-core/playwright`
- Custom engine: `utils/accessibility-audit.ts`
- Contrast calculation: `utils/contrast-ratio.ts` (WCAG relative luminance formula)
- Site crawler: `utils/site-crawler.ts`
- Trend storage: `utils/trend-tracker.ts` (JSON-based in `.a11y-trends/`)

## Locator Priority
1. `getByRole()` - accessibility roles
2. `getByLabel()` - form elements by label
3. `getByTestId()` - data-testid attributes
4. `locator()` with CSS - last resort

## Structure
- `tests/` — test specs (deep, crawl, ci)
- `utils/` — audit engine, contrast, crawler, trends
- `fixtures/` — reusable Playwright fixtures
- `scripts/` — CLI tools (show-trends, generate-trend-report)
- `.github/workflows/` — CI with PR comments

## Commands
- `npm run test:deep` — full WCAG audit on single page
- `npm run test:crawl` — crawl + audit entire site
- `npm run test:ci` — CI pipeline audit (chromium only)
- `npm run trends` — view trend history in terminal

## Reports
- HTML reports → `test-results/a11y-reports/`
- Screenshots → `test-results/a11y-reports/screenshots/`
- Trend data → `.a11y-trends/history.json`
