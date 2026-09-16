import { Transaction } from '../models.js';
import { BudgetService } from '../services/BudgetService.js';
import { AuditStrategy } from './AuditStrategy.js';

interface CategorySpending {
  total: number;
  transactions: Transaction[];
}

interface Overage {
  category: string;
  limit: number;
  spent: number;
  overage: number;
  percentOfBudget: number | null; // null when the limit is 0 (no percentage exists)
}

/**
 * Converts dollars to whole cents so comparisons are not thrown off by
 * floating point sums (e.g. 0.1 + 0.2 !== 0.3).
 */
const toCents = (amount: number): number => Math.round(amount * 100);

const money = (amount: number): string => `$${amount.toFixed(2)}`;

export class BudgetLimitStrategy implements AuditStrategy {
  public readonly name = 'Budget Limit Auditor';
  public readonly description =
    'Checks category spending against monthly budget limits';

  public async execute(
    transactions: Transaction[],
    _customParam?: string,
  ): Promise<string> {
    // 1. Asynchronously fetch the category budget limits
    const budgets = (await BudgetService.getCategoryBudgets()) ?? {};

    // 2. Group expenses (amount < 0) by category and sum absolute spending
    const spending = new Map<string, CategorySpending>();
    for (const t of transactions ?? []) {
      if (!(t.amount < 0)) continue;
      const entry = spending.get(t.category) ?? { total: 0, transactions: [] };
      entry.total += Math.abs(t.amount);
      entry.transactions.push(t);
      spending.set(t.category, entry);
    }

    // 3. Every category that has a budget or has spending gets a summary row
    const categories = [
      ...new Set([...Object.keys(budgets), ...spending.keys()]),
    ].sort();

    // 4. Find categories whose spending exceeds their budget
    const overages: Overage[] = [];
    for (const category of categories) {
      const limit = budgets[category];
      const spent = spending.get(category)?.total ?? 0;
      if (limit === undefined || toCents(spent) <= toCents(limit)) continue;
      overages.push({
        category,
        limit,
        spent,
        overage: spent - limit,
        percentOfBudget: limit > 0 ? (spent / limit) * 100 : null,
      });
    }

    // 5. Format the report
    const lines: string[] = ['BUDGET LIMIT AUDIT REPORT', ''];

    lines.push('Category Summary:');
    if (categories.length === 0) {
      lines.push('  No budgets or expenses found.');
    }
    for (const category of categories) {
      const limit = budgets[category];
      const spent = spending.get(category)?.total ?? 0;
      const limitText = limit === undefined ? 'No budget set' : money(limit);
      lines.push(`  ${category}: Budget ${limitText} | Spent ${money(spent)}`);
    }

    lines.push('', 'Over-Budget Warnings:');
    if (overages.length === 0) {
      lines.push('  No categories are over budget.');
    }
    for (const o of overages) {
      const percent =
        o.percentOfBudget === null
          ? 'N/A (budget is $0.00)'
          : `${o.percentOfBudget.toFixed(1)}% of budget`;
      lines.push(
        `  OVER BUDGET: ${o.category} - Spent ${money(o.spent)} of ${money(o.limit)} | ` +
          `Overage ${money(o.overage)} | ${percent}`,
      );
    }

    lines.push('', 'Transactions Contributing to Overages:');
    if (overages.length === 0) {
      lines.push('  None.');
    }
    for (const o of overages) {
      lines.push(`  ${o.category}:`);
      for (const t of spending.get(o.category)?.transactions ?? []) {
        lines.push(
          `    - ${t.id} | ${t.date} | ${t.description} | ${money(Math.abs(t.amount))}`,
        );
      }
    }

    return lines.join('\n');
  }
}
