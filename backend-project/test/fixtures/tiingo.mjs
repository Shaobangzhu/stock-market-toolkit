export const metadata = { ticker: 'TEST', name: 'Isolated test instrument', exchangeCode: 'NASDAQ', startDate: '2026-01-02', endDate: '2026-01-05' };
export function observation(date, extra = {}) {
  return { date: `${date}T00:00:00.000Z`, open: '10', high: '12', low: '9', close: '11', volume: '100',
    adjOpen: '10', adjHigh: '12', adjLow: '9', adjClose: '11', adjVolume: '100', divCash: '0', splitFactor: '1', ...extra };
}
export const jsonResponse = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
