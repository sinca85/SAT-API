import { Schema, model } from "mongoose";

const galenoRouteStatusSchema = new Schema({
  key: { type: String, unique: true, default: "galeno" },
  activeRoute: { type: String, enum: ["oracle", "fixie", "unconfigured"], default: "unconfigured" },
  switchedAt: { type: Date },
  lastOracleSuccessAt: { type: Date },
  lastFixieUseAt: { type: Date },
  lastError: { type: String, default: "" },
}, { timestamps: true });

export const GalenoRouteStatus = model("GalenoRouteStatus", galenoRouteStatusSchema);

