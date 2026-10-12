import { Prisma } from '../generated/prisma/client.js';

// Numbers may have lost precision already. Accept only exact decimal strings.
export function exactDecimal(value: string, precision: number, scale: number): Prisma.Decimal {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new TypeError('Exact decimals must be plain decimal strings.');
  }
  const [integer = '', fraction = ''] = value.replace(/^-/, '').split('.');
  if (integer.length > precision - scale || fraction.length > scale) {
    throw new RangeError('Decimal exceeds database precision or scale.');
  }
  return new Prisma.Decimal(value);
}
