import { Customer } from './Customer.js';
import { Product } from './Product.js';
import { CreditTransaction } from './CreditTransaction.js';
import { CreditTransactionItem } from './CreditTransactionItem.js';
import { Payment } from './Payment.js';
import { PaymentAllocation } from './PaymentAllocation.js';
import { ActivityLog } from './ActivityLog.js';
import {
  customerPayloadSchema,
  productPayloadSchema,
  transactionPayloadSchema,
  transactionItemPayloadSchema,
  paymentPayloadSchema,
  paymentAllocationPayloadSchema,
  activityLogPayloadSchema,
} from '../validation/entity.schemas.js';

/**
 * The single source of truth mapping the wire's `entityType` to storage.
 * Adding an entity = one model + one payload schema + one row here.
 *
 * `moneyFields` are stored as Decimal128 and converted on the way in and out.
 * `fields` is the wire projection: exactly what a pulled `payload` contains.
 */
export const ENTITY_REGISTRY = {
  customer: {
    model: Customer,
    payloadSchema: customerPayloadSchema,
    moneyFields: ['creditLimit'],
    fields: ['fullName', 'nickname', 'phone', 'address', 'creditLimit', 'notes', 'isActive'],
  },
  product: {
    model: Product,
    payloadSchema: productPayloadSchema,
    moneyFields: ['price'],
    fields: ['name', 'category', 'unit', 'price', 'isActive'],
  },
  transaction: {
    model: CreditTransaction,
    payloadSchema: transactionPayloadSchema,
    moneyFields: ['totalAmount', 'amountPaid'],
    fields: [
      'customerGlobalId',
      'transactionDate',
      'totalAmount',
      'amountPaid',
      'status',
      'notes',
    ],
  },
  transaction_item: {
    model: CreditTransactionItem,
    payloadSchema: transactionItemPayloadSchema,
    moneyFields: ['unitPrice', 'lineTotal'],
    fields: [
      'transactionGlobalId',
      'productGlobalId',
      'productName',
      'quantity',
      'unit',
      'unitPrice',
      'lineTotal',
    ],
  },
  payment: {
    model: Payment,
    payloadSchema: paymentPayloadSchema,
    moneyFields: ['amount'],
    fields: ['customerGlobalId', 'amount', 'paymentDate', 'notes'],
  },
  payment_allocation: {
    model: PaymentAllocation,
    payloadSchema: paymentAllocationPayloadSchema,
    moneyFields: ['amount'],
    fields: ['paymentGlobalId', 'transactionGlobalId', 'amount'],
  },
  activity_log: {
    model: ActivityLog,
    payloadSchema: activityLogPayloadSchema,
    moneyFields: ['amount'],
    fields: ['type', 'subject', 'amount', 'customerGlobalId', 'refGlobalId', 'timestamp'],
  },
};

export const ENTITY_TYPES = Object.keys(ENTITY_REGISTRY);
