import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { syncLeadToHighLevel } from "../integrations/highlevel/leads.js";
import { ALLIANZ_HOME_SOURCE } from "../integrations/highlevel/campaigns/index.js";
import { Lead } from "../models/lead.js";
import { getHomeQuote, getHomeQuoteOptions } from "../services/home-quotes.js";

export const HOME_LEAD_SOURCE = ALLIANZ_HOME_SOURCE;

const argentinaPhone = z.string().trim().min(8).max(24).refine(
  (value) => /^\+?[\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15,
  "Ingresá un teléfono válido de entre 8 y 15 números",
);

const homeLeadSchema = z.object({
  submissionId: z.string().uuid().optional(),
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  phone: argentinaPhone,
  postalCode: z.string().regex(/^\d{4}$/),
  homeType: z.enum(["Casa", "Departamento", "PH", "Barrio privado"]),
  floor: z.string().trim().min(1).max(40),
  squareMeters: z.number().int().min(30).max(200),
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

const homeContractSchema = z.object({
  submissionId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dni: z.string().trim().min(6).max(30),
  dateOfBirth: z.string().date(),
  address: z.string().trim().min(3).max(250),
  floor: z.string().trim().min(1).max(40),
  apartment: z.string().trim().max(40),
  postalCode: z.string().trim().min(4).max(20),
  email: z.string().trim().email().max(254),
  phone: argentinaPhone,
});

export const leadsRouter = Router();

leadsRouter.get("/home/quote", async (request, response) => {
  const squareMeters = z.coerce.number().int().min(30).max(200).parse(request.query.squareMeters);
  response.json({ quote: await getHomeQuote(squareMeters), options: await getHomeQuoteOptions() });
});

leadsRouter.post("/home", async (request, response) => {
  const input = homeLeadSchema.parse(request.body);
  const quote = await getHomeQuote(input.squareMeters);
  const submissionId = input.submissionId ?? randomUUID();
  const existing = await Lead.findOne({ submissionId });
  if (existing) {
    response.status(200).json({ leadId: existing.id, syncStatus: existing.highLevel!.syncStatus });
    return;
  }

  const [firstName = input.name, ...lastNameParts] = input.name.trim().split(/\s+/);

  const lead = await Lead.create({
    submissionId,
    source: HOME_LEAD_SOURCE,
    product: "hogar",
    insurer: "allianz",
    fullName: input.name,
    email: input.email,
    phone: input.phone,
    personal: {
      firstName,
      lastName: lastNameParts.join(" "),
      dni: "",
      dateOfBirth: "",
      address: "",
      floor: input.floor,
      apartment: "",
      postalCode: input.postalCode,
      email: input.email,
      phone: input.phone,
    },
    quote: {
      postalCode: input.postalCode,
      homeType: input.homeType,
      floor: input.floor,
      areaCode: String(quote.quotedSquareMeters),
      ...quote,
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

  response.status(201).json({ leadId: lead.id, syncStatus: lead.highLevel!.syncStatus, quote });
});

leadsRouter.patch("/home/:leadId/contract", async (request, response) => {
  const input = homeContractSchema.parse(request.body);
  const lead = await Lead.findOne({ _id: request.params.leadId, submissionId: input.submissionId, source: HOME_LEAD_SOURCE });
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }

  lead.personal = {
    firstName: input.firstName,
    lastName: input.lastName,
    dni: input.dni,
    dateOfBirth: input.dateOfBirth,
    address: input.address,
    floor: input.floor,
    apartment: input.apartment,
    postalCode: input.postalCode,
    email: input.email,
    phone: input.phone,
  };
  lead.fullName = `${input.firstName} ${input.lastName}`.trim();
  lead.email = input.email;
  lead.phone = input.phone;
  lead.status = "interested";
  try {
    await syncLeadToHighLevel(lead);
  } catch (error) {
    lead.highLevel!.syncStatus = "failed";
    lead.highLevel!.lastError = error instanceof Error ? error.message : "Unknown HighLevel error";
    await lead.save();
  }
  response.json({ leadId: lead.id, syncStatus: lead.highLevel!.syncStatus });
});
