import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  HIGHLEVEL_LOCATION_ID: z.string().optional(),
  HIGHLEVEL_API_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
