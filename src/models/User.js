import mongoose from 'mongoose';

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    googleSub: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    displayName: { type: String, default: null },
    storeName: { type: String, default: null },
    ownerName: { type: String, default: null },
    premium: { type: Boolean, default: false },
    premiumSince: { type: Number, default: null },

    // Play Billing bookkeeping — lets us recognise a replayed purchase token
    // and gives support something to look at when a user disputes entitlement.
    purchaseToken: { type: String, default: null },
    purchaseProductId: { type: String, default: null },
    purchaseOrderId: { type: String, default: null },
  },
  { timestamps: true }
);

// One purchase unlocks one account. The controller checks this before writing,
// but only this index closes the race between two concurrent verifies of the
// same token. Partial: most users hold null, which must not collide.
userSchema.index(
  { purchaseToken: 1 },
  { unique: true, partialFilterExpression: { purchaseToken: { $type: 'string' } } }
);

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName,
    premium: this.premium,
    premiumSince: this.premiumSince ?? null,
  };
};

export const User = mongoose.model('User', userSchema);
