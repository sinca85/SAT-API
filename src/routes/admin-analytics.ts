import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { AnalyticsSettings } from "../models/analytics-settings.js";
import { AnalyticsCampaign } from "../models/analytics-campaign.js";
import { env } from "../config/env.js";
import { getAnalyticsOverview } from "../services/google-analytics.js";

const defaultMeasurementId = "G-WSQ0X7LXTC";
const settingsInput = z.object({
  measurementId: z.string().trim().toUpperCase().regex(/^G-[A-Z0-9]+$/, "Ingresá un Measurement ID válido, por ejemplo G-ABC123"),
  propertyId: z.string().trim().regex(/^\d*$/, "El Property ID debe contener solo números").max(32).default(""),
});
const campaignInput = z.object({
  name: z.string().trim().min(3).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80),
  landingPath: z.string().trim().startsWith("/").max(240),
  stepOneEvent: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(80),
  quoteEvent: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(80),
  contractEvent: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(80),
  active: z.boolean().default(true),
});

async function settings() {
  return AnalyticsSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { key: "default", measurementId: defaultMeasurementId } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

async function ensureDefaultCampaign() {
  await AnalyticsCampaign.findOneAndUpdate(
    { slug: "allianz-hogar" },
    { $setOnInsert: { name: "Allianz · Hogar", slug: "allianz-hogar", landingPath: "/hogar", stepOneEvent: "cotizador_continuar", quoteEvent: "cotizador_ver_cotizacion", contractEvent: "cotizador_solicitud_contratacion", active: true } },
    { upsert: true, setDefaultsOnInsert: true },
  );
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

adminAnalyticsRouter.get("/campaigns", requirePermission("analytics.view"), async (_request, response) => {
  await ensureDefaultCampaign();
  response.json({ campaigns: await AnalyticsCampaign.find().sort({ active: -1, name: 1 }).lean() });
});

adminAnalyticsRouter.post("/campaigns", requirePermission("analytics.manage"), async (request, response) => {
  const campaign = await AnalyticsCampaign.create(campaignInput.parse(request.body));
  response.status(201).json({ campaign });
});

adminAnalyticsRouter.patch("/campaigns/:campaignId", requirePermission("analytics.manage"), async (request, response) => {
  const campaign = await AnalyticsCampaign.findByIdAndUpdate(request.params.campaignId, campaignInput.parse(request.body), { new: true, runValidators: true });
  if (!campaign) { response.status(404).json({ error: "Campaña no encontrada" }); return; }
  response.json({ campaign });
});

adminAnalyticsRouter.delete("/campaigns/:campaignId", requirePermission("analytics.manage"), async (request, response) => {
  const campaign = await AnalyticsCampaign.findByIdAndDelete(request.params.campaignId);
  if (!campaign) { response.status(404).json({ error: "Campaña no encontrada" }); return; }
  response.status(204).end();
});

adminAnalyticsRouter.get("/overview", requirePermission("analytics.view"), async (request, response) => {
  const configuration = await settings();
  await ensureDefaultCampaign();
  const campaignId = typeof request.query.campaignId === "string" ? request.query.campaignId : "";
  const campaign = (campaignId ? await AnalyticsCampaign.findById(campaignId) : null) ?? await AnalyticsCampaign.findOne({ active: true }).sort({ name: 1 });
  if (!campaign) { response.json({ status: "needs_campaign", settings: configuration, message: "Creá una campaña para ver su embudo." }); return; }
  if (!configuration.propertyId) {
    response.json({ status: "needs_property_id", settings: configuration, message: "Cargá el Property ID numérico de GA4 para conectar las métricas." });
    return;
  }
  if (!env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY) {
    response.json({ status: "needs_credentials", settings: configuration, message: "Faltan las credenciales de cuenta de servicio de Google Analytics en Vercel." });
    return;
  }
  try {
    response.json({ status: "connected", settings: configuration, campaign, overview: await getAnalyticsOverview(configuration.propertyId, campaign) });
  } catch (error) {
    response.json({ status: "connection_error", settings: configuration, message: error instanceof Error ? error.message : "No se pudo consultar Google Analytics." });
  }
});

export const publicAnalyticsRouter = Router();
publicAnalyticsRouter.get("/config", async (_request, response) => {
  const configuration = await settings();
  response.json({ measurementId: configuration.measurementId });
});
