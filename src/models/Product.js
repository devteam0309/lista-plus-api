import mongoose from 'mongoose';
import { syncPlugin } from './syncPlugin.js';

const { Schema } = mongoose;

const productSchema = new Schema({
  name: { type: String, default: null },
  category: { type: String, default: null },
  unit: { type: String, default: null },
  price: { type: Schema.Types.Decimal128, default: null },
  isActive: { type: Boolean, default: true },
});

productSchema.plugin(syncPlugin);

export const Product = mongoose.model('Product', productSchema);
