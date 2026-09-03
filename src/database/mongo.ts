import mongoose from "mongoose";
import { env } from "../config/env.js";

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectToMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  connectionPromise ??= mongoose.connect(env.MONGODB_URI).catch((error) => {
    connectionPromise = null;
    throw error;
  });

  await connectionPromise;
}

export function mongoStatus(): string {
  const states = ["disconnected", "connected", "connecting", "disconnecting"];
  return states[mongoose.connection.readyState] ?? "unknown";
}
