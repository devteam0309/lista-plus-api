import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const creditTransactionItemSchema = new Schema({
  transactionGlobalId: { type: String, default: null, index: true },
  productGlobalId: { type: String, default: null },
  productName: { type: String, default: null },
  quantity: { type: Number, default: null },
  unit: { type: String, default: null },
  unitPrice: { type: Schema.Types.Decimal128, default: null },
  lineTotal: { type: Schema.Types.Decimal128, default: null },
});

creditTransactionItemSchema.plugin(syncPlugin);

export const CreditTransactionItem = mongoose.model(
  'CreditTransactionItem',
  creditTransactionItemSchema
);
