import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const paymentAllocationSchema = new Schema({
  paymentGlobalId: { type: String, default: null, index: true },
  transactionGlobalId: { type: String, default: null, index: true },
  amount: { type: Schema.Types.Decimal128, default: null },
});

paymentAllocationSchema.plugin(syncPlugin);

export const PaymentAllocation = mongoose.model('PaymentAllocation', paymentAllocationSchema);
