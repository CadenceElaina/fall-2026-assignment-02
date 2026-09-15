import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetLimitStrategy } from '../src/strategies/BudgetLimitStrategy.js';
import { BudgetService } from '../src/services/BudgetService.js';
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

describe('BudgetLimitStrategy (Feature 1)', () => {
  let strategy: BudgetLimitStrategy;

  beforeEach(() => {
    strategy = new BudgetLimitStrategy();
    vi.restoreAllMocks();
  });

  it('should fetch budgets from BudgetService exactly once', async () => {
    const spy = vi
      .spyOn(BudgetService, 'getCategoryBudgets')
      .mockResolvedValue({ Food: 100 });

    await strategy.execute([tx('1', -10, 'Food')]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should group expenses correctly by category and sum them', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 500,
      Rent: 2000,
    });

    const result = await strategy.execute([
      tx('1', -40.25, 'Food'),
      tx('2', -59.75, 'Food'),
      tx('3', -1000, 'Rent'),
      tx('4', 2500, 'Salary'), // income: must be ignored
    ]);

    expect(result).toContain('Food: Budget $500.00 | Spent $100.00');
    expect(result).toContain('Rent: Budget $2000.00 | Spent $1000.00');
    expect(result).not.toContain('Salary');
  });

  it('should calculate absolute overage amounts and percentage exceeded', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 100,
      Rent: 1000,
    });

    const result = await strategy.execute([
      tx('1', -150, 'Food'), // spent $150 of $100: overage $50, 150%
      tx('2', -900, 'Rent'), // under budget
    ]);

    expect(result).toContain(
      'OVER BUDGET: Food - Spent $150.00 of $100.00 | Overage $50.00 | 150.0% of budget',
    );
    expect(result).not.toContain('OVER BUDGET: Rent');
  });

  it('should list the specific transactions contributing to categories that are over budget', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 50,
      Transport: 100,
    });

    const result = await strategy.execute([
      tx('f1', -30, 'Food', 'Grocery run'),
      tx('f2', -45.5, 'Food', 'Takeout'),
      tx('t1', -20, 'Transport', 'Bus pass'),
    ]);

    const itemized = result.split('Transactions Contributing to Overages:')[1];
    expect(itemized).toContain('f1 | 2026-05-01 | Grocery run | $30.00');
    expect(itemized).toContain('f2 | 2026-05-01 | Takeout | $45.50');
    expect(itemized).not.toContain('t1');
  });

  it('should handle scenarios where no categories are over budget', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 100,
    });

    const result = await strategy.execute([tx('1', -99.99, 'Food')]);

    expect(result).toContain('No categories are over budget.');
    expect(result).not.toContain('OVER BUDGET:');
  });

  it('should not flag spending exactly at the limit despite floating point sums', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 0.3,
    });

    // 0.1 + 0.2 === 0.30000000000000004 in JavaScript
    const result = await strategy.execute([
      tx('1', -0.1, 'Food'),
      tx('2', -0.2, 'Food'),
    ]);

    expect(result).toContain('No categories are over budget.');
  });

  it('should show categories with spending but no budget without flagging them', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 100,
    });

    const result = await strategy.execute([tx('1', -350, 'Business')]);

    expect(result).toContain('Business: Budget No budget set | Spent $350.00');
    expect(result).not.toContain('OVER BUDGET: Business');
  });

  it('should report a $0 budget overage without dividing by zero', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Gifts: 0,
    });

    const result = await strategy.execute([tx('1', -25, 'Gifts')]);

    expect(result).toContain('Overage $25.00 | N/A (budget is $0.00)');
    expect(result).not.toContain('Infinity');
  });

  it('should handle empty transaction list gracefully', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({
      Food: 150,
      Rent: 1200,
    });

    const result = await strategy.execute([]);

    expect(result).toContain('Food: Budget $150.00 | Spent $0.00');
    expect(result).toContain('Rent: Budget $1200.00 | Spent $0.00');
    expect(result).toContain('No categories are over budget.');
  });

  it('should handle an empty budget list and no transactions', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockResolvedValue({});

    const result = await strategy.execute([]);

    expect(result).toContain('No budgets or expenses found.');
  });

  it('should propagate errors from BudgetService', async () => {
    vi.spyOn(BudgetService, 'getCategoryBudgets').mockRejectedValue(
      new Error('Budget API unavailable'),
    );

    await expect(strategy.execute([tx('1', -10, 'Food')])).rejects.toThrow(
      'Budget API unavailable',
    );
  });
});
