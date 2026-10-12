import { expect, it } from 'vitest';
import { formatFinancialValue } from './format';

it('formats normal prices for display while preserving unsafe-size exact values', () => {
  expect(formatFinancialValue('1234.5', 'USD')).toBe('$1,234.50');
  expect(formatFinancialValue('9007199254740993.12345678', 'USD')).toBe('9007199254740993.12345678 USD');
  expect(formatFinancialValue(undefined)).toBe('—');
  expect(formatFinancialValue('NaN')).toBe('—');
});
