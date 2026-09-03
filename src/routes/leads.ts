import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { syncLeadToHighLevel } from "../integrations/highlevel/leads.js";
import { Lead } from "../models/lead.js";

export const HOME_LEAD_SOURCE = "2016_08_allianz_hogar";

const homeQuotes = {
  "50": { areaLabel: "hasta 50 m²", monthlyPrice: 18_990, structureCoverage: 75_000_000 },
  "80": { areaLabel: "51 a 80 m²", monthlyPrice: 24_999, structureCoverage: 105_000_000 },
  "120": { areaLabel: "81 a 120 m²", monthlyPrice: 30_990, structureCoverage: 150_000_000 },
  "160": { areaLabel: "121 a 160 m²", monthlyPrice: 37_990, structureCoverage: 200_000_000 },
  "200": { areaLabel: "más de 160 m²", monthlyPrice: 44_990, structureCoverage: 250_000_000 },
} as const;

const homeLeadSchema = z.object({
  submissionId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(8).max(40),
  postalCode: z.string().regex(/^\d{4}$/),
  homeType: z.enum(["Casa", "Departamento", "PH", "Barrio privado"]),
  floor: z.string().trim().min(1).max(40),
  areaCode: z.enum(["50", "80", "120", "160", "200"]),
  origin: z.object({
    pageUrl: z.string().url().optional(),
    referrer: z.string().max(1000).optional(),
    utmSource: z.string().max(120).optional(),
    utmMedium: z.string().max(120).optional(),
    utmCampaign: z.string().max(160).optional(),
    utmContent: z.string().max(160).optional(),
    utmTerm: z.string().max(160).optional(),
  }).optional(),
});

export const leadsRouter = Router();

leadsRouter.post("/home", async (request, response) => {
  const input = homeLeadSchema.parse(request.body);
  const quote = homeQuotes[input.areaCode];
  const submissionId = input.submissionId ?? randomUUID();
  const existing = await Lead.findOne({ submissionId });
  if (existing) {
    response.status(200).json({ leadId: existing.id, syncStatus: existing.highLevel!.syncStatus });
    return;
  }

  const lead = await Lead.create({
    submissionId,
    source: HOME_LEAD_SOURCE,
    product: "hogar",
    insurer: "allianz",
    fullName: input.name,
    email: input.email,
    phone: input.phone,
    quote: {
      postalCode: input.postalCode,
      homeType: input.homeType,
      floor: input.floor,
      areaCode: input.areaCode,
      ...quote,
      currency: "ARS",
    },
    origin: { landing: "/hogar", channel: "landing", ...input.origin },
    highLevel: { syncStatus: "pending" },
  });

  try {
    await syncLeadToHighLevel(lead);
  } catch (error) {
    lead.highLevel!.syncStatus = "failed";
    lead.highLevel!.lastError = error instanceof Error ? error.message : "Unknown HighLevel error";
    await lead.save();
  }

  response.status(201).json({ leadId: lead.id, syncStatus: lead.highLevel!.syncStatus });
});
