import { Schema, model } from "mongoose";

const analyticsCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 80 },
    landingPath: { type: String, required: true, trim: true, maxlength: 240 },
    stepOneEvent: { type: String, required: true, trim: true, maxlength: 80 },
    quoteEvent: { type: String, required: true, trim: true, maxlength: 80 },
    contractEvent: { type: String, required: true, trim: true, maxlength: 80 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const AnalyticsCampaign = model("AnalyticsCampaign", analyticsCampaignSchema);
