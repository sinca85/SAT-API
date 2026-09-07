import { Schema, model } from "mongoose";

const highLevelSyncStateSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    lastSyncedAt: { type: Date, required: true },
    processed: { type: Number, required: true },
    created: { type: Number, required: true },
    updated: { type: Number, required: true },
  },
  { timestamps: true },
);

export const HighLevelSyncState = model("HighLevelSyncState", highLevelSyncStateSchema);
