import { Router } from "express";
import { z } from "zod";
import { AnalyticsSettings } from "../models/analytics-settings.js";
import { readAutoSettings, quoteConfigured } from "../services/auto-settings.js";
import { createGalenoClient, GalenoError } from "../services/galeno-client.js";
import { canStoreAutoSecrets } from "../services/auto-secrets.js";
import { locations, options, part, quoteAuto, quoteInput, versions } from "../services/galeno-quotes.js";
import { autoDemoEnabled, demoCatalog, demoQuote } from "../services/auto-demo.js";
import { Faq } from "../models/faq.js";
import { SiteConfig } from "../models/site-config.js";
import { AutoInterest } from "../models/auto-interest.js";
import { Lead } from "../models/lead.js";
import { sendAutoInterestNotificationEmail, sendAutoQuoteEmail, sendAutoSelectionNotificationEmail } from "../services/email.js";

export const autoRouter = Router();
autoRouter.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
// Lightweight burst protection; independent of Home. Upstream requests use the fixed path for the selected Galeno environment.
const buckets = new Map<string, { count: number; reset: number }>();
autoRouter.use((request, response, next) => {
  const now = Date.now();
  for (const [key, item] of buckets) if (item.reset <= now) buckets.delete(key);
  const key = `${request.ip}:${request.method === "POST" ? "quote" : "catalog"}`;
  const limit = request.method === "POST" ? 8 : 100;
  const item = buckets.get(key) ?? { count: 0, reset: now + 60000 };
  if (item.count >= limit || (!buckets.has(key) && buckets.size >= 10000)) { response.status(429).json({ error: "Realizaste varias consultas seguidas. Esperá un minuto para continuar." }); return; }
  item.count++; buckets.set(key, item); next();
});
autoRouter.get("/config", async (_request, response) => {
  const settings = await readAutoSettings();
  const whatsapp = await SiteConfig.findOne({ type: "whatsapp", active: true }).select("value").lean();
  const whatsappNumber = whatsapp?.value?.replace(/\D/g, "") || "";
  const analytics = settings.analyticsEnabled ? await AnalyticsSettings.findOne({ key: "default" }).select("measurementId").lean() : null;
  const measurementId = analytics?.measurementId || "G-WSQ0X7LXTC";
  const demo = autoDemoEnabled();
  response.json({ environment: settings.environment, mode: demo ? "demo" : "galeno", ready: demo || (quoteConfigured(settings) && canStoreAutoSecrets()), personType: settings.personTypeCode,
    whatsappUrl: whatsappNumber ? `https://wa.me/${whatsappNumber}` : "", analytics: { enabled: settings.analyticsEnabled === true, ...(settings.analyticsEnabled ? { measurementId, metaPixelId: "1378259864357969" } : {}) },
  });
});
autoRouter.get("/faqs", async (_request, response) => {
  const faqs = await Faq.find({ insurer: "galeno", product: "auto", active: true })
    .select("question answer")
    .sort({ createdAt: 1 })
    .limit(30)
    .lean();
  response.json({ faqs });
});
const query = z.object({ kind: z.enum(["brands", "models", "years", "versions", "locations"]), brand: z.string().min(1).max(40).optional(), model: z.string().min(1).max(120).optional(), year: z.string().regex(/^\d{4}$/).optional(), postalCode: z.string().regex(/^\d{4}$/).optional() }).strict();
autoRouter.get("/catalog", async (request, response) => {
  const input = query.parse(request.query);
  if (autoDemoEnabled()) { response.json({ options: demoCatalog(input) }); return; }
  const client = createGalenoClient(await readAutoSettings());
  if (input.kind === "brands") { response.json({ options: options(await client("/api/cotizadores/auto/marcas?rama=4")) }); return; }
  if (input.kind === "locations" && input.postalCode) { response.json({ options: await locations(client, input.postalCode) }); return; }
  if (input.kind === "models" && input.brand) { response.json({ options: options(await client(`/api/cotizadores/auto/modelos/${part(input.brand)}`)) }); return; }
  if (input.kind === "years" && input.brand && input.model) { response.json({ options: options(await client(`/api/cotizadores/auto/anios/${part(input.brand)}/${part(input.model)}`)) }); return; }
  if (input.kind === "versions" && input.brand && input.model && input.year) { response.json({ options: (await versions(client, input.brand, input.model, input.year)).map(({ value, label }) => ({ value, label })) }); return; }
  response.status(400).json({ error: "Faltan datos para consultar el catálogo." });
});
autoRouter.post("/quote", async (request, response) => {
  // Strict public schema: the visitor cannot override producer, payment, fiscal or person defaults.
  const input = quoteInput.parse(request.body);
  if (autoDemoEnabled()) { response.json({ quote: demoQuote(input) }); return; }
  const settings = await readAutoSettings();
  const quote = await quoteAuto(createGalenoClient(settings), settings, input);
  let leadId = "";
  let emailStatus: "sent" | "failed" | "not_configured" | "disabled" = "disabled";
  if (input.email && input.submissionId) {
    const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const matches = (item: typeof quote.coverages[number], value: string) => normalized(`${item.name} ${item.code}`).includes(value);
    const todoOptions = quote.coverages.filter((item) => matches(item, "todo riesgo"));
    const percent = (item: typeof quote.coverages[number]) => normalized(`${item.name} ${item.deductible}`).match(/(?:^|\D)(2|4)\s*%/)?.[1];
    const todo = todoOptions.find((item) => percent(item) === "2") || todoOptions.find((item) => percent(item) === "4") || todoOptions.sort((a, b) => a.firstInstallment - b.firstInstallment)[0];
    const complete = quote.coverages.find((item) => matches(item, "terceros completo black")) || quote.coverages.find((item) => matches(item, "terceros completo platinum")) || quote.coverages.filter((item) => /tercer|total/.test(normalized(item.name)) && item !== todo).sort((a, b) => b.firstInstallment - a.firstInstallment)[0];
    const essential = quote.coverages.find((item) => matches(item, "responsabilidad civil clasica")) || quote.coverages.find((item) => matches(item, "responsabilidad civil"));
    const displayed = [{ item: todo, level: "Máxima protección" }, { item: complete, level: "Cobertura completa" }, { item: essential, level: "Esencial" }]
      .filter((entry, index, list): entry is { item: typeof quote.coverages[number]; level: string } => Boolean(entry.item) && list.findIndex((candidate) => candidate.item === entry.item) === index)
      .map(({ item, level }) => ({ ...item, level }));
    let lead = await Lead.findOne({ submissionId: input.submissionId });
    if (!lead) {
      const [firstName = input.name, ...lastName] = input.name.trim().split(/\s+/);
      lead = await Lead.create({ submissionId: input.submissionId, source: "galeno-auto", product: "auto", insurer: "galeno", fullName: input.name, email: input.email, personal: { firstName, lastName: lastName.join(" "), postalCode: input.postalCode, email: input.email }, quote: { postalCode: input.postalCode, locality: input.locality, vehicle: quote.vehicle, insuredAmount: quote.insuredAmount, requestId: quote.requestId, branchCode: quote.branchCode, installationId: quote.installationId, environment: quote.environment, options: displayed, currency: "ARS" }, origin: { landing: "/auto", channel: "landing", ...input.origin }, highLevel: { syncStatus: "pending" } });
      if (settings.sendQuoteEmail) {
        try { const delivery = await sendAutoQuoteEmail({ name: input.name, email: input.email, postalCode: input.postalCode, locality: input.locality, quote: { requestId: quote.requestId, vehicle: quote.vehicle, insuredAmount: quote.insuredAmount, coverages: displayed } }); emailStatus = delivery.sent ? "sent" : "not_configured"; }
        catch (error) { emailStatus = "failed"; console.error("Could not send auto quote email", error); }
      }
    }
    leadId = lead.id;
  }
  response.json({ quote, leadId, emailStatus });
});

const selectionInput = z.object({ submissionId: z.string().uuid(), coverageCode: z.string().min(1).max(80) }).strict();
autoRouter.patch("/leads/:leadId/selection", async (request, response) => {
  const input = selectionInput.parse(request.body);
  const lead = await Lead.findOne({ _id: request.params.leadId, submissionId: input.submissionId, product: "auto" });
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  const quote = lead.quote as unknown as { postalCode: string; locality?: string; vehicle?: string; insuredAmount?: number | null; requestId?: string; options?: Array<{ code: string; name: string; level?: string; firstInstallment: number; deductible?: string; benefits: string[] }>; selectedCoverage?: { code?: string } };
  const coverage = quote.options?.find((item) => item.code === input.coverageCode);
  if (!coverage) { response.status(400).json({ error: "La cobertura elegida no pertenece a esta cotización." }); return; }
  const alreadySelected = quote.selectedCoverage?.code === coverage.code;
  lead.set("quote.selectedCoverage", coverage); lead.set("quote.monthlyPrice", coverage.firstInstallment); lead.status = "interested"; await lead.save();
  const settings = await readAutoSettings();
  if (!alreadySelected && settings.sendCommercialEmailOnContract) {
    try { await sendAutoSelectionNotificationEmail({ name: lead.fullName, email: lead.email, postalCode: quote.postalCode, locality: quote.locality || "", quote: { requestId: quote.requestId || "", vehicle: quote.vehicle || "", insuredAmount: quote.insuredAmount ?? null, coverages: quote.options || [] }, coverage }, settings.contractRecipientEmail); }
    catch (error) { console.error("Could not send auto selection notification", error); }
  }
  response.json({ leadId: lead.id, selectedCoverage: coverage.code });
});
const interestInput = z.object({
  submissionId: z.string().uuid(), requestId: z.string().max(120), branchCode: z.string().max(40), installationId: z.string().max(80), vehicle: z.string().min(1).max(240),
  coverageCode: z.string().min(1).max(80), coverageName: z.string().min(1).max(180), monthlyPrice: z.number().finite().nonnegative(), deductible: z.string().max(180),
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80), dni: z.string().regex(/^\d{6,8}$/),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), address: z.string().trim().min(3).max(180), postalCode: z.string().trim().min(4).max(8),
  email: z.string().email().max(254), phone: z.string().regex(/^\+?[\d\s()-]{8,24}$/), licensePlate: z.string().trim().min(5).max(10),
  engineNumber: z.string().trim().min(4).max(40), chassisNumber: z.string().trim().min(6).max(40),
}).strict();
autoRouter.post("/interest", async (request, response) => {
  const input = interestInput.parse(request.body);
  const existing = await AutoInterest.findOne({ submissionId: input.submissionId });
  if (existing) { response.json({ interestId: existing.id }); return; }
  const interest = await AutoInterest.create(input);
  const settings = await readAutoSettings();
  if (settings.sendCommercialEmailOnContract) {
    try { await sendAutoInterestNotificationEmail({ ...input, fullName: `${input.firstName} ${input.lastName}` }, settings.contractRecipientEmail); }
    catch (error) { console.error("Could not send auto interest notification", error); }
  }
  response.status(201).json({ interestId: interest.id });
});
autoRouter.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof GalenoError) { response.status(error.status).json({ error: error.code === "credentials_missing" || error.code === "credentials_unavailable" ? "El cotizador todavía no está disponible. Intentá más tarde." : error.message, code: error.code }); return; }
  if (error instanceof z.ZodError) { response.status(400).json({ error: "Revisá los datos del vehículo, localidad, vigencia y GNC." }); return; }
  next(error);
});
