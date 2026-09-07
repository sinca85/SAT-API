import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { AnalyticsSettings } from "../models/analytics-settings.js";
import { env } from "../config/env.js";
import { getAnalyticsOverview } from "../services/google-analytics.js";

const defaultMeasurementId = "G-WSQ0X7LXTC";
const settingsInput = z.object({
  measurementId: z.string().trim().toUpperCase().regex(/^G-[A-Z0-9]+$/, "Ingresá un Measurement ID válido, por ejemplo G-ABC123"),
  propertyId: z.string().trim().regex(/^\d*$/, "El Property ID debe contener solo números").max(32).default(""),
});

async function settings() {
  return AnalyticsSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", measurementId: defaultMeasurementId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

export const adminAnalyticsRouter = Router();
adminAnalyticsRouter.use(requireAuthentication, requireActiveUser);

adminAnalyticsRouter.get("/settings", requirePermission("config.view"), async (_request, response) => {
  response.json({ settings: await settings() });
});

adminAnalyticsRouter.put("/settings", requirePermission("config.manage"), async (request, response) => {
  const input = settingsInput.parse(request.body);
  const updated = await AnalyticsSettings.findOneAndUpdate(
    { key: "default" },
    { $set: { ...input, updatedBy: request.user!.id }, $setOnInsert: { key: "default" } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  response.json({ settings: updated });
});

adminAnalyticsRouter.get("/overview", requirePermission("analytics.view"), async (_request, response) => {
  const configuration = await settings();
  if (!configuration.propertyId) {
    response.json({ status: "needs_property_id", settings: configuration, message: "Cargá el Property ID numérico de GA4 para conectar las métricas." });
    return;
  }
  if (!env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY) {
    response.json({ status: "needs_credentials", settings: configuration, message: "Faltan las credenciales de cuenta de servicio de Google Analytics en Vercel." });
    return;
  }
  try {
    response.json({ status: "connected", settings: configuration, overview: await getAnalyticsOverview(configuration.propertyId) });
  } catch (error) {
    response.json({ status: "connection_error", settings: configuration, message: error instanceof Error ? error.message : "No se pudo consultar Google Analytics." });
  }
});

export const publicAnalyticsRouter = Router();
publicAnalyticsRouter.get("/config", async (_request, response) => {
  const configuration = await settings();
  response.json({ measurementId: configuration.measurementId });
});
