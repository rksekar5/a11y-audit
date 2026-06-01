/**
 * @a11y-audit/playwright — AI-powered accessibility audit framework
 *
 * Usage:
 *   import { AccessibilityAudit, generateA11yReport } from '@a11y-audit/playwright';
 *   import { test } from '@a11y-audit/playwright/fixture';
 */

// Core audit engine
export {
  AccessibilityAudit,
  generateA11yReport,
  type A11yViolation,
  type A11yAuditResult,
} from './utils/accessibility-audit';

// Contrast utilities
export {
  parseColor,
  contrastRatio,
  alphaBlend,
  relativeLuminance,
  isLargeText,
  getRequiredRatio,
  checkContrast,
  CONTRAST_EXTRACTION_SCRIPT,
  type RGBColor,
  type ContrastResult,
  type ElementContrastInfo,
} from './utils/contrast-ratio';

// Site crawler
export {
  SiteCrawler,
  generateCrawlReport,
  type CrawlOptions,
  type CrawlResult,
  type CrawlProgress,
} from './utils/site-crawler';

// Trend tracker
export {
  TrendTracker,
  type TrendEntry,
  type TrendData,
  type TrendComparison,
} from './utils/trend-tracker';
