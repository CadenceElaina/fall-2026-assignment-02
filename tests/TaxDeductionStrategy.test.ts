import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaxDeductionStrategy } from '../src/strategies/TaxDeductionStrategy.js';
import { TaxConfigService } from '../src/services/TaxConfigService.js';
import { Transaction } from '../src/models.js';

const tx = (
  id: string,
  amount: number,
  category: string,
  description = 'Test item',
): Transaction => ({
  id,
  date: '2026-05-01',
  amount,
  category,
  description,
  status: 'completed',
});

const mockConfig = (standardTaxRate: number, deductibleCategories: string[]) =>
  vi
    .spyOn(TaxConfigService, 'getTaxConfig')
    .mockResolvedValue({ standardTaxRate, deductibleCategories });

describe('TaxDeductionStrategy (Feature 4)', () => {
  let strategy: TaxDeductionStrategy;

  beforeEach(() => {
    strategy = new TaxDeductionStrategy();
    vi.restoreAllMocks();
  });

  it('should fetch the tax config from TaxConfigService exactly once', async () => {
    const spy = mockConfig(0.1, ['Charity']);

    await strategy.execute([tx('1', -10, 'Charity')]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should filter only the categories specified as deductible in the config', async () => {
    mockConfig(0.1, ['Medical', 'Charity']);

    const result = await strategy.execute([
      tx('m1', -120, 'Medical', 'Dentist'),
      tx('c1', -50, 'Charity', 'Food bank'),
      tx('b1', -300, 'Business', 'Laptop'), // not deductible in this config
      tx('f1', -40, 'Food', 'Grocery'),
    ]);

    const itemized = result
      .split('Qualifying Deductible Transactions:')[1]
      .split('Deduction Summary:')[0];
    expect(itemized).toContain('m1 | 2026-05-01 | Medical | Dentist | $120.00');
    expect(itemized).toContain(
      'c1 | 2026-05-01 | Charity | Food bank | $50.00',
    );
    expect(itemized).not.toContain('b1');
    expect(itemized).not.toContain('f1');
  });

  it('should ignore income in deductible categories', async () => {
    mockConfig(0.1, ['Business']);

    const result = await strategy.execute([
      tx('refund', 200, 'Business', 'Client reimbursement'),
      tx('b1', -75, 'Business', 'Software'),
    ]);

    expect(result).not.toContain('refund');
    expect(result).toContain('Total Deductions: $75.00');
  });

  it('should sum total eligible tax deductions correctly', async () => {
    mockConfig(0.1, ['Charity', 'Business', 'Medical']);

    const result = await strategy.execute([
      tx('1', -200, 'Charity'),
      tx('2', -149.99, 'Business'),
      tx('3', -0.01, 'Medical'),
      tx('4', -100, 'Food'),
    ]);

    expect(result).toContain('Total Deductions: $350.00');
  });

  it('should calculate estimated tax savings using standardTaxRate', async () => {
    mockConfig(0.1, ['Medical', 'Charity']);

    const result = await strategy.execute([
      tx('1', -200, 'Charity', 'Donation'),
      tx('2', -100, 'Food', 'Grocery'),
    ]);

    expect(result).toContain('Standard Tax Rate: 10.00%');
    expect(result).toContain('Deductions: $200.00');
    expect(result).toContain('Estimated Tax Savings: $20.00'); // $200 * 0.10
  });

  it('should calculate estimated VAT/sales tax paid on non-deductible expense transactions', async () => {
    mockConfig(0.08, ['Charity']);

    const result = await strategy.execute([
      tx('1', 2500, 'Salary'), // income: no VAT
      tx('2', -1200, 'Rent'),
      tx('3', -45.2, 'Food'),
      tx('4', -100, 'Charity'), // deductible: no VAT
    ]);

    expect(result).toContain('Non-Deductible Expenses: $1245.20');
    expect(result).toContain('Estimated Sales Tax (VAT) Paid: $99.62'); // 1245.20 * 0.08 = 99.616
  });

  it('should match deductible categories regardless of case or whitespace', async () => {
    mockConfig(0.1, ['Charity']);

    const result = await strategy.execute([tx('1', -30, ' charity ')]);

    expect(result).toContain('Total Deductions: $30.00');
    expect(result).toContain('Non-Deductible Expenses: $0.00');
  });

  it('should avoid floating point drift when summing cents', async () => {
    mockConfig(0.5, ['Medical']);

    // 0.1 + 0.2 === 0.30000000000000004 in JavaScript
    const result = await strategy.execute([
      tx('1', -0.1, 'Medical'),
      tx('2', -0.2, 'Medical'),
    ]);

    expect(result).toContain('Total Deductions: $0.30');
    expect(result).toContain('Estimated Tax Savings: $0.15');
  });

  it('should structure report to show both aggregates and itemized deductible transactions', async () => {
    mockConfig(0.08, ['Charity', 'Business', 'Medical']);

    const result = await strategy.execute([
      tx('c1', -60, 'Charity', 'Red Cross'),
      tx('f1', -40, 'Food', 'Lunch'),
    ]);

    const sections = [
      'TAX & DEDUCTIONS AUDIT REPORT',
      'Deductible Categories: Charity, Business, Medical',
      'Qualifying Deductible Transactions:',
      'Deduction Summary:',
      'Sales Tax (VAT) on Non-Deductible Expenses:',
    ];
    let lastIndex = -1;
    for (const section of sections) {
      const index = result.indexOf(section);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
  });

  it('should handle an empty transaction list gracefully', async () => {
    mockConfig(0.08, ['Charity']);

    const result = await strategy.execute([]);

    expect(result).toContain('No deductible transactions found.');
    expect(result).toContain('Total Deductions: $0.00');
    expect(result).toContain('Estimated Tax Savings: $0.00');
    expect(result).toContain('Estimated Sales Tax (VAT) Paid: $0.00');
  });

  it('should treat every expense as non-deductible when no categories are configured', async () => {
    mockConfig(0.1, []);

    const result = await strategy.execute([tx('1', -50, 'Charity')]);

    expect(result).toContain('Deductible Categories: None configured');
    expect(result).toContain('Total Deductions: $0.00');
    expect(result).toContain('Estimated Sales Tax (VAT) Paid: $5.00');
  });

  it('should throw a clear error when the tax rate is invalid', async () => {
    mockConfig(-0.05, ['Charity']);

    await expect(strategy.execute([tx('1', -10, 'Charity')])).rejects.toThrow(
      'Invalid standard tax rate',
    );
  });

  it('should propagate errors from TaxConfigService', async () => {
    vi.spyOn(TaxConfigService, 'getTaxConfig').mockRejectedValue(
      new Error('Tax API unavailable'),
    );

    await expect(strategy.execute([tx('1', -10, 'Charity')])).rejects.toThrow(
      'Tax API unavailable',
    );
  });
});
