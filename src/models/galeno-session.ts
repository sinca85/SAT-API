import { Schema, model } from "mongoose";
const schema = new Schema({
  key: { type: String, unique: true, required: true },
  fingerprint: String,
  tokenEncrypted: { type: String, select: false },
  expiresAt: Date,
  lockUntil: Date,
  lockOwner: String,
});
export const GalenoSession = model("GalenoSession", schema);
