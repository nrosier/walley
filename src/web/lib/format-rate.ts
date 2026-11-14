/**
 * A rate as plain decimal text, never in exponent notation (`1e-7` becomes `0.0000001`): the server's override
 * rate pattern rejects exponents. Up to 12 decimals, trailing zeros trimmed. A value `String` writes without an exponent is returned as is (no float noise). A non-finite or huge value is returned as `String(n)`.
 */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || Math.abs(rate) >= 1e21) return String(rate);
  const plain = String(rate);
  if (!plain.includes('e')) return plain === '-0' ? '0' : plain;
  const fixed = rate.toFixed(12);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}
