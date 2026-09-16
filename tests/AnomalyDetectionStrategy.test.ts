import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Transaction } from '../src/models.js';
import { AnomalyRulesService } from '../src/services/AnomalyRulesService.js';
import { AnomalyDetectionStrategy } from '../src/strategies/AnomalyDetectionStrategy.js';

describe('AnomalyDetectionStrategy', () => {
  let strategy: AnomalyDetectionStrategy;

  beforeEach(() => {
    strategy = new AnomalyDetectionStrategy();
    vi.restoreAllMocks();
  });

  it('Scenario 1: Detects outliers, duplicates, and flagged statuses correctly', async () => {
    // Mock the external service call using valid union types
    vi.spyOn(AnomalyRulesService, 'getRules').mockResolvedValue({
      maxTransactionAmount: 500,
      flaggedStatuses: ['flagged', 'pending'],
    });

    const mockTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-01',
        category: 'Rent',
        description: 'Monthly Rent',
        amount: -1200,
        status: 'completed',
      }, // Outlier
      {
        id: '2',
        date: '2026-01-02',
        category: 'Food',
        description: 'Grocery Store',
        amount: -50,
        status: 'completed',
      }, // Duplicate 1
      {
        id: '3',
        date: '2026-01-02',
        category: 'Food',
        description: 'Grocery Store',
        amount: -50,
        status: 'completed',
      }, // Duplicate 2
      {
        id: '4',
        date: '2026-01-03',
        category: 'Tech',
        description: 'Software Subscription',
        amount: -20,
        status: 'flagged',
      }, // Flagged status
      {
        id: '5',
        date: '2026-01-04',
        category: 'Coffee',
        description: 'Cafe',
        amount: -5,
        status: 'completed',
      }, // Normal
    ];

    const report = await strategy.execute(mockTransactions);

    // Assertions
    expect(report).toContain('Monthly Rent');
    expect(report).toContain('Group #1 (2 identical records)');
    expect(report).toContain('Software Subscription');
    expect(report).toContain('Total Transactions Analyzed: 5');
    expect(report).toContain('Total Anomalous Transactions: 4');
    expect(report).toContain('Anomaly Rate: 80.00%');
  });

  it('Scenario 2: Handles an empty dataset or clean dataset without crashing', async () => {
    vi.spyOn(AnomalyRulesService, 'getRules').mockResolvedValue({
      maxTransactionAmount: 1000,
      flaggedStatuses: ['flagged'],
    });

    const mockTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-01',
        category: 'Food',
        description: 'Lunch',
        amount: -15,
        status: 'completed',
      },
    ];

    const report = await strategy.execute(mockTransactions);

    expect(report).toContain('No outlier transactions found.');
    expect(report).toContain('No duplicate transactions found.');
    expect(report).toContain('No transactions with flagged statuses found.');
    expect(report).toContain('Total Transactions Analyzed: 1');
    expect(report).toContain('Total Anomalous Transactions: 0');
    expect(report).toContain('Anomaly Rate: 0.00%');
  });

  it('Scenario 3: Correctly deduplicates transactions that trigger multiple anomaly rules', async () => {
    vi.spyOn(AnomalyRulesService, 'getRules').mockResolvedValue({
      maxTransactionAmount: 200,
      flaggedStatuses: ['flagged'],
    });

    // Transaction #1 is both an outlier (>200) AND flagged
    const mockTransactions: Transaction[] = [
      {
        id: '1',
        date: '2026-01-01',
        category: 'Electronics',
        description: 'TV',
        amount: -500,
        status: 'flagged',
      },
    ];

    const report = await strategy.execute(mockTransactions);

    // Should count as 1 unique anomaly, not 2
    expect(report).toContain('Total Transactions Analyzed: 1');
    expect(report).toContain('Total Anomalous Transactions: 1');
    expect(report).toContain('Anomaly Rate: 100.00%');
  });
});
