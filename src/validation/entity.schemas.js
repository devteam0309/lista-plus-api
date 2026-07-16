import { z } from 'zod';

/**
 * Payload schemas — one per entityType. These mirror the Android Room entities.
 *
 * Unknown keys are stripped (Zod default), so the server silently ignores fields
 * a newer client sends. If the app adds a column that must survive a backup /
 * restore round-trip, it MUST be added here too or it will be dropped.
 */

// Foreign keys are globalIds, never local Room ints. Validating as UUID here is
// deliberate: if the client migration regresses and starts sending "42", the
// push fails loudly instead of writing an unjoinable orphan row.
const uuid = z.string().uuid();
const nullableUuid = uuid.nullish().transform((v) => v ?? null);
const text = z
  .string()
  .max(2000)
  .nullish()
  .transform((v) => v ?? null);
const money = z
  .number()
  .finite()
  .nullish()
  .transform((v) => v ?? null);
const epochMillis = z
  .number()
  .int()
  .nonnegative()
  .nullish()
  .transform((v) => v ?? null);

export const customerPayloadSchema = z.object({
  fullName: text,
  nickname: text,
  phone: text,
  address: text,
  creditLimit: money,
  notes: text,
  isActive: z
    .boolean()
    .nullish()
    .transform((v) => v ?? true),
});

export const productPayloadSchema = z.object({
  name: text,
  category: text,
  unit: text,
  price: money,
  isActive: z
    .boolean()
    .nullish()
    .transform((v) => v ?? true),
});

export const transactionPayloadSchema = z.object({
  customerGlobalId: uuid,
  transactionDate: epochMillis,
  totalAmount: money,
  amountPaid: money,
  status: z
    .enum(['unpaid', 'partial', 'paid'])
    .nullish()
    .transform((v) => v ?? 'unpaid'),
  notes: text,
});

export const transactionItemPayloadSchema = z.object({
  transactionGlobalId: uuid,
  productGlobalId: nullableUuid,
  productName: text,
  quantity: z
    .number()
    .finite()
    .nullish()
    .transform((v) => v ?? null),
  unit: text,
  unitPrice: money,
  lineTotal: money,
});

export const paymentPayloadSchema = z.object({
  customerGlobalId: uuid,
  amount: money,
  paymentDate: epochMillis,
  notes: text,
});

export const paymentAllocationPayloadSchema = z.object({
  paymentGlobalId: uuid,
  transactionGlobalId: uuid,
  amount: money,
});

export const activityLogPayloadSchema = z.object({
  type: text,
  subject: text,
  amount: money,
  customerGlobalId: nullableUuid,
  refGlobalId: nullableUuid,
  timestamp: epochMillis,
});
