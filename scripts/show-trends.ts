/**
 * CLI script to display trend data in the terminal.
 * Usage: npx ts-node scripts/show-trends.ts [--limit=10] [--url=<filter>]
 */
import { TrendTracker } from '../utils/trend-tracker';
import * as path from 'path';

const args = process.argv.slice(2);
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '10', 10);
const urlFilter = args.find(a => a.startsWith('--url='))?.split('=')[1];

const tracker = new TrendTracker({
  storePath: path.resolve(__dirname, '../.a11y-trends/history.json'),
});

const entries = tracker.getEntries({ url: urlFilter, limit });

if (entries.length === 0) {
  console.log('No trend data found. Run an audit first:');
  console.log('  npm run test:crawl');
  console.log('  npm run test:ci');
  process.exit(0);
}

console.log('┌─────────────────────────────────────────────────────────────────────────────────┐');
console.log('│                        ACCESSIBILITY TREND HISTORY                               │');
console.log('├────────────────────┬──────────────┬──────┬──────┬──────┬──────┬──────┬──────────┤');
console.log('│ Date               │ URL          │ Total│ Crit │ Ser  │ Mod  │ Min  │ Pages    │');
console.log('├────────────────────┼──────────────┼──────┼──────┼──────┼──────┼──────┼──────────┤');

for (const entry of entries) {
  const date = new Date(entry.timestamp).toLocaleString().padEnd(18).substring(0, 18);
  const url = entry.url.replace(/https?:\/\//, '').substring(0, 12).padEnd(12);
  const total = String(entry.totalViolations).padStart(4);
  const crit = String(entry.critical).padStart(4);
  const ser = String(entry.serious).padStart(4);
  const mod = String(entry.moderate).padStart(4);
  const min = String(entry.minor).padStart(4);
  const pages = String(entry.pagesAudited).padStart(6);
  console.log(`│ ${date} │ ${url} │ ${total} │ ${crit} │ ${ser} │ ${mod} │ ${min} │ ${pages}   │`);
}

console.log('└────────────────────┴──────────────┴──────┴──────┴──────┴──────┴──────┴──────────┘');

// Show comparison if we have previous data
const comparison = tracker.compare();
if (comparison?.previous) {
  console.log('\n📊 Latest vs Previous:');
  const { changes } = comparison;
  const icon = (t: string) => t === 'improved' ? '✅' : t === 'regressed' ? '🔴' : '➖';
  console.log(`   Total: ${changes.totalViolations.value} ${icon(changes.totalViolations.trend)} (${changes.totalViolations.delta >= 0 ? '+' : ''}${changes.totalViolations.delta})`);
  console.log(`   Critical: ${changes.critical.value} ${icon(changes.critical.trend)}`);
  console.log(`   Serious: ${changes.serious.value} ${icon(changes.serious.trend)}`);

  if (comparison.newIssues.length > 0) {
    console.log(`\n   🆕 New issues: ${comparison.newIssues.join(', ')}`);
  }
  if (comparison.resolvedIssues.length > 0) {
    console.log(`   ✅ Resolved: ${comparison.resolvedIssues.join(', ')}`);
  }
}
