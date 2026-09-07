import { Schema, model } from "mongoose";

const analyticsSettingsSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    measurementId: { type: String, required: true, trim: true, uppercase: true },
    propertyId: { type: String, default: "", trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const AnalyticsSettings = model("AnalyticsSettings", analyticsSettingsSchema);
