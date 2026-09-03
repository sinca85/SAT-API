import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "sat-api" });
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});
