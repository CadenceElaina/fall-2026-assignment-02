import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrendAnalysisStrategy } from '../src/strategies/TrendAnalysisStrategy.js';
import { HistoricalDataService } from '../src/services/HistoricalDataService.js';
import { Transaction } from '../src/models.js';

describe('TrendAnalysisStrategy (Feature 3)', () => {
  let strategy: TrendAnalysisStrategy;

  beforeEach(() => {
    strategy = new TrendAnalysisStrategy();
    vi.restoreAllMocks();
  });

  it('should group current expenses by category and compute accurate totals', async () => {
    const spy = vi
      .spyOn(HistoricalDataService, 'getHistoricalAverages')
      .mockResolvedValue({ Food: 200, Rent: 1000 });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -250.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      },
      {
        id: '2',
        date: '2026-05-03',
        amount: -75.5,
        category: 'Food',
        description: 'Takeout',
        status: 'completed',
      },
      {
        id: '3',
        date: '2026-05-02',
        amount: -1000.0,
        category: 'Rent',
        description: 'Apartment',
        status: 'completed',
      },
      {
        id: '4',
        date: '2026-05-01',
        amount: 3000.0,
        category: 'Salary',
        description: 'Paycheck',
        status: 'completed',
      },
    ];

    const result = await strategy.execute(testTransactions);

    expect(spy).toHaveBeenCalledTimes(1);
    // The two Food expenses are summed into a single category total.
    expect(result).toContain('$325.50');
    expect(result).toContain('$1000.00');
    // Income is excluded from a spending audit entirely.
    expect(result).not.toContain('Salary');
  });

  it('should calculate variance percentage from historical averages correctly', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue({
      Food: 200,
      Rent: 1000,
      Entertainment: 100,
    });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -250.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      },
      {
        id: '2',
        date: '2026-05-02',
        amount: -1000.0,
        category: 'Rent',
        description: 'Apartment',
        status: 'completed',
      },
      {
        id: '3',
        date: '2026-05-04',
        amount: -50.0,
        category: 'Entertainment',
        description: 'Cinema',
        status: 'completed',
      },
    ];

    const result = await strategy.execute(testTransactions);

    expect(result).toContain('+25.00%'); // (250 - 200) / 200
    expect(result).toContain('-50.00%'); // (50 - 100) / 100

    // Rent is unchanged, so its row reports no variance.
    const rentRow = result.split('\n').find((line) => line.startsWith('Rent'));
    expect(rentRow).toContain('0.00%');
  });

  it('should highlight categories exceeding positive/negative 20% variance threshold', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue({
      Food: 400,
      Entertainment: 100,
      Transport: 200,
    });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -500.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      }, // +25%
      {
        id: '2',
        date: '2026-05-02',
        amount: -50.0,
        category: 'Entertainment',
        description: 'Cinema',
        status: 'completed',
      }, // -50%
      {
        id: '3',
        date: '2026-05-03',
        amount: -220.0,
        category: 'Transport',
        description: 'Gas',
        status: 'completed',
      }, // +10%
    ];

    const result = await strategy.execute(testTransactions);

    const growthSection = result
      .split('SIGNIFICANT GROWTH CATEGORIES')[1]
      .split('SIGNIFICANT SAVINGS CATEGORIES')[0];
    const savingsSection = result.split('SIGNIFICANT SAVINGS CATEGORIES')[1];

    expect(growthSection).toContain('Food');
    expect(savingsSection).toContain('Entertainment');
    // +10% sits inside the threshold, so it is reported but never flagged.
    expect(growthSection).not.toContain('Transport');
    expect(savingsSection).not.toContain('Transport');
    expect(result).toContain('Significant growth flags:     1');
    expect(result).toContain('Significant savings flags:    1');
  });

  it('should handle categories present in current data but missing in historical benchmarks', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue({
      Food: 400,
    });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -400.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      },
      {
        id: '2',
        date: '2026-05-05',
        amount: -900.0,
        category: 'Crypto',
        description: 'Exchange',
        status: 'pending',
      },
    ];

    const result = await strategy.execute(testTransactions);

    expect(result).toContain(
      'CATEGORIES WITHOUT A USABLE HISTORICAL BENCHMARK',
    );
    expect(result).toContain('Crypto');
    expect(result).toContain('N/A');
    expect(result).toContain('Categories without benchmark: 1');
    expect(result).not.toContain('NaN');
    expect(result).not.toContain('Infinity');
  });

  it('should format historical vs current comparisons in a readable report', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue({
      Food: 200,
    });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -250.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      },
    ];

    const result = await strategy.execute(testTransactions);

    expect(result).toContain('HISTORICAL TREND AUDIT REPORT');
    expect(result).toContain('CURRENT SPENDING VS. HISTORICAL MONTHLY AVERAGE');
    expect(result).toContain('CATEGORY');
    expect(result).toContain('HISTORICAL');
    expect(result).toContain('CHANGE');
    expect(result).toContain('SUMMARY');
    expect(result).toContain('Categories analyzed:          1');

    // Amounts are rendered as two-decimal currency, not raw numbers.
    const foodRow = result.split('\n').find((line) => line.startsWith('Food'));
    expect(foodRow).toContain('$250.00');
    expect(foodRow).toContain('$200.00');
    expect(foodRow).toContain('+25.00%');
  });

  it('should handle an empty transaction list without crashing', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue(
      {},
    );

    const result = await strategy.execute([]);

    expect(result).toContain(
      'No expense transactions or historical benchmarks were available',
    );
  });

  it('should not divide by zero when a historical average is zero', async () => {
    vi.spyOn(HistoricalDataService, 'getHistoricalAverages').mockResolvedValue({
      Food: 0,
    });

    const testTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-05-01',
        amount: -150.0,
        category: 'Food',
        description: 'Grocery',
        status: 'completed',
      },
    ];

    const result = await strategy.execute(testTransactions);

    expect(result).toContain('N/A');
    expect(result).not.toContain('Infinity');
    expect(result).not.toContain('NaN');
  });
});
