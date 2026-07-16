import mongoose from 'mongoose';

const { Decimal128 } = mongoose.Types;

/**
 * Peso amounts are stored as Decimal128 so repeated add/subtract on a ledger
 * never drifts the way binary floats do. Four decimal places leaves headroom
 * below the centavo for unit prices like 3.3333.
 */
export function toDecimal(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`Not a finite money value: ${value}`);
  return Decimal128.fromString(n.toFixed(4));
}

/**
 * Back to a JSON number for the wire. The Android client's Room entities use
 * Double for money, so the contract is a number — the precision guarantee is
 * about what the server *stores* and computes with, not the transport.
 */
export function fromDecimal(value) {
  if (value === null || value === undefined) return null;
  return Number(value.toString());
}
