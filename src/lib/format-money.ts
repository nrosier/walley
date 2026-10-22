/**
 * Formats integer cents, as Actual Budget stores them, as a localized currency string.
 * The minor-unit digits come from the currency through Intl, so zero-decimal currencies
 * such as JPY keep no fraction digits. Negative amounts keep their sign.
 */
export function formatMoney(cents: number, currency: string, locale: string): string {
  if (!Number.isFinite(cents)) {
    throw new RangeError('Cents must be a finite number');
  }
  if (!Number.isInteger(cents)) {
    throw new RangeError('Cents must be an integer');
  }
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = digits === 0 ? cents : cents / 10 ** digits;
  // Intl renders -0 with a minus sign, so normalize it to 0.
  return formatter.format(amount === 0 ? 0 : amount);
}
