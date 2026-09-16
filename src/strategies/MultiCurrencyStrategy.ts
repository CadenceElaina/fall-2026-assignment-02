import { Transaction } from '../models.js';
import { ExchangeRateService } from '../services/ExchangeRateService.js';
import { AuditStrategy } from './AuditStrategy.js';

const DEFAULT_CURRENCY = 'EUR';

/**
 * Converts dollars to whole cents so sums are not thrown off by
 * floating point addition (e.g. 0.1 + 0.2 !== 0.3).
 */
const toCents = (amount: number): number => Math.round(amount * 100);

/**
 * Formats an amount with two decimals and its currency code.
 * Values that round to zero print as 0.00 instead of -0.00.
 */
const format = (amount: number, currency: string): string => {
  const rounded = Math.round(amount * 100) / 100;
  return `${(rounded === 0 ? 0 : rounded).toFixed(2)} ${currency}`;
};

/**
 * Reads the target currency from the custom parameter. Anything that is not
 * a three-letter code (missing, blank, "euro", "12") falls back to EUR.
 */
const resolveCurrency = (customParam?: string): string => {
  const code = customParam?.trim().toUpperCase() ?? '';
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_CURRENCY;
};

export class MultiCurrencyStrategy implements AuditStrategy {
  public readonly name = 'Multi-Currency Auditor';
  public readonly description =
    'Converts and aggregates transactions in a foreign currency';

  public async execute(
    transactions: Transaction[],
    customParam?: string,
  ): Promise<string> {
    // 1. Asynchronously fetch exchange rates relative to USD
    const exchange = await ExchangeRateService.getExchangeRates();
    const base = exchange?.base ?? 'USD';
    const rates = exchange?.rates ?? {};

    // 2. Pick the target currency (default EUR)
    const target = resolveCurrency(customParam);

    // 3. Look up its rate; converting to the base currency itself is 1:1
    const rate = target === base ? 1 : rates[target];
    if (rate === undefined) {
      const supported = Object.keys(rates).join(', ') || 'none';
      throw new Error(
        `Unsupported currency: ${target}. Supported currencies: ${supported}`,
      );
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Invalid exchange rate for ${target}: ${rate}`);
    }

    // 4. Aggregate in base-currency cents, then convert the totals
    const list = transactions ?? [];
    let incomeCents = 0;
    let expenseCents = 0;
    for (const t of list) {
      if (t.amount > 0) incomeCents += toCents(t.amount);
      if (t.amount < 0) expenseCents += toCents(Math.abs(t.amount));
    }
    const income = incomeCents / 100;
    const expenses = expenseCents / 100;
    const balance = (incomeCents - expenseCents) / 100;
    const average = list.length > 0 ? balance / list.length : 0;

    // 5. Format the report
    const lines: string[] = ['MULTI-CURRENCY AUDIT REPORT', ''];

    lines.push(`Target Currency: ${target}`);
    lines.push(`Conversion Rate: 1 ${base} = ${rate.toFixed(4)} ${target}`);

    lines.push('', `Summary (${target} | ${base}):`);
    const metrics: [string, number][] = [
      ['Total Income', income],
      ['Total Expenses', expenses],
      ['Net Balance', balance],
      ['Average Transaction', average],
    ];
    for (const [label, value] of metrics) {
      lines.push(
        `  ${label}: ${format(value * rate, target)} | ${format(value, base)}`,
      );
    }
    lines.push(`  Transactions: ${list.length}`);

    lines.push('', `Converted Transactions (${base} -> ${target}):`);
    if (list.length === 0) {
      lines.push('  No transactions to convert.');
    }
    for (const t of list) {
      lines.push(
        `  - ${t.id} | ${t.date} | ${t.category} | ${t.description} | ` +
          `${format(t.amount, base)} -> ${format(t.amount * rate, target)}`,
      );
    }

    return lines.join('\n');
  }
}
