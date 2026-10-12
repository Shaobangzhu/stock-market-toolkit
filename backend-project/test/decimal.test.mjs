import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exactDecimal } from '../dist/utils/decimal.js';

test('exact monetary persistence rejects JS numbers, nonfinite values, and silent rounding', () => {
  assert.equal(exactDecimal('9007199254740993.12345678', 24, 8).toFixed(), '9007199254740993.12345678');
  for (const input of [0.1, NaN, Infinity, 'NaN', 'Infinity', '1e3', ' 1', '01', '-']) {
    assert.throws(() => exactDecimal(input, 24, 8), TypeError);
  }
  for (const input of ['0.123456789', '10000000000000000']) {
    assert.throws(() => exactDecimal(input, 24, 8), RangeError);
  }
});
