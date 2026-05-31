/**
 * Generate an HTML trend report from stored data.
 * Usage: npx ts-node scripts/generate-trend-report.ts [--output=path/to/report.html]
 */
import { TrendTracker } from '../utils/trend-tracker';
import * as path from 'path';
import * as fs from 'fs';

const args = process.argv.slice(2);
const outputPath = args.find(a => a.startsWith('--output='))?.split('=')[1]
  || 'test-results/a11y-reports/trend-report.html';

const tracker = new TrendTracker({
  storePath: path.resolve(__dirname, '../.a11y-trends/history.json'),
});

const entries = tracker.getEntries();
if (entries.length === 0) {
  console.log('No trend data found. Run an audit first.');
  process.exit(0);
}

const html = tracker.generateTrendReport({ limit: 50 });
const fullOutputPath = path.resolve(__dirname, '..', outputPath);
const dir = path.dirname(fullOutputPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(fullOutputPath, html);
console.log(`✅ Trend report generated: ${fullOutputPath}`);
console.log(`   ${entries.length} entries tracked`);
