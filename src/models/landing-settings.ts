import { Schema, model } from "mongoose";

const landingSettingsSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    publicUrl: { type: String, required: true, trim: true, maxlength: 500 },
    sendQuoteEmail: { type: Boolean, default: true, required: true },
    sendCommercialEmailOnContract: { type: Boolean, default: true, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const LandingSettings = model("LandingSettings", landingSettingsSchema);
