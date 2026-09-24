import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { AnalyticsSettings } from "../models/analytics-settings.js";
import { AnalyticsCampaign } from "../models/analytics-campaign.js";
import { AnalyticsFunnelConfig } from "../models/analytics-funnel-config.js";
import { env } from "../config/env.js";
import { getAnalyticsCampaignEvents, getAnalyticsCampaignNames, getAnalyticsOverview } from "../services/google-analytics.js";

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
const dateQuery = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const utmCampaignQuery = z.object({ utmCampaign: z.string().trim().min(1).max(200) });
const funnelConfigInput = z.object({
  steps: z.array(z.object({
    eventName: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(80),
    label: z.string().trim().min(1).max(120),
  })).max(20),
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
  const configuredCampaigns = await AnalyticsCampaign.find().sort({ active: -1, name: 1 }).lean();
  const configuration = await settings();
  const discoveredCampaigns: Array<Record<string, unknown>> = [];
  const defaultCampaign = configuredCampaigns.find((campaign) => campaign.slug === "allianz-hogar") ?? configuredCampaigns[0];
  if (configuration.propertyId && defaultCampaign && env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY) {
    try {
      const names = await getAnalyticsCampaignNames(configuration.propertyId, defaultCampaign.landingPath);
      for (const name of names) {
        discoveredCampaigns.push({
          _id: `utm:${name}`,
          name: `UTM · ${name}`,
          utmCampaign: name,
          slug: name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "utm-campaign",
          landingPath: defaultCampaign.landingPath,
          stepOneEvent: defaultCampaign.stepOneEvent,
          quoteEvent: defaultCampaign.quoteEvent,
          contractEvent: defaultCampaign.contractEvent,
          active: true,
          automatic: true,
        });
      }
    } catch {
      // Keep configured campaigns available if GA4 campaign discovery is temporarily unavailable.
    }
  }
  response.json({ campaigns: [...configuredCampaigns, ...discoveredCampaigns] });
});

adminAnalyticsRouter.get("/funnel/events", requirePermission("analytics.view"), async (request, response) => {
  const { utmCampaign } = utmCampaignQuery.parse(request.query);
  const configuration = await settings();
  await ensureDefaultCampaign();
  const campaign = await AnalyticsCampaign.findOne({ slug: "allianz-hogar", active: true }).lean();
  if (!configuration.propertyId || !campaign) { response.status(400).json({ error: "Configurá la propiedad GA4 y una landing para consultar eventos." }); return; }
  if (!env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY) { response.status(400).json({ error: "Faltan las credenciales de Google Analytics." }); return; }
  try {
    const [events, funnel] = await Promise.all([
      getAnalyticsCampaignEvents(configuration.propertyId, utmCampaign, campaign.landingPath),
      AnalyticsFunnelConfig.findOne({ utmCampaign }).lean(),
    ]);
    response.json({ events, steps: funnel?.steps ?? [] });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "No se pudieron consultar los eventos de GA4." });
  }
});

adminAnalyticsRouter.put("/funnel/config", requirePermission("analytics.manage"), async (request, response) => {
  const { utmCampaign } = utmCampaignQuery.parse(request.query);
  const { steps } = funnelConfigInput.parse(request.body);
  const config = await AnalyticsFunnelConfig.findOneAndUpdate(
    { utmCampaign },
    { $set: { steps, updatedBy: request.user!.id }, $setOnInsert: { utmCampaign } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  response.json({ config });
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
  const allCampaigns = campaignId === "all";
  const utmCampaign = campaignId.startsWith("utm:") ? campaignId.slice(4) : undefined;
  const dateRange = dateQuery.parse({
    startDate: typeof request.query.startDate === "string" ? request.query.startDate : undefined,
    endDate: typeof request.query.endDate === "string" ? request.query.endDate : undefined,
  });
  if (Boolean(dateRange.startDate) !== Boolean(dateRange.endDate)) {
    response.status(400).json({ error: "Indicá ambas fechas para aplicar un rango personalizado." });
    return;
  }
  if (dateRange.startDate && dateRange.endDate && dateRange.startDate > dateRange.endDate) {
    response.status(400).json({ error: "La fecha desde no puede ser posterior a la fecha hasta." });
    return;
  }
  await ensureDefaultCampaign();
  const campaign = utmCampaign || allCampaigns
    ? await AnalyticsCampaign.findOne({ slug: "allianz-hogar", active: true }).lean()
    : (campaignId ? await AnalyticsCampaign.findById(campaignId) : null) ?? await AnalyticsCampaign.findOne({ active: true }).sort({ name: 1 });
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
    const funnelConfig = utmCampaign ? await AnalyticsFunnelConfig.findOne({ utmCampaign }).lean() : null;
    const selectedCampaign = allCampaigns ? {
      ...campaign,
      _id: "all",
      name: "Todas las campañas",
      automatic: true,
    } : utmCampaign ? {
      _id: `utm:${utmCampaign}`,
      name: `UTM · ${utmCampaign}`,
      utmCampaign,
      slug: "utm-campaign",
      landingPath: campaign.landingPath,
      stepOneEvent: campaign.stepOneEvent,
      quoteEvent: campaign.quoteEvent,
      contractEvent: campaign.contractEvent,
      active: true,
      automatic: true,
    } : campaign;
    response.json({ status: "connected", settings: configuration, campaign: selectedCampaign, overview: await getAnalyticsOverview(configuration.propertyId, campaign, dateRange, utmCampaign, funnelConfig?.steps) });
  } catch (error) {
    response.json({ status: "connection_error", settings: configuration, message: error instanceof Error ? error.message : "No se pudo consultar Google Analytics." });
  }
});

export const publicAnalyticsRouter = Router();
publicAnalyticsRouter.get("/config", async (_request, response) => {
  const configuration = await settings();
  response.json({ measurementId: configuration.measurementId });
});
