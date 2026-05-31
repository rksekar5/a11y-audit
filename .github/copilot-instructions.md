# A11y Audit - Copilot Instructions

## Context
This is a standalone accessibility audit project using Playwright + axe-core + a custom AI-powered agent via Copilot.

## Conventions
- Use `@playwright/test` as the test runner
- Use `@axe-core/playwright` for baseline automated checks
- Custom checks beyond axe-core are in `utils/accessibility-audit.ts`
- Use the `@a11y` agent for AI-powered auditing via Copilot chat

## Locator Priority
When detecting/identifying elements, use this priority order:
1. `getByRole()` - accessibility roles
2. `getByLabel()` - form elements by label
3. `getByTestId()` - data-testid attributes
4. `locator()` with CSS - only as last resort

## Test Structure
- `tests/` — test specs
- `utils/` — audit engine and helpers
- `fixtures/` — reusable test fixtures
- `.github/agents/` — Copilot custom agent definition

## Reports
- HTML reports go to `test-results/a11y-reports/`
- Screenshots for visual issues go to `test-results/a11y-reports/screenshots/`
- Reports use a table format with columns: Issue Type, Severity, CSS Selector, HTML Snippet, Fix, Screenshot
