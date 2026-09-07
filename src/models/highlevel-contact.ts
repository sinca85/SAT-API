import { Schema, model } from "mongoose";

const highLevelContactSchema = new Schema(
  {
    highLevelId: { type: String, trim: true, index: true, unique: true, sparse: true },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    fullName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true, index: true },
    phone: { type: String, default: "", trim: true, index: true },
    tags: { type: [String], default: [] },
    dateAdded: Date,
    source: { type: String, enum: ["highlevel", "landing"], default: "highlevel", required: true },
    highLevelData: { type: Schema.Types.Mixed, default: {} },
    lastHighLevelSyncAt: Date,
  },
  { timestamps: true },
);

highLevelContactSchema.index({ email: 1, updatedAt: -1 });

export const HighLevelContact = model("HighLevelContact", highLevelContactSchema);
