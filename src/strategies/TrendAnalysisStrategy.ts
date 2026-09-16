import { Transaction } from '../models.js';
import { HistoricalDataService } from '../services/HistoricalDataService.js';
import { AuditStrategy } from './AuditStrategy.js';

/** A category is "significant" once it moves more than +/- 20% from its historical average. */
const VARIANCE_THRESHOLD = 20;

interface CategoryTrend {
  category: string;
  currentSpending: number;
  /** null when the service has no benchmark for this category. */
  historicalAverage: number | null;
  /** null when a percentage cannot be computed (no benchmark, or a benchmark of 0). */
  variancePercent: number | null;
}

export class TrendAnalysisStrategy implements AuditStrategy {
  public readonly name = 'Historical Trend Auditor';
  public readonly description =
    'Compares current monthly category spending against historical averages';

  public async execute(transactions: Transaction[]): Promise<string> {
    // 1. Call HistoricalDataService.getHistoricalAverages() asynchronously.
    const historicalAverages =
      await HistoricalDataService.getHistoricalAverages();

    // 2. Group current expenses (amount < 0) by category and compute category totals.
    const currentTotals = this.groupExpensesByCategory(transactions);

    // 3 & 4. Compare each category against its historical average and compute the variance.
    const trends = this.buildTrends(currentTotals, historicalAverages);

    // 5 & 6. Format the report, highlighting categories beyond +/- 20%.
    return this.buildReport(trends);
  }

  /** Sums the absolute value of every expense (amount < 0), keyed by category. */
  private groupExpensesByCategory(
    transactions: Transaction[],
  ): Map<string, number> {
    const totals = new Map<string, number>();

    if (!Array.isArray(transactions)) {
      return totals;
    }

    for (const transaction of transactions) {
      if (!transaction || typeof transaction.amount !== 'number') {
        continue;
      }
      if (transaction.amount >= 0) {
        continue; // income is out of scope for a spending trend audit
      }

      const category = transaction.category || 'Uncategorized';
      const previous = totals.get(category) ?? 0;
      totals.set(category, previous + Math.abs(transaction.amount));
    }

    return totals;
  }

  /** Builds one row per category appearing in either the current data or the benchmarks. */
  private buildTrends(
    currentTotals: Map<string, number>,
    historicalAverages: Record<string, number>,
  ): CategoryTrend[] {
    const benchmarks = historicalAverages ?? {};
    const categories = new Set<string>([
      ...currentTotals.keys(),
      ...Object.keys(benchmarks),
    ]);

    const trends: CategoryTrend[] = [];

    for (const category of categories) {
      const currentSpending = currentTotals.get(category) ?? 0;
      const rawHistorical = benchmarks[category];
      const historicalAverage = Number.isFinite(rawHistorical)
        ? rawHistorical
        : null;

      trends.push({
        category,
        currentSpending,
        historicalAverage,
        variancePercent: this.calculateVariance(
          currentSpending,
          historicalAverage,
        ),
      });
    }

    return trends.sort((a, b) => a.category.localeCompare(b.category));
  }

  /** ((Current - Historical) / Historical) * 100, guarded against divide-by-zero. */
  private calculateVariance(
    current: number,
    historical: number | null,
  ): number | null {
    if (historical === null || historical === 0) {
      return null;
    }
    return ((current - historical) / historical) * 100;
  }

  private buildReport(trends: CategoryTrend[]): string {
    const lines: string[] = [];
    const divider = '='.repeat(74);
    const thinDivider = '-'.repeat(74);

    lines.push(divider);
    lines.push('HISTORICAL TREND AUDIT REPORT');
    lines.push(divider);
    lines.push('');

    if (trends.length === 0) {
      lines.push(
        'No expense transactions or historical benchmarks were available to analyze.',
      );
      lines.push('');
      lines.push(divider);
      return lines.join('\n');
    }

    lines.push('CURRENT SPENDING VS. HISTORICAL MONTHLY AVERAGE');
    lines.push(thinDivider);
    lines.push(
      'CATEGORY'.padEnd(22) +
        'CURRENT'.padStart(15) +
        'HISTORICAL'.padStart(17) +
        'CHANGE'.padStart(15),
    );
    lines.push(thinDivider);

    let totalCurrent = 0;
    let totalHistorical = 0;

    for (const trend of trends) {
      totalCurrent += trend.currentSpending;
      totalHistorical += trend.historicalAverage ?? 0;

      const historicalCell =
        trend.historicalAverage === null
          ? 'N/A'
          : this.formatCurrency(trend.historicalAverage);

      lines.push(
        trend.category.padEnd(22) +
          this.formatCurrency(trend.currentSpending).padStart(15) +
          historicalCell.padStart(17) +
          this.formatVariance(trend.variancePercent).padStart(15),
      );
    }

    lines.push(thinDivider);
    lines.push(
      'TOTAL'.padEnd(22) +
        this.formatCurrency(totalCurrent).padStart(15) +
        this.formatCurrency(totalHistorical).padStart(17),
    );
    lines.push('');

    const growth = trends.filter(
      (t) =>
        t.variancePercent !== null && t.variancePercent > VARIANCE_THRESHOLD,
    );
    const savings = trends.filter(
      (t) =>
        t.variancePercent !== null && t.variancePercent < -VARIANCE_THRESHOLD,
    );
    const noBenchmark = trends.filter((t) => t.variancePercent === null);

    lines.push(
      `SIGNIFICANT GROWTH CATEGORIES (variance > +${VARIANCE_THRESHOLD}%)`,
    );
    lines.push(thinDivider);
    if (growth.length === 0) {
      lines.push(
        '  None. No category grew by more than 20% over its historical average.',
      );
    } else {
      for (const trend of growth) {
        const delta =
          trend.currentSpending - (trend.historicalAverage as number);
        lines.push(
          `  [UP] ${trend.category}: ${this.formatCurrency(trend.currentSpending)} vs ` +
            `${this.formatCurrency(trend.historicalAverage as number)} historical ` +
            `(${this.formatVariance(trend.variancePercent)}, ` +
            `${this.formatCurrency(delta)} above average)`,
        );
      }
    }
    lines.push('');

    lines.push(
      `SIGNIFICANT SAVINGS CATEGORIES (variance < -${VARIANCE_THRESHOLD}%)`,
    );
    lines.push(thinDivider);
    if (savings.length === 0) {
      lines.push(
        '  None. No category fell by more than 20% below its historical average.',
      );
    } else {
      for (const trend of savings) {
        const delta =
          (trend.historicalAverage as number) - trend.currentSpending;
        lines.push(
          `  [DOWN] ${trend.category}: ${this.formatCurrency(trend.currentSpending)} vs ` +
            `${this.formatCurrency(trend.historicalAverage as number)} historical ` +
            `(${this.formatVariance(trend.variancePercent)}, ` +
            `${this.formatCurrency(delta)} below average)`,
        );
      }
    }
    lines.push('');

    if (noBenchmark.length > 0) {
      lines.push('CATEGORIES WITHOUT A USABLE HISTORICAL BENCHMARK');
      lines.push(thinDivider);
      for (const trend of noBenchmark) {
        lines.push(
          `  ${trend.category}: ${this.formatCurrency(trend.currentSpending)} spent ` +
            '(no historical average available, variance not calculated)',
        );
      }
      lines.push('');
    }

    lines.push('SUMMARY');
    lines.push(thinDivider);
    lines.push(`  Categories analyzed:          ${trends.length}`);
    lines.push(`  Significant growth flags:     ${growth.length}`);
    lines.push(`  Significant savings flags:    ${savings.length}`);
    lines.push(`  Categories without benchmark: ${noBenchmark.length}`);
    lines.push('');
    lines.push(divider);

    return lines.join('\n');
  }

  private formatCurrency(value: number): string {
    return `$${value.toFixed(2)}`;
  }

  private formatVariance(variance: number | null): string {
    if (variance === null) {
      return 'N/A';
    }
    const sign = variance > 0 ? '+' : '';
    return `${sign}${variance.toFixed(2)}%`;
  }
}
