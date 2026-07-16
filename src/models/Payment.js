import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const paymentSchema = new Schema({
  customerGlobalId: { type: String, default: null, index: true },
  amount: { type: Schema.Types.Decimal128, default: null },
  paymentDate: { type: Number, default: null },
  notes: { type: String, default: null },
});

paymentSchema.plugin(syncPlugin);

export const Payment = mongoose.model('Payment', paymentSchema);
