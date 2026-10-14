import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProviders } from '../../app/providers';
import { ValuationWorkspace } from './ValuationWorkspace';
import type { Assumptions, Calculation, SavedScenario } from '../../api/valuation';

const names = ['bear', 'base', 'bull'] as const;
let writes: { path: string; body: Record<string, unknown> }[], rows: SavedScenario[], fail: string;
function assumptions(): Assumptions {
  const c = { method: 'DIRECT' as const, fairValue: '100', rationale: 'Test-only fair value', entry: { mode: 'MARGIN' as const, minimumSafety: '20', maximumSafety: '40' }, hypotheticalPrice: '70' };
  return { cutoff: '2026-04-01T12:00:00.000Z', exchange: 'NASDAQ', cases: { bear: { ...c, fairValue: '80' }, base: c, bull: { ...c, fairValue: '120' } } };
}
function calculation(input = assumptions()): Calculation {
  return { assumptions: input, hash: 'a'.repeat(64), inputSnapshot: { instrument: { id: 'test-only', symbol: 'TEST', exchange: 'NASDAQ', currency: 'USD' }, cutoff: input.cutoff, price: null, facts: [] },
    result: { formulaVersion: 'valuation-v1', currency: 'USD', fairValueRange: { lower: '80', upper: '120' }, limitations: ['Test-only response; model-derived estimates.'],
      cases: names.map(name => ({ name, method: 'DIRECT', fairValue: name === 'bear' ? '80' : name === 'bull' ? '120' : '100', projectedMetric: null, terminalPrice: null, source: null, entryZone: { lower: '60', upper: '80', mode: 'MARGIN' }, currentPriceMarginOfSafetyPercent: null, currentPricePremiumPercent: null, plannedEntryMarginOfSafetyPercent: { atLower: '40', atUpper: '20' }, hypotheticalMarginOfSafetyPercent: '30', distanceToEntryPercent: null })) } };
}
beforeEach(() => {
  writes = []; rows = []; fail = '';
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (init?.method === 'POST') writes.push({ path, body });
    const error = (status: number, code: string, message: string) => ({ ok: false, status, json: async () => ({ error: { code, message } }) });
    if (fail === 'calculate' && path.endsWith('/calculate')) return error(422, 'VALUATION_UNAVAILABLE', 'P/E requires positive annual diluted EPS.');
    if (fail === 'save' && path.endsWith('/save')) return error(409, 'VALUATION_CONFLICT', 'Source data changed. Calculate and review again before saving.');
    let data: unknown;
    if (path.includes('/scenarios?')) data = rows;
    else if (path.includes('/sources?')) data = calculation().inputSnapshot;
    else if (path.endsWith('/calculate')) data = calculation(body as unknown as Assumptions);
    else if (path.endsWith('/save')) { const c = calculation(body.assumptions as Assumptions); const saved = { ...c, id: 'saved', seriesId: 'series-test', version: 1, createdAt: '2026-04-01T12:05:00.000Z' }; rows = [saved]; data = saved; }
    else throw Error(`Unexpected fixture route ${path}`);
    return { ok: true, status: 200, json: async () => ({ data }) };
  }));
});
function mount() { return render(<AppProviders><ValuationWorkspace symbol="TEST" exchange="NASDAQ" currency="USD" /></AppProviders>); }
async function openAndFill() {
  const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: 'Create Scenario' }));
  for (const [index, name] of ['Bear', 'Base', 'Bull'].entries()) for (const [title, value] of [['Fair value', ['80', '100', '120'][index]!], ['Rationale / source', 'My explicit test assumption'], ['Minimum planned safety (%)', '20'], ['Maximum planned safety (%)', '40']]) {
    fireEvent.change(screen.getByRole('textbox', { name: `${name} Case ${title}` }), { target: { value } });
  }
  return user;
}
it('loads without writes or examples, calculates explicitly, distinguishes planned MOS and saves reviewed exact-string inputs', async () => {
  mount(); await screen.findByText('Create a scenario to compare your assumptions.'); expect(writes).toHaveLength(0);
  const user = await openAndFill(); expect(screen.getByRole('button', { name: 'Save Scenario' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Calculate' })); await screen.findByRole('heading', { name: 'Compare Bear / Base / Bull' });
  expect(writes).toHaveLength(1); const input = writes[0]!.body as unknown as Assumptions; expect(input.cases.base).toMatchObject({ method: 'DIRECT', fairValue: '100', entry: { minimumSafety: '20', maximumSafety: '40' } });
  expect(screen.getByRole('columnheader', { name: 'Current-price MOS' })).toBeInTheDocument(); expect(screen.getByRole('columnheader', { name: 'Planned MOS at lower / upper' })).toBeInTheDocument();
  expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
  await user.click(screen.getByRole('button', { name: 'Review Calculation Details' })); expect(screen.getByText(/Prices round half-up/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save Scenario' })); await screen.findByText('Scenario saved as an immutable version.');
  expect(writes[1]!.body.expectedHash).toBe('a'.repeat(64)); expect(screen.getByRole('button', { name: 'Edit Assumptions' })).toBeInTheDocument();
});
it('editing any assumption invalidates results; Reset clears draft values and does not write', async () => {
  mount(); const user = await openAndFill(); await user.click(screen.getByRole('button', { name: 'Calculate' })); await screen.findByRole('heading', { name: 'Compare Bear / Base / Bull' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Base Case Fair value' }), { target: { value: '101' } });
  expect(screen.getByRole('button', { name: 'Save Scenario' })).toBeDisabled(); expect(screen.queryByRole('heading', { name: 'Compare Bear / Base / Bull' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reset' })); expect(screen.getByRole('textbox', { name: 'Base Case Fair value' })).toHaveValue(''); expect(writes).toHaveLength(1);
});
it('preserves assumptions on negative earnings and source-change errors and does not claim successful save', async () => {
  mount(); const user = await openAndFill(); fail = 'calculate'; await user.click(screen.getByRole('button', { name: 'Calculate' }));
  await screen.findByText('P/E requires positive annual diluted EPS.'); expect(screen.getByRole('button', { name: 'Save Scenario' })).toBeDisabled();
  fail = ''; await user.click(screen.getByRole('button', { name: 'Calculate' })); await screen.findByRole('heading', { name: 'Compare Bear / Base / Bull' });
  fail = 'save'; await user.click(screen.getByRole('button', { name: 'Save Scenario' })); await screen.findByText('Source data changed. Calculate and review again before saving.');
  expect(screen.getByRole('textbox', { name: 'Base Case Fair value' })).toHaveValue('100'); expect(screen.queryByText('Scenario saved as an immutable version.')).not.toBeInTheDocument();
});
it('saved scenario editing includes its series and expected version, while the saved snapshot remains unchanged', async () => {
  const c = calculation(); rows = [{ ...c, id: 'saved', seriesId: 'series-test', version: 2, createdAt: '2026-04-01T12:05:00.000Z' }];
  mount(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Edit Assumptions' }));
  expect(screen.getByRole('textbox', { name: 'Base Case Fair value' })).toHaveValue('100');
  fireEvent.change(screen.getByRole('textbox', { name: 'Base Case Fair value' }), { target: { value: '105' } });
  expect(rows[0]!.assumptions.cases.base).toMatchObject({ fairValue: '100' });
  await user.click(screen.getByRole('button', { name: 'Calculate' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Save Scenario' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Save Scenario' })); await screen.findByText('Scenario saved as an immutable version.');
  expect(writes[1]!.body).toMatchObject({ seriesId: 'series-test', expectedVersion: 2 });
});
