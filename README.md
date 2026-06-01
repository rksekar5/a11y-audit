<p align="center">
  <img src="https://img.shields.io/badge/AI-Agentic%20Auditor-blueviolet?style=flat-square" alt="AI-Powered">
  <img src="https://img.shields.io/badge/WCAG-2.0%20|%202.1%20|%202.2-blue?style=flat-square" alt="WCAG Coverage">
  <img src="https://img.shields.io/badge/checks-22%20custom%20+%20axe--core-orange?style=flat-square" alt="Custom Checks">
  <img src="https://img.shields.io/badge/CI-GitHub%20Actions-green?style=flat-square" alt="CI Integration">
  <img src="https://img.shields.io/badge/cost-free%20%26%20open--source-brightgreen?style=flat-square" alt="Free">
</p>

# ♿ a11y-audit

**An AI-powered accessibility agent that finds what automation can't.**

Most automated tools catch ~30% of real accessibility issues. This framework combines an **agentic AI auditor** with 22 custom WCAG checks to find keyboard traps, missing focus indicators, contrast failures, and interaction bugs that commercial tools flag as "needs manual review."

```
@a11y audit https://your-site.com
```

The AI agent navigates your site, reasons about what disabled users would experience, and generates actionable reports — no manual testing required.

---

## What Makes This Different

| | axe-core | BrowserStack | Lighthouse | **a11y-audit** |
|---|---|---|---|---|
| Automated rule checks | ✅ | ✅ | ✅ | ✅ |
| Keyboard trap detection | ❌ | ❌ | ❌ | **✅ (actual Tab cycling)** |
| AI-powered reasoning | ❌ | ❌ | ❌ | **✅** |
| Context-aware analysis | ❌ | ❌ | ❌ | **✅** |
| Site-wide crawling | ❌ | ✅ (paid) | ❌ | **✅** |
| CI quality gates | ❌ | ✅ (paid) | ❌ | **✅** |
| Trend tracking | ❌ | ✅ (paid) | ❌ | **✅** |
| Cost | Free | $$$$ | Free | **Free** |

### The AI agent catches issues tools miss

```
axe-core says:       "2 color contrast issues"
a11y-audit agent:    "Keyboard trap in cookie consent layer, 10 interactive 
                      elements unreachable by keyboard, hero video autoplays 
                      with no pause control, heading hierarchy broken"
```

---

## How It Works

The framework has two layers:

**1. Rule Engine** — Deterministic checks that run fast and reliably
- axe-core baseline (WCAG 2.0/2.1/2.2 A/AA/AAA)
- 22 custom checks automation tools skip

**2. AI Agent** — Reasons about context, user impact, and interaction patterns
- Navigates the page with a real browser
- Walks the accessibility tree to understand structure
- Tab-walks through focusable elements to detect traps
- Screenshots visual issues (focus rings, contrast, target sizes)
- Generates prioritized findings with fix recommendations

---

## 22 Custom Checks (Beyond axe-core)

These are issues that require **interaction or reasoning** — exactly what the AI agent provides:

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

### Audit with the AI Agent (Recommended)

Open VS Code Copilot Chat and type:

```
@a11y audit https://your-site.com
```

The agent will:
1. Open the page in a real browser
2. Analyze the accessibility tree
3. Run axe-core + 22 custom checks
4. Keyboard-walk to detect traps
5. Screenshot visual issues
6. Generate a structured report with fix recommendations

### Audit via CLI

```bash
# Full audit on a single page
npm run test:deep

# Crawl & audit an entire site
npm run test:crawl

# Audit a custom URL
AUDIT_URL=https://your-site.com npm run test:deep
```

### View trends

```bash
npm run trends            # Terminal summary
npm run trends:report     # HTML chart report
```

---

## CI Integration

Block PRs that introduce accessibility regressions:

```yaml
# .github/workflows/a11y-audit.yml (included)
# Triggers on push/PR or manually with custom URL
# Posts a PR comment with findings + quality gate
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

## Real-World Results

Audit of **porsche.com/germany** found **29 violations** (2 critical, 22 serious):

| Finding | WCAG | Severity |
|---------|------|----------|
| Keyboard trap in cookie consent layer | 2.1.2 | Critical |
| Hero video autoplays with no pause control | 1.4.2 | Critical |
| 10 clickable elements not keyboard accessible | 2.1.1 | Serious |
| 7 links with no accessible name | 2.4.4 | Serious |
| Hero heading contrast ratio 1.03:1 | 1.4.3 | Serious |

*axe-core alone found only 6 of these 29 issues.*

---

## AI Agent Commands

| Command | What it does |
|---------|---|
| `@a11y audit <url>` | Full AI-powered audit with reasoning |
| `@a11y audit <url> --level AAA` | Strict AAA conformance |
| `@a11y scan <url>` | Quick axe-core only (fast) |
| `@a11y keyboard-test <url>` | Focus on keyboard navigation only |
| `@a11y compare <url1> <url2>` | Compare accessibility of two pages |

The agent is available in:

| IDE / Tool | Config | Usage |
|-----------|--------|-------|
| VS Code (Copilot) | `.github/agents/a11y.agent.md` | `@a11y` in chat |
| Cursor | `.cursorrules` | Auto-loaded |
| Claude Code | `CLAUDE.md` | Auto-loaded |
---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  AI Agent Layer                   │
│  (Reasons about context, user impact, patterns)  │
├─────────────────────────────────────────────────┤
│              Rule Engine Layer                    │
│  axe-core + 22 custom WCAG checks               │
├─────────────────────────────────────────────────┤
│            Playwright (Browser)                   │
│  Navigation, interaction, screenshots, DOM       │
├─────────────────────────────────────────────────┤
│         Reporting & Tracking Layer               │
│  HTML reports, trend history, CI quality gates   │
└─────────────────────────────────────────────────┘
```

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
├── .github/
│   ├── agents/a11y.agent.md        # AI agent definition
│   └── workflows/a11y-audit.yml    # CI workflow
└── .a11y-trends/
    └── history.json                # Audit history for trend analysis
```

---

## Reports

Every audit produces an interactive HTML report with:
- Severity filtering (critical / serious / moderate / minor)
- CSS selectors for each violation
- HTML snippets of affected elements
- Specific fix recommendations with code examples
- Screenshots for visual issues (focus, contrast, target size)
- Trend comparison (new / resolved issues since last run)

---

## Contributing

1. Fork & clone
2. `npm install && npx playwright install`
3. `npm run test:deep` to verify setup
4. Make changes, run `npm test`
5. Open a PR — the CI will run the accessibility audit on your changes

---

## License

MIT
