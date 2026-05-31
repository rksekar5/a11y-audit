import * as fs from 'fs';
import * as path from 'path';
import { A11yAuditResult } from './accessibility-audit';
import { CrawlResult } from './site-crawler';

export interface TrendEntry {
  id: string;
  timestamp: string;
  url: string;
  gitBranch?: string;
  gitCommit?: string;
  totalViolations: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  pagesAudited: number;
  topIssues: { rule: string; count: number }[];
}

export interface TrendData {
  projectName: string;
  entries: TrendEntry[];
}

export interface TrendComparison {
  current: TrendEntry;
  previous: TrendEntry | null;
  changes: {
    totalViolations: { value: number; delta: number; trend: 'improved' | 'regressed' | 'unchanged' };
    critical: { value: number; delta: number; trend: 'improved' | 'regressed' | 'unchanged' };
    serious: { value: number; delta: number; trend: 'improved' | 'regressed' | 'unchanged' };
    moderate: { value: number; delta: number; trend: 'improved' | 'regressed' | 'unchanged' };
    minor: { value: number; delta: number; trend: 'improved' | 'regressed' | 'unchanged' };
  };
  newIssues: string[];
  resolvedIssues: string[];
}

const DEFAULT_STORE_PATH = '.a11y-trends/history.json';

/**
 * Trend tracker that stores accessibility audit results over time
 * and provides comparison/reporting capabilities.
 */
export class TrendTracker {
  private storePath: string;
  private data: TrendData;

  constructor(options?: { storePath?: string; projectName?: string }) {
    this.storePath = options?.storePath ?? DEFAULT_STORE_PATH;
    this.data = this.loadData(options?.projectName ?? 'a11y-audit');
  }

  /**
   * Record a single page audit result
   */
  recordAudit(result: A11yAuditResult, meta?: { gitBranch?: string; gitCommit?: string }): TrendEntry {
    const entry: TrendEntry = {
      id: this.generateId(),
      timestamp: result.timestamp || new Date().toISOString(),
      url: result.url,
      gitBranch: meta?.gitBranch,
      gitCommit: meta?.gitCommit,
      totalViolations: result.totalViolations,
      critical: result.summary.critical,
      serious: result.summary.serious,
      moderate: result.summary.moderate,
      minor: result.summary.minor,
      pagesAudited: 1,
      topIssues: this.extractTopIssues(result),
    };

    this.data.entries.push(entry);
    this.saveData();
    return entry;
  }

  /**
   * Record a crawl result (multi-page audit)
   */
  recordCrawl(result: CrawlResult, meta?: { gitBranch?: string; gitCommit?: string }): TrendEntry {
    const primaryUrl = result.pageResults[0]?.url ?? 'unknown';
    const entry: TrendEntry = {
      id: this.generateId(),
      timestamp: result.startTime,
      url: primaryUrl,
      gitBranch: meta?.gitBranch,
      gitCommit: meta?.gitCommit,
      totalViolations: result.summary.totalViolations,
      critical: result.summary.critical,
      serious: result.summary.serious,
      moderate: result.summary.moderate,
      minor: result.summary.minor,
      pagesAudited: result.pagesAudited,
      topIssues: result.summary.topIssues.slice(0, 10).map(i => ({ rule: i.rule, count: i.count })),
    };

    this.data.entries.push(entry);
    this.saveData();
    return entry;
  }

  /**
   * Compare the latest entry with the previous one (or a specific entry)
   */
  compare(currentId?: string): TrendComparison | null {
    if (this.data.entries.length === 0) return null;

    const sorted = [...this.data.entries].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const current = currentId
      ? sorted.find(e => e.id === currentId) ?? sorted[0]
      : sorted[0];

    const currentIdx = sorted.indexOf(current);
    const previous = sorted[currentIdx + 1] ?? null;

    const trend = (curr: number, prev: number | undefined): 'improved' | 'regressed' | 'unchanged' => {
      if (prev === undefined) return 'unchanged';
      if (curr < prev) return 'improved';
      if (curr > prev) return 'regressed';
      return 'unchanged';
    };

    const currentIssues = new Set(current.topIssues.map(i => i.rule));
    const previousIssues = new Set(previous?.topIssues.map(i => i.rule) ?? []);

    return {
      current,
      previous,
      changes: {
        totalViolations: {
          value: current.totalViolations,
          delta: current.totalViolations - (previous?.totalViolations ?? 0),
          trend: trend(current.totalViolations, previous?.totalViolations),
        },
        critical: {
          value: current.critical,
          delta: current.critical - (previous?.critical ?? 0),
          trend: trend(current.critical, previous?.critical),
        },
        serious: {
          value: current.serious,
          delta: current.serious - (previous?.serious ?? 0),
          trend: trend(current.serious, previous?.serious),
        },
        moderate: {
          value: current.moderate,
          delta: current.moderate - (previous?.moderate ?? 0),
          trend: trend(current.moderate, previous?.moderate),
        },
        minor: {
          value: current.minor,
          delta: current.minor - (previous?.minor ?? 0),
          trend: trend(current.minor, previous?.minor),
        },
      },
      newIssues: [...currentIssues].filter(i => !previousIssues.has(i)),
      resolvedIssues: [...previousIssues].filter(i => !currentIssues.has(i)),
    };
  }

  /**
   * Get all entries, optionally filtered
   */
  getEntries(filter?: { url?: string; branch?: string; limit?: number }): TrendEntry[] {
    let entries = [...this.data.entries];

    if (filter?.url) {
      entries = entries.filter(e => e.url.includes(filter.url!));
    }
    if (filter?.branch) {
      entries = entries.filter(e => e.gitBranch === filter.branch);
    }

    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (filter?.limit) {
      entries = entries.slice(0, filter.limit);
    }

    return entries;
  }

  /**
   * Generate a markdown summary for CI comments
   */
  generateMarkdownSummary(comparison?: TrendComparison | null): string {
    const comp = comparison ?? this.compare();
    if (!comp) return '## Accessibility Audit\n\nNo previous data to compare.';

    const { current, changes } = comp;
    const trendIcon = (t: string) => t === 'improved' ? '✅' : t === 'regressed' ? '🔴' : '➖';
    const deltaStr = (d: number) => d === 0 ? '' : d > 0 ? ` (+${d})` : ` (${d})`;

    let md = `## ♿ Accessibility Audit Results\n\n`;
    md += `**URL:** ${current.url}\n`;
    md += `**Pages Audited:** ${current.pagesAudited}\n`;
    md += `**Date:** ${current.timestamp}\n`;
    if (current.gitCommit) md += `**Commit:** \`${current.gitCommit.substring(0, 7)}\`\n`;
    md += '\n';

    md += `### Summary\n\n`;
    md += `| Severity | Count | Change |\n`;
    md += `|----------|-------|--------|\n`;
    md += `| 🔴 Critical | ${changes.critical.value} | ${trendIcon(changes.critical.trend)}${deltaStr(changes.critical.delta)} |\n`;
    md += `| 🟠 Serious | ${changes.serious.value} | ${trendIcon(changes.serious.trend)}${deltaStr(changes.serious.delta)} |\n`;
    md += `| 🟡 Moderate | ${changes.moderate.value} | ${trendIcon(changes.moderate.trend)}${deltaStr(changes.moderate.delta)} |\n`;
    md += `| 🔵 Minor | ${changes.minor.value} | ${trendIcon(changes.minor.trend)}${deltaStr(changes.minor.delta)} |\n`;
    md += `| **Total** | **${changes.totalViolations.value}** | ${trendIcon(changes.totalViolations.trend)}${deltaStr(changes.totalViolations.delta)} |\n\n`;

    if (comp.newIssues.length > 0) {
      md += `### 🆕 New Issues\n`;
      for (const issue of comp.newIssues) {
        md += `- \`${issue}\`\n`;
      }
      md += '\n';
    }

    if (comp.resolvedIssues.length > 0) {
      md += `### ✅ Resolved Issues\n`;
      for (const issue of comp.resolvedIssues) {
        md += `- ~~\`${issue}\`~~\n`;
      }
      md += '\n';
    }

    // Gate check
    if (changes.critical.value > 0 || changes.serious.value > 0) {
      md += `### ❌ Quality Gate: FAILED\n`;
      md += `> Blocking issues found: ${changes.critical.value} critical, ${changes.serious.value} serious\n`;
    } else {
      md += `### ✅ Quality Gate: PASSED\n`;
      md += `> No critical or serious accessibility issues.\n`;
    }

    return md;
  }

  /**
   * Generate an HTML trend report with charts
   */
  generateTrendReport(options?: { limit?: number }): string {
    const entries = this.getEntries({ limit: options?.limit ?? 30 }).reverse(); // oldest first for chart

    const labels = entries.map(e => new Date(e.timestamp).toLocaleDateString());
    const critical = entries.map(e => e.critical);
    const serious = entries.map(e => e.serious);
    const moderate = entries.map(e => e.moderate);
    const minor = entries.map(e => e.minor);
    const totals = entries.map(e => e.totalViolations);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Accessibility Trend Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #fafafa; }
    h1 { color: #1a237e; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
    .stat-card { background: white; border-radius: 8px; padding: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 28px; font-weight: bold; }
    .stat-label { color: #666; font-size: 13px; }
    .trend-positive { color: #2e7d32; }
    .trend-negative { color: #d32f2f; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; }
    th { background: #1a237e; color: white; padding: 10px; text-align: left; font-size: 12px; }
    td { padding: 8px 10px; border-bottom: 1px solid #eee; font-size: 13px; }
    .sparkline { display: inline-flex; align-items: end; gap: 2px; height: 30px; }
    .sparkline-bar { width: 8px; background: #1a237e; border-radius: 2px; transition: height 0.3s; }
  </style>
</head>
<body>
  <h1>Accessibility Trend Report</h1>
  <p style="color:#666">${this.data.projectName} — ${entries.length} audits tracked</p>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-value">${entries.length > 0 ? entries[entries.length - 1].totalViolations : 0}</div>
      <div class="stat-label">Current Total Issues</div>
      ${entries.length >= 2 ? `<div class="${totals[totals.length - 1] <= totals[totals.length - 2] ? 'trend-positive' : 'trend-negative'}">${totals[totals.length - 1] - totals[totals.length - 2] <= 0 ? '↓' : '↑'} ${Math.abs(totals[totals.length - 1] - totals[totals.length - 2])} from last</div>` : ''}
    </div>
    <div class="stat-card">
      <div class="stat-value">${entries.length > 0 ? entries[entries.length - 1].critical : 0}</div>
      <div class="stat-label">Critical Issues</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${entries.length}</div>
      <div class="stat-label">Total Audits</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${entries.length >= 2 ? Math.round(((totals[0] - totals[totals.length - 1]) / Math.max(totals[0], 1)) * 100) : 0}%</div>
      <div class="stat-label">Overall Improvement</div>
    </div>
  </div>

  <div class="chart-container">
    <h2 style="margin-top:0">Violations Over Time</h2>
    <canvas id="trendChart" height="80"></canvas>
  </div>

  <h2>Audit History</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>URL</th>
        <th>Branch</th>
        <th>Total</th>
        <th>Critical</th>
        <th>Serious</th>
        <th>Moderate</th>
        <th>Minor</th>
        <th>Pages</th>
      </tr>
    </thead>
    <tbody>
      ${[...entries].reverse().map(e => `
        <tr>
          <td>${new Date(e.timestamp).toLocaleString()}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.url)}</td>
          <td>${e.gitBranch || '—'}</td>
          <td><strong>${e.totalViolations}</strong></td>
          <td style="color:#d32f2f">${e.critical}</td>
          <td style="color:#f57c00">${e.serious}</td>
          <td style="color:#fbc02d">${e.moderate}</td>
          <td style="color:#1976d2">${e.minor}</td>
          <td>${e.pagesAudited}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <script>
    const ctx = document.getElementById('trendChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [
          { label: 'Critical', data: ${JSON.stringify(critical)}, borderColor: '#d32f2f', backgroundColor: 'rgba(211,47,47,0.1)', fill: true, tension: 0.3 },
          { label: 'Serious', data: ${JSON.stringify(serious)}, borderColor: '#f57c00', backgroundColor: 'rgba(245,124,0,0.1)', fill: true, tension: 0.3 },
          { label: 'Moderate', data: ${JSON.stringify(moderate)}, borderColor: '#fbc02d', backgroundColor: 'rgba(251,192,45,0.1)', fill: true, tension: 0.3 },
          { label: 'Minor', data: ${JSON.stringify(minor)}, borderColor: '#1976d2', backgroundColor: 'rgba(25,118,210,0.1)', fill: true, tension: 0.3 },
        ],
      },
      options: {
        responsive: true,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Violations' } },
          x: { title: { display: true, text: 'Date' } },
        },
        plugins: { legend: { position: 'top' } },
      },
    });
  </script>
</body>
</html>`;
  }

  /**
   * Get the store file path
   */
  getStorePath(): string {
    return this.storePath;
  }

  private loadData(projectName: string): TrendData {
    try {
      const fullPath = path.resolve(this.storePath);
      if (fs.existsSync(fullPath)) {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        return JSON.parse(raw) as TrendData;
      }
    } catch {
      // Corrupted file, start fresh
    }
    return { projectName, entries: [] };
  }

  private saveData() {
    const fullPath = path.resolve(this.storePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  private extractTopIssues(result: A11yAuditResult): { rule: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const v of result.violations) {
      counts.set(v.rule, (counts.get(v.rule) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
