import { Schema, model } from "mongoose";

export const accessPermissions = [
  "leads.view",
  "leads.manage",
  "leads.delete",
  "users.view",
  "users.manage",
  "roles.manage",
  "highlevel.view",
  "highlevel.contacts.view",
  "faqs.view",
  "faqs.manage",
  "ai.view",
  "ai.manage",
] as const;

export type AccessPermission = (typeof accessPermissions)[number] | "*";

const roleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    description: { type: String, default: "", trim: true, maxlength: 240 },
    permissions: { type: [String], default: [] },
    system: { type: Boolean, default: false, required: true },
  },
  { timestamps: true },
);

export const Role = model("Role", roleSchema);
