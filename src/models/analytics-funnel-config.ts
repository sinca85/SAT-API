import { Schema, model } from "mongoose";

const analyticsFunnelStepSchema = new Schema(
  {
    eventName: { type: String, required: true, trim: true, maxlength: 80 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false },
);

const analyticsFunnelConfigSchema = new Schema(
  {
    utmCampaign: { type: String, required: true, trim: true, unique: true, maxlength: 200 },
    steps: { type: [analyticsFunnelStepSchema], default: [] },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const AnalyticsFunnelConfig = model("AnalyticsFunnelConfig", analyticsFunnelConfigSchema);
