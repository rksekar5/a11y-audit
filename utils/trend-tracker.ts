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

    const latest = entries.length > 0 ? entries[entries.length - 1] : null;
    const previous = entries.length >= 2 ? entries[entries.length - 2] : null;
    const totalDelta = latest && previous ? latest.totalViolations - previous.totalViolations : 0;
    const critDelta = latest && previous ? latest.critical - previous.critical : 0;
    const improvementPct = entries.length >= 2 && totals[0] > 0
      ? Math.round(((totals[0] - totals[totals.length - 1]) / totals[0]) * 100) : 0;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Accessibility Trend Report — ${escapeHtml(this.data.projectName)}</title>
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
    .header h1 { font-size: 24px; font-weight: 700; }
    .header .meta { color: var(--text-secondary); font-size: 13px; margin-top: 4px; }
    .theme-toggle {
      width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--border);
      background: var(--bg-secondary); color: var(--text-primary);
      cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;
    }

    /* Stats Row */
    .stats-row {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px; margin-bottom: 24px;
    }
    .stat-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 20px; position: relative; overflow: hidden;
    }
    .stat-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
      background: var(--accent);
    }
    .stat-card.success::before { background: var(--success); }
    .stat-card.danger::before { background: var(--danger); }
    .stat-value { font-size: 32px; font-weight: 700; margin-bottom: 2px; }
    .stat-label { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-delta {
      font-size: 12px; font-weight: 500; margin-top: 4px;
    }
    .stat-delta.positive { color: var(--success); }
    .stat-delta.negative { color: var(--danger); }

    /* Charts */
    .chart-grid {
      display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 24px;
    }
    @media (max-width: 768px) { .chart-grid { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 24px;
    }
    .chart-card h3 {
      font-size: 14px; color: var(--text-secondary); margin-bottom: 16px;
      font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;
    }

    /* Table */
    .table-card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
      overflow: hidden;
    }
    .table-card h3 {
      font-size: 15px; font-weight: 600; padding: 16px 24px;
      border-bottom: 1px solid var(--border);
    }
    table { width: 100%; border-collapse: collapse; }
    th {
      padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);
      border-bottom: 1px solid var(--border); background: var(--bg-primary);
    }
    td {
      padding: 10px 16px; border-bottom: 1px solid var(--border); font-size: 13px;
      color: var(--text-primary);
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg-primary); }
    .severity-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
    .url-cell { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); }

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
        <h1>📈 Accessibility Trend Report</h1>
        <div class="meta">${escapeHtml(this.data.projectName)} • ${entries.length} audit${entries.length !== 1 ? 's' : ''} tracked</div>
      </div>
      <button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">🌓</button>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <div class="stat-card ${latest && latest.totalViolations === 0 ? 'success' : ''}">
        <div class="stat-value">${latest ? latest.totalViolations : '—'}</div>
        <div class="stat-label">Current Violations</div>
        ${totalDelta !== 0 ? `<div class="stat-delta ${totalDelta < 0 ? 'positive' : 'negative'}">${totalDelta < 0 ? '↓' : '↑'} ${Math.abs(totalDelta)} from last audit</div>` : ''}
      </div>
      <div class="stat-card ${latest && latest.critical === 0 ? 'success' : 'danger'}">
        <div class="stat-value" style="color:${latest && latest.critical > 0 ? '#ef4444' : '#22c55e'}">${latest ? latest.critical : '—'}</div>
        <div class="stat-label">Critical Issues</div>
        ${critDelta !== 0 ? `<div class="stat-delta ${critDelta < 0 ? 'positive' : 'negative'}">${critDelta < 0 ? '↓' : '↑'} ${Math.abs(critDelta)}</div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-value">${entries.length}</div>
        <div class="stat-label">Total Audits</div>
      </div>
      <div class="stat-card ${improvementPct > 0 ? 'success' : improvementPct < 0 ? 'danger' : ''}">
        <div class="stat-value" style="color:${improvementPct > 0 ? '#22c55e' : improvementPct < 0 ? '#ef4444' : 'var(--text-primary)'}">${improvementPct > 0 ? '+' : ''}${improvementPct}%</div>
        <div class="stat-label">Overall Improvement</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="chart-grid">
      <!-- Trend Line Chart -->
      <div class="chart-card">
        <h3>Violations Over Time</h3>
        <canvas id="trendChart"></canvas>
      </div>

      <!-- Severity Breakdown (latest) -->
      <div class="chart-card">
        <h3>Latest Breakdown</h3>
        <canvas id="breakdownChart"></canvas>
      </div>
    </div>

    <!-- Totals Area Chart -->
    <div class="chart-card" style="margin-bottom:24px">
      <h3>Total Violations Trend</h3>
      <canvas id="totalChart" style="max-height:160px"></canvas>
    </div>

    <!-- History Table -->
    <div class="table-card">
      <h3>Audit History</h3>
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
              <td class="url-cell" title="${escapeHtml(e.url)}">${escapeHtml(e.url)}</td>
              <td>${e.gitBranch || '—'}</td>
              <td><strong>${e.totalViolations}</strong></td>
              <td><span class="severity-dot" style="background:#ef4444"></span>${e.critical}</td>
              <td><span class="severity-dot" style="background:#ea580c"></span>${e.serious}</td>
              <td><span class="severity-dot" style="background:#ca8a04"></span>${e.moderate}</td>
              <td><span class="severity-dot" style="background:#2563eb"></span>${e.minor}</td>
              <td>${e.pagesAudited}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div class="footer">
      Generated by <a href="https://github.com/rksekar5/a11y-audit">a11y-audit</a> • AI-Powered Accessibility Auditor
    </div>
  </div>

  <script>
    // Trend line chart (stacked area)
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [
          { label: 'Critical', data: ${JSON.stringify(critical)}, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: 'Serious', data: ${JSON.stringify(serious)}, borderColor: '#ea580c', backgroundColor: 'rgba(234,88,12,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: 'Moderate', data: ${JSON.stringify(moderate)}, borderColor: '#ca8a04', backgroundColor: 'rgba(202,138,4,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
          { label: 'Minor', data: ${JSON.stringify(minor)}, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)', fill: true, tension: 0.4, borderWidth: 2, pointRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        interaction: { intersect: false, mode: 'index' },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(100,116,139,0.1)' }, ticks: { color: '#94a3b8' } },
          x: { grid: { color: 'rgba(100,116,139,0.05)' }, ticks: { color: '#94a3b8' } },
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1 }
        },
      },
    });

    // Breakdown doughnut (latest audit)
    const breakCtx = document.getElementById('breakdownChart').getContext('2d');
    new Chart(breakCtx, {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'Serious', 'Moderate', 'Minor'],
        datasets: [{
          data: [${latest ? latest.critical : 0}, ${latest ? latest.serious : 0}, ${latest ? latest.moderate : 0}, ${latest ? latest.minor : 0}],
          backgroundColor: ['#ef4444', '#ea580c', '#ca8a04', '#2563eb'],
          borderWidth: 0,
          cutout: '65%'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', usePointStyle: true, pointStyle: 'circle', padding: 12 } },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8' }
        }
      }
    });

    // Total violations area chart
    const totalCtx = document.getElementById('totalChart').getContext('2d');
    new Chart(totalCtx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(labels)},
        datasets: [{
          label: 'Total Violations',
          data: ${JSON.stringify(totals)},
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.15)',
          fill: true,
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#6366f1'
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(100,116,139,0.1)' }, ticks: { color: '#94a3b8' } },
          x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8' }
        }
      }
    });

    // Theme toggle
    function toggleTheme() {
      const body = document.body;
      const current = body.getAttribute('data-theme');
      body.setAttribute('data-theme', current === 'light' ? 'dark' : 'light');
      localStorage.setItem('a11y-theme', body.getAttribute('data-theme'));
    }
    const saved = localStorage.getItem('a11y-theme');
    if (saved) document.body.setAttribute('data-theme', saved);
  <\/script>
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
