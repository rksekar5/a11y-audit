<p align="center">
  <img src="https://img.shields.io/badge/WCAG-2.0%20|%202.1%20|%202.2-blue?style=flat-square" alt="WCAG Coverage">
  <img src="https://img.shields.io/badge/engine-Playwright%20+%20axe--core-green?style=flat-square" alt="Engine">
  <img src="https://img.shields.io/badge/checks-22%20custom%20rules-orange?style=flat-square" alt="Custom Checks">
  <img src="https://img.shields.io/badge/cost-free%20%26%20open--source-brightgreen?style=flat-square" alt="Free">
</p>

# ♿ a11y-audit

A zero-cost accessibility audit framework that catches issues commercial tools miss — keyboard traps, contrast ratio failures, reflow bugs, and more — all automated with Playwright.

---

## Why This Exists

Automated tools like axe-core catch ~30% of WCAG issues. This framework extends that with **22 additional checks** that normally require manual testing:

| Check | WCAG | What Commercial Tools Do |
|-------|------|--------------------------|
| Keyboard trap detection (actual Tab cycling) | 2.1.2 | Flag for manual review |
| Reverse Tab navigation | 2.1.1 | Not tested |
| Enter/Space activation | 2.1.1 | Not tested |
| Actual contrast ratio math | 1.4.3 | ✓ (paid) |
| Content reflow at 320px | 1.4.10 | Flag for manual review |
| Text spacing override test | 1.4.12 | Flag for manual review |
| Site-wide crawling | — | ✓ (paid) |
| Trend tracking | — | ✓ (paid) |

---

## Quick Start

```bash
npm install
npx playwright install
```

### Run an audit

```bash
# Full audit on a single page
npm run test:deep

# Crawl & audit an entire site
npm run test:crawl

# Audit a custom URL
CRAWL_URL=https://your-site.com npm run test:crawl
```

### View trends

```bash
npm run trends            # Terminal summary
npm run trends:report     # HTML chart report
```

---

## CI Integration

Add the included GitHub Action to get PR comments with accessibility results:

```yaml
# .github/workflows/a11y-audit.yml (included)
# Triggers on PRs, posts a comment with:
# - Severity breakdown (critical/serious/moderate/minor)
# - Delta from previous run
# - New & resolved issues
# - Pass/fail quality gate
```

<details>
<summary>Example PR comment</summary>

```
## ♿ Accessibility Audit Results

| Severity | Count | Change |
|----------|-------|--------|
| 🔴 Critical | 0 | ✅ |
| 🟠 Serious | 2 | ✅ (-1) |
| 🟡 Moderate | 5 | ➖ |
| 🔵 Minor | 3 | 🔴 (+1) |

### ✅ Quality Gate: PASSED
```

</details>

---

## AI Agent Integration

The framework includes custom AI agent configurations for interactive accessibility auditing:

| IDE / Tool | File | Usage |
|-----------|------|-------|
| GitHub Copilot | `.github/agents/a11y.agent.md` | Type `@a11y` in Copilot Chat |
| Cursor | `.cursorrules` | Auto-loaded in Cursor IDE |
| Claude Code | `CLAUDE.md` | Auto-loaded by Claude |

The `@a11y` agent can navigate to any URL, run the full audit, analyze the accessibility tree, and generate a structured report — all from chat.

> **Note:** The audit framework works fully without any AI tool. The agents are an optional enhancement for interactive use.

---

## Project Structure

```
├── utils/
│   ├── accessibility-audit.ts   # Core engine (axe-core + 22 custom checks)
│   ├── contrast-ratio.ts        # WCAG relative luminance calculation
│   ├── site-crawler.ts          # Sitemap + link-following crawler
│   └── trend-tracker.ts         # JSON-based trend storage & reporting
├── tests/
│   ├── deep-accessibility.spec.ts   # Full WCAG AA audit tests
│   ├── site-crawl.spec.ts          # Site-wide crawl tests
│   └── ci-audit.spec.ts            # CI pipeline test
├── fixtures/
│   └── a11y.fixture.ts             # Reusable Playwright fixture
├── scripts/
│   ├── show-trends.ts              # CLI trend viewer
│   └── generate-trend-report.ts    # HTML report generator
└── .github/
    └── workflows/a11y-audit.yml    # GitHub Action with PR comments
```

---

## Reports

Every audit produces an interactive HTML report with severity filtering, CSS selectors, code snippets, and fix suggestions. Crawl audits include a site-wide overview with per-page breakdowns.

---

## License

MIT
