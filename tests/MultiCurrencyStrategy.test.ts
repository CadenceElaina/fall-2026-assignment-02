import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MultiCurrencyStrategy } from '../src/strategies/MultiCurrencyStrategy.js';
import { ExchangeRateService } from '../src/services/ExchangeRateService.js';
import { Transaction } from '../src/models.js';

const tx = (
  id: string,
  amount: number,
  category = 'Misc',
  description = 'Test item',
): Transaction => ({
  id,
  date: '2026-05-01',
  amount,
  category,
  description,
  status: 'completed',
});

const mockRates = (rates: Record<string, number>, base = 'USD') =>
  vi
    .spyOn(ExchangeRateService, 'getExchangeRates')
    .mockResolvedValue({ base, rates });

const standardRates = { EUR: 0.92, GBP: 0.79, JPY: 155.4, CAD: 1.36 };

describe('MultiCurrencyStrategy (Feature 5)', () => {
  let strategy: MultiCurrencyStrategy;

  beforeEach(() => {
    strategy = new MultiCurrencyStrategy();
    vi.restoreAllMocks();
  });

  it('should fetch exchange rates from ExchangeRateService exactly once', async () => {
    const spy = mockRates(standardRates);

    await strategy.execute([tx('1', 10)], 'GBP');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should parse exchange rates and use customParam target currency', async () => {
    mockRates(standardRates);

    const result = await strategy.execute([tx('1', 100)], 'GBP');

    expect(result).toContain('Target Currency: GBP');
    expect(result).toContain('Conversion Rate: 1 USD = 0.7900 GBP');
    expect(result).toContain('100.00 USD -> 79.00 GBP');
  });

  it('should accept a lowercase or padded currency code', async () => {
    mockRates(standardRates);

    const result = await strategy.execute([tx('1', 10)], '  jpy ');

    expect(result).toContain('Target Currency: JPY');
    expect(result).toContain('10.00 USD -> 1554.00 JPY');
  });

  it.each([undefined, '', '   ', 'euro', '12'])(
    'should default to EUR conversion if currency param is missing or invalid (%j)',
    async (param) => {
      mockRates(standardRates);

      const result = await strategy.execute([tx('1', 100)], param);

      expect(result).toContain('Target Currency: EUR');
      expect(result).toContain('Conversion Rate: 1 USD = 0.9200 EUR');
    },
  );

  it('should throw an error if the target currency does not exist in exchange rates', async () => {
    mockRates(standardRates);

    await expect(strategy.execute([tx('1', 100)], 'MXN')).rejects.toThrow(
      'Unsupported currency: MXN. Supported currencies: EUR, GBP, JPY, CAD',
    );
  });

  it('should throw when the default EUR rate is missing from the service', async () => {
    mockRates({ GBP: 0.79 });

    await expect(strategy.execute([tx('1', 100)])).rejects.toThrow(
      'Unsupported currency: EUR',
    );
  });

  it('should throw when the service returns a non-positive rate', async () => {
    mockRates({ EUR: 0 });

    await expect(strategy.execute([tx('1', 100)], 'EUR')).rejects.toThrow(
      'Invalid exchange rate for EUR',
    );
  });

  it('should convert to the base currency at a 1:1 rate', async () => {
    mockRates(standardRates);

    const result = await strategy.execute([tx('1', -25)], 'USD');

    expect(result).toContain('Conversion Rate: 1 USD = 1.0000 USD');
    expect(result).toContain('-25.00 USD -> -25.00 USD');
  });

  it('should accurately convert individual transaction amounts to the target currency', async () => {
    mockRates({ EUR: 0.9 });

    const result = await strategy.execute(
      [tx('1', 100, 'Salary', 'Gig'), tx('2', -50, 'Food', 'Grocery')],
      'EUR',
    );

    expect(result).toContain(
      '1 | 2026-05-01 | Salary | Gig | 100.00 USD -> 90.00 EUR',
    );
    expect(result).toContain(
      '2 | 2026-05-01 | Food | Grocery | -50.00 USD -> -45.00 EUR',
    );
  });

  it('should calculate and display totals (income, expense, net balance) in both USD and target currency', async () => {
    mockRates({ EUR: 0.9 });

    const result = await strategy.execute(
      [tx('1', 100), tx('2', -50), tx('3', 20), tx('4', -40)],
      'EUR',
    );

    expect(result).toContain('Total Income: 108.00 EUR | 120.00 USD');
    expect(result).toContain('Total Expenses: 81.00 EUR | 90.00 USD');
    expect(result).toContain('Net Balance: 27.00 EUR | 30.00 USD');
    expect(result).toContain('Average Transaction: 6.75 EUR | 7.50 USD'); // 30 / 4
    expect(result).toContain('Transactions: 4');
  });

  it('should show a negative balance when expenses exceed income', async () => {
    mockRates({ GBP: 0.8 });

    const result = await strategy.execute([tx('1', 10), tx('2', -110)], 'GBP');

    expect(result).toContain('Net Balance: -80.00 GBP | -100.00 USD');
    expect(result).toContain('Average Transaction: -40.00 GBP | -50.00 USD');
  });

  it('should avoid floating point drift when summing amounts', async () => {
    mockRates({ EUR: 1 });

    // 0.1 + 0.2 === 0.30000000000000004 in JavaScript
    const result = await strategy.execute([tx('1', 0.1), tx('2', 0.2)], 'EUR');

    expect(result).toContain('Total Income: 0.30 EUR | 0.30 USD');
  });

  it('should handle an empty transaction list gracefully', async () => {
    mockRates(standardRates);

    const result = await strategy.execute([], 'CAD');

    expect(result).toContain('Total Income: 0.00 CAD | 0.00 USD');
    expect(result).toContain('Net Balance: 0.00 CAD | 0.00 USD');
    expect(result).toContain('Average Transaction: 0.00 CAD | 0.00 USD');
    expect(result).toContain('No transactions to convert.');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('-0.00');
  });

  it('should propagate errors from ExchangeRateService', async () => {
    vi.spyOn(ExchangeRateService, 'getExchangeRates').mockRejectedValue(
      new Error('Exchange API unavailable'),
    );

    await expect(strategy.execute([tx('1', 10)], 'EUR')).rejects.toThrow(
      'Exchange API unavailable',
    );
  });
});
