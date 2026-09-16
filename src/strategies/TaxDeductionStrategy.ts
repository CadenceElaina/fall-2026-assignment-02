import { Transaction } from '../models.js';
import { TaxConfigService } from '../services/TaxConfigService.js';
import { AuditStrategy } from './AuditStrategy.js';

/**
 * Converts dollars to whole cents so sums are not thrown off by
 * floating point addition (e.g. 0.1 + 0.2 !== 0.3).
 */
const toCents = (amount: number): number => Math.round(amount * 100);

const money = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export class TaxDeductionStrategy implements AuditStrategy {
  public readonly name = 'Tax & Deductions Auditor';
  public readonly description =
    'Identifies eligible tax-deductible expenses and estimates savings';

  public async execute(
    transactions: Transaction[],
    _customParam?: string,
  ): Promise<string> {
    // 1. Asynchronously fetch the tax rate and deductible categories
    const config = await TaxConfigService.getTaxConfig();
    const taxRate = config?.standardTaxRate;
    if (
      typeof taxRate !== 'number' ||
      !Number.isFinite(taxRate) ||
      taxRate < 0
    ) {
      throw new Error(`Invalid standard tax rate: ${taxRate}`);
    }

    // Category matching ignores case and surrounding whitespace
    const deductibleCategories = config.deductibleCategories ?? [];
    const deductibleKeys = new Set(
      deductibleCategories.map((c) => c.trim().toLowerCase()),
    );
    const isDeductible = (t: Transaction): boolean =>
      deductibleKeys.has(t.category.trim().toLowerCase());

    // 2. Split expenses (amount < 0) into deductible and non-deductible
    const expenses = (transactions ?? []).filter((t) => t.amount < 0);
    const deductible = expenses.filter(isDeductible);
    const nonDeductible = expenses.filter((t) => !isDeductible(t));

    // 3. Sum absolute amounts in cents
    const sumCents = (list: Transaction[]): number =>
      list.reduce((sum, t) => sum + toCents(Math.abs(t.amount)), 0);
    const deductionCents = sumCents(deductible);
    const nonDeductibleCents = sumCents(nonDeductible);

    // 4. Estimate savings on deductions and sales tax (VAT) on everything else
    const savingsCents = Math.round(deductionCents * taxRate);
    const vatCents = Math.round(nonDeductibleCents * taxRate);

    // 5. Format the report
    const lines: string[] = ['TAX & DEDUCTIONS AUDIT REPORT', ''];

    lines.push(`Standard Tax Rate: ${(taxRate * 100).toFixed(2)}%`);
    lines.push(
      `Deductible Categories: ${
        deductibleCategories.length > 0
          ? deductibleCategories.join(', ')
          : 'None configured'
      }`,
    );

    lines.push('', 'Qualifying Deductible Transactions:');
    if (deductible.length === 0) {
      lines.push('  No deductible transactions found.');
    }
    for (const t of deductible) {
      lines.push(
        `  - ${t.id} | ${t.date} | ${t.category} | ${t.description} | ${money(toCents(Math.abs(t.amount)))}`,
      );
    }

    lines.push('', 'Deduction Summary:');
    lines.push(`  Total Deductions: ${money(deductionCents)}`);
    lines.push(`  Estimated Tax Savings: ${money(savingsCents)}`);

    lines.push('', 'Sales Tax (VAT) on Non-Deductible Expenses:');
    lines.push(`  Non-Deductible Expenses: ${money(nonDeductibleCents)}`);
    lines.push(`  Estimated Sales Tax (VAT) Paid: ${money(vatCents)}`);

    return lines.join('\n');
  }
}
