import type { Preferences, SettingsStatus } from '../../api/settings';
// Isolated component-test fixtures only; never served by the runtime application.
export const preferenceFixture: Preferences = { lookbackYears: 5, detailLevel: 'standard', includeTechnical: true, includeFundamentals: true, includeNews: true, monthlyBudgetUsd: null };
export const settingsFixture: SettingsStatus = {
  providers: ['TIINGO', 'SEC_EDGAR', 'OPENAI'].map(id => ({ id, configured: false, status: 'Not Configured', lastSuccess: null, lastError: null, quota: null })),
  database: { status: 'Connected', name: 'isolated_test_database', version: '18', instruments: 0, priceRecords: 0, researchReports: 0, earliestPriceDate: null, latestPriceDate: null, lastSync: null },
  pendingJobs: 0, availableProviders: 0, aiConfigured: false, environment: { mode: 'local-only', frontendOrigin: 'http://localhost:5173', backend: 'http://127.0.0.1:7001', model: 'test-only' }, checkedAt: '2026-06-01T12:00:00Z',
};
