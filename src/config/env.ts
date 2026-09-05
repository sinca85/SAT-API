import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/sat_api"),
  SESSION_SECRET: z.string().min(32).default("local-development-secret-change-me"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3001/auth/google/callback"),
  AUTH_SUCCESS_REDIRECT: z.string().url().default("http://localhost:5173/admin"),
  AUTH_FAILURE_REDIRECT: z
    .string()
    .url()
    .default("http://localhost:5173/login?error=google"),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
  HIGHLEVEL_LOCATION_ID: z.string().optional(),
  HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN: z.string().optional(),
  HIGHLEVEL_CLIENT_ID: z.string().optional(),
  HIGHLEVEL_CLIENT_SECRET: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  AI_CHAT_RATE_PER_MINUTE: z.coerce.number().int().positive().default(5),
  AI_CHAT_DAILY_RATE: z.coerce.number().int().positive().default(30),
  AI_CHAT_MAX_QUESTION_LENGTH: z.coerce.number().int().positive().default(500),
  AI_MAX_DOCUMENT_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const bootstrapAdminEmails = new Set(
  env.BOOTSTRAP_ADMIN_EMAILS.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
