import mongoose from "mongoose";
import { env } from "../config/env.js";

export async function connectToMongo(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
}

export function mongoStatus(): string {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] ?? "unknown";
}
