import { Schema, model } from "mongoose";

export const siteConfigTypes = ["email", "whatsapp", "direccion", "red_social"] as const;
export type SiteConfigType = (typeof siteConfigTypes)[number];

export const siteConfigCategories = ["contactos", "ubicacion", "redes_sociales"] as const;
export type SiteConfigCategory = (typeof siteConfigCategories)[number];

const siteConfigSchema = new Schema({
  slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true, maxlength: 120 },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  value: { type: String, required: true, trim: true, maxlength: 1000 },
  type: { type: String, required: true, enum: siteConfigTypes, index: true },
  category: { type: String, required: true, enum: siteConfigCategories, index: true },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

export const SiteConfig = model("SiteConfig", siteConfigSchema);
