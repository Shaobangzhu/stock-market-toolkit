export function formatFinancialValue(value: string | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—';
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) || !/^[A-Z]{3}$/.test(currency)) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > Number.MAX_SAFE_INTEGER) return `${value} ${currency}`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(numeric);
}
