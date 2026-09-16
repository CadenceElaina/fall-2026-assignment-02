import { Transaction } from '../models.js';
import { AnomalyRulesService } from '../services/AnomalyRulesService.js';
import { AuditStrategy } from './AuditStrategy.js';

export class AnomalyDetectionStrategy implements AuditStrategy {
  public readonly name = 'Anomaly & Duplicate Auditor';
  public readonly description =
    'Detects transactions exceeding thresholds and duplicate records';

  public async execute(
    transactions: Transaction[],
    customParam?: string,
  ): Promise<string> {
    // 1. Asynchronously fetch rules from AnomalyRulesService
    const rules = await AnomalyRulesService.getRules();

    // 2. Outliers: Expense transactions exceeding maxTransactionAmount
    const outliers = transactions.filter(
      (t) => t.amount < 0 && Math.abs(t.amount) > rules.maxTransactionAmount,
    );

    // 3. Duplicates: Group transactions by (date + category + description + amount)
    const duplicateGroups = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const key = `${t.date}|${t.category}|${t.description}|${t.amount}`;
      const group = duplicateGroups.get(key) ?? [];
      group.push(t);
      duplicateGroups.set(key, group);
    }

    const duplicateSets: Transaction[][] = [];
    for (const group of duplicateGroups.values()) {
      if (group.length > 1) {
        duplicateSets.push(group);
      }
    }

    // 4. Flagged Statuses: Transactions matching flagged status rules
    const flaggedTransactions = transactions.filter(
      (t) => t.status && rules.flaggedStatuses.includes(t.status),
    );

    // 5. Calculate unique anomalous transactions and percentage
    const anomalousSet = new Set<Transaction>();
    outliers.forEach((t) => anomalousSet.add(t));
    duplicateSets.flat().forEach((t) => anomalousSet.add(t));
    flaggedTransactions.forEach((t) => anomalousSet.add(t));

    const totalTransactions = transactions.length;
    const totalAnomalies = anomalousSet.size;
    const anomalyPercentage =
      totalTransactions > 0
        ? ((totalAnomalies / totalTransactions) * 100).toFixed(2)
        : '0.00';

    // 6. Format Report
    const lines: string[] = [];
    lines.push(`=== ${this.name} Report ===`);
    lines.push(`Description: ${this.description}`);
    lines.push('');

    // Outlier Section
    lines.push('--- Outlier Transactions (Exceeding Threshold) ---');
    if (outliers.length === 0) {
      lines.push('No outlier transactions found.');
    } else {
      outliers.forEach((t) => {
        lines.push(
          `- [${t.date}] ${t.description} (${t.category}): $${Math.abs(t.amount).toFixed(2)} (Exceeds max limit $${rules.maxTransactionAmount})`,
        );
      });
    }
    lines.push('');

    // Duplicate Section
    lines.push('--- Duplicate Transaction Sets ---');
    if (duplicateSets.length === 0) {
      lines.push('No duplicate transactions found.');
    } else {
      duplicateSets.forEach((set, idx) => {
        lines.push(`Group #${idx + 1} (${set.length} identical records):`);
        set.forEach((t) => {
          lines.push(
            `  - ID: ${t.id} | Date: ${t.date} | Category: ${t.category} | Desc: ${t.description} | Amount: $${t.amount}`,
          );
        });
      });
    }
    lines.push('');

    // Flagged Status Section
    lines.push('--- Flagged Status Transactions ---');
    if (flaggedTransactions.length === 0) {
      lines.push('No transactions with flagged statuses found.');
    } else {
      flaggedTransactions.forEach((t) => {
        lines.push(
          `- [${t.date}] ${t.description} (${t.category}): $${t.amount} [Status: ${t.status}]`,
        );
      });
    }
    lines.push('');

    // Summary Statistics
    lines.push('--- Anomaly Summary Statistics ---');
    lines.push(`Total Transactions Analyzed: ${totalTransactions}`);
    lines.push(`Total Anomalous Transactions: ${totalAnomalies}`);
    lines.push(`Anomaly Rate: ${anomalyPercentage}%`);

    return lines.join('\n');
  }
}