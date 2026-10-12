import { dateValue, shiftDate, invalidPayload } from './market-data.js';

// Full-day 2026 closures verified 2026-10-12 against the exchanges themselves:
// https://www.nyse.com/trade/hours-calendars
// https://nasdaqtrader.com/Trader.aspx?id=Calendar
// Early-close days remain valid daily sessions. Never use federal bank holidays.
const holidays2026 = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
const exchanges = new Set(['NASDAQ', 'NYSE', 'NYSE ARCA', 'NYSE MKT', 'NYSE AMERICAN', 'AMEX']);

export function validateDailyCalendar(dates: string[], exchange: string, from: string, to: string) {
  const supported = exchanges.has(exchange);
  const verifiedFrom = from > '2026-01-01' ? from : '2026-01-01';
  const verifiedThrough = to < '2026-12-31' ? to : '2026-12-31';
  const hasVerifiedRange = supported && verifiedFrom <= verifiedThrough;
  if (hasVerifiedRange) {
    const observed = new Set(dates);
    for (const date of dates) if (holidays2026.has(date)) throw invalidPayload();
    for (let date = verifiedFrom; date <= verifiedThrough; date = shiftDate(date, 1)) {
      if (![0, 6].includes(dateValue(date).getUTCDay()) && !holidays2026.has(date) && !observed.has(date)) throw invalidPayload();
    }
  }
  return { version: 'US_DAILY_2026_v1', verifiedFrom: hasVerifiedRange ? verifiedFrom : null,
    verifiedThrough: hasVerifiedRange ? verifiedThrough : null,
    fullRequestedRangeVerified: hasVerifiedRange && from >= '2026-01-01' && to <= '2026-12-31' };
}
