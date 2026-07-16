import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const customerSchema = new Schema({
  fullName: { type: String, default: null },
  nickname: { type: String, default: null },
  phone: { type: String, default: null },
  address: { type: String, default: null },
  creditLimit: { type: Schema.Types.Decimal128, default: null },
  notes: { type: String, default: null },
  isActive: { type: Boolean, default: true },
});

customerSchema.plugin(syncPlugin);

export const Customer = mongoose.model('Customer', customerSchema);
