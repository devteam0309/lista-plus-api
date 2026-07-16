import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const creditTransactionSchema = new Schema({
  customerGlobalId: { type: String, default: null, index: true },
  transactionDate: { type: Number, default: null },
  totalAmount: { type: Schema.Types.Decimal128, default: null },
  amountPaid: { type: Schema.Types.Decimal128, default: null },
  status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  notes: { type: String, default: null },
});

creditTransactionSchema.plugin(syncPlugin);

export const CreditTransaction = mongoose.model('CreditTransaction', creditTransactionSchema);
