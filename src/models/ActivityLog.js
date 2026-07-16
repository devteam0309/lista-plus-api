import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const activityLogSchema = new Schema({
  type: { type: String, default: null },
  subject: { type: String, default: null },
  amount: { type: Schema.Types.Decimal128, default: null },
  customerGlobalId: { type: String, default: null },
  refGlobalId: { type: String, default: null },
  timestamp: { type: Number, default: null },
});

activityLogSchema.plugin(syncPlugin);

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
