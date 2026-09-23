import { Schema, model } from "mongoose";

// Kept outside public SiteConfig and the existing Home landing document.
const autoSettingsSchema = new Schema({
  slug: { type: String, unique: true, default: "auto", enum: ["auto"] },
  sendQuoteEmail: { type: Boolean, default: true },
  sendCommercialEmailOnContract: { type: Boolean, default: true },
  contractRecipientEmail: { type: String, default: "" },
  environment: { type: String, enum: ["test", "production"], default: "test" },
  baseUrl: { type: String, default: "https://www.gsbeneficios.com.ar/WS-Seguros-desa" },
  username: { type: String, default: "" },
  passwordEncrypted: { type: String, select: false },
  authorizationEncrypted: { type: String, select: false },
  producerCode: { type: String, default: "" },
  commercialPlanCode: { type: String, default: "" },
  billingModeCode: { type: String, default: "" },
  paymentConditionCode: { type: String, default: "" },
  paymentMethodCode: { type: String, default: "" },
  personTypeCode: { type: String, default: "1" },
  useTypeCode: { type: String, default: "1" },
  ivaCode: { type: String, default: "5" },
  iibbCode: { type: String, default: "CF" },
  analyticsEnabled: { type: Boolean, default: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

export const AutoSettings = model("AutoSettings", autoSettingsSchema);
