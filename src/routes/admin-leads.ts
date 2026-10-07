import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { Lead, leadStatuses } from "../models/lead.js";
import { syncLeadToHighLevel } from "../integrations/highlevel/leads.js";
import { buildHomeQuoteEmail, sendHomeQuoteEmail, type HomeQuoteEmailInput } from "../services/email.js";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  source: z.string().trim().optional(),
  product: z.enum(["hogar", "auto"]).optional(),
  status: z.enum(leadStatuses).optional(),
  sortBy: z.enum(["fullName", "monthlyPrice", "utmCampaign", "status", "syncStatus", "createdAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const editablePhone = z.string().trim().max(24).refine(
  (value) => !value || (/^\+?[\d\s()-]+$/.test(value) && value.replace(/\D/g, "").length >= 8 && value.replace(/\D/g, "").length <= 15),
  "Ingresá un teléfono válido de entre 8 y 15 números",
);

const updateSchema = z.object({
  status: z.enum(leadStatuses).optional(),
  pinned: z.boolean().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  lossReason: z.string().trim().max(500).nullable().optional(),
  personal: z.object({
    firstName: z.string().trim().max(80),
    lastName: z.string().trim().max(80),
    dni: z.string().trim().max(30),
    dateOfBirth: z.string().trim().max(10),
    address: z.string().trim().max(250),
    floor: z.string().trim().max(40),
    apartment: z.string().trim().max(40),
    postalCode: z.string().trim().max(20),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]),
    phone: editablePhone,
  }).optional(),
});

const noteSchema = z.object({ text: z.string().trim().min(1).max(3000) });
const resendQuoteEmailSchema = z.object({
  subject: z.string().trim().min(1).max(180),
  headline: z.string().trim().min(1).max(300),
  intro: z.string().trim().min(1).max(1000),
});

type ContactGroupingLead = {
  _id: unknown;
  email?: string;
  phone?: string;
  personal?: { email?: string; phone?: string } | null;
};

function groupLeadsByContact<T extends ContactGroupingLead>(leads: T[]): T[][] {
  const parent = leads.map((_, index) => index);
  const find = (index: number): number => {
    const current = parent[index]!;
    if (current !== index) parent[index] = find(current);
    return parent[index]!;
  };
  const join = (left: number, right: number) => {
    const leftRoot = find(left); const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const byEmail = new Map<string, number>();
  const byPhone = new Map<string, number>();
  leads.forEach((lead, index) => {
    const email = (lead.personal?.email || lead.email || "").trim().toLowerCase();
    const phone = (lead.personal?.phone || lead.phone || "").replace(/\D/g, "");
    if (email) { const previous = byEmail.get(email); if (previous !== undefined) join(index, previous); else byEmail.set(email, index); }
    if (phone) { const previous = byPhone.get(phone); if (previous !== undefined) join(index, previous); else byPhone.set(phone, index); }
  });
  const groups = new Map<number, T[]>();
  leads.forEach((lead, index) => { const root = find(index); groups.set(root, [...(groups.get(root) || []), lead]); });
  return [...groups.values()];
}

type HomeQuoteLeadRecord = {
  product: string;
  fullName: string;
  email?: string;
  personal?: { email?: string } | null;
  quote?: {
    homeType?: string | null; requestedSquareMeters?: number | null; quotedSquareMeters?: number | null; areaLabel?: string | null;
    monthlyPrice?: number | null; structureCoverage?: number | null; contentsCoverage?: number | null; appliancesCoverage?: number | null;
    glassCoverage?: number | null; theftCoverage?: number | null; waterDamageCoverage?: number | null; assistanceIncluded?: boolean | null; currency?: string | null;
  } | null;
};

function homeQuoteEmailInput(lead: HomeQuoteLeadRecord | null): HomeQuoteEmailInput | null {
  if (!lead || lead.product !== "hogar") return null;
  const quote = lead.quote;
  const email = lead.personal?.email?.trim() || lead.email?.trim();
  if (!email || !quote?.homeType || !quote.quotedSquareMeters || !quote.currency) return null;
  return {
    name: lead.fullName,
    email,
    homeType: quote.homeType,
    quote: {
      requestedSquareMeters: quote.requestedSquareMeters || quote.quotedSquareMeters,
      quotedSquareMeters: quote.quotedSquareMeters,
      areaLabel: quote.areaLabel || `${quote.quotedSquareMeters} m²`,
      monthlyPrice: quote.monthlyPrice || 0,
      structureCoverage: quote.structureCoverage || 0,
      contentsCoverage: quote.contentsCoverage || 0,
      appliancesCoverage: quote.appliancesCoverage || 0,
      glassCoverage: quote.glassCoverage || 0,
      theftCoverage: quote.theftCoverage || 0,
      waterDamageCoverage: quote.waterDamageCoverage || 0,
      assistanceIncluded: quote.assistanceIncluded !== false,
      currency: "ARS",
    },
  };
}

export const adminLeadsRouter = Router();
adminLeadsRouter.use(requireAuthentication, requireActiveUser);
adminLeadsRouter.use(requirePermission("leads.view"));

const csvColumns: Array<{ header: string; path: string }> = [
  { header: "ID", path: "_id" }, { header: "ID de envío", path: "submissionId" },
  { header: "Producto", path: "product" }, { header: "Aseguradora", path: "insurer" },
  { header: "Origen", path: "source" }, { header: "Nombre completo", path: "fullName" },
  { header: "Email", path: "email" }, { header: "Teléfono", path: "phone" },
  { header: "Nombre", path: "personal.firstName" }, { header: "Apellido", path: "personal.lastName" },
  { header: "DNI", path: "personal.dni" }, { header: "Fecha de nacimiento", path: "personal.dateOfBirth" },
  { header: "Domicilio", path: "personal.address" }, { header: "Piso", path: "personal.floor" },
  { header: "Departamento", path: "personal.apartment" }, { header: "Código postal personal", path: "personal.postalCode" },
  { header: "Email personal", path: "personal.email" }, { header: "Teléfono personal", path: "personal.phone" },
  { header: "Código postal cotización", path: "quote.postalCode" }, { header: "Tipo de vivienda", path: "quote.homeType" },
  { header: "Piso cotización", path: "quote.floor" }, { header: "Código de área", path: "quote.areaCode" },
  { header: "Metros solicitados", path: "quote.requestedSquareMeters" }, { header: "Metros cotizados", path: "quote.quotedSquareMeters" },
  { header: "Descripción de superficie", path: "quote.areaLabel" }, { header: "Precio mensual", path: "quote.monthlyPrice" },
  { header: "Moneda", path: "quote.currency" }, { header: "Cobertura estructura", path: "quote.structureCoverage" },
  { header: "Cobertura contenido", path: "quote.contentsCoverage" }, { header: "Cobertura electrodomésticos", path: "quote.appliancesCoverage" },
  { header: "Cobertura cristales", path: "quote.glassCoverage" }, { header: "Cobertura robo", path: "quote.theftCoverage" },
  { header: "Cobertura daños por agua", path: "quote.waterDamageCoverage" }, { header: "Asistencia incluida", path: "quote.assistanceIncluded" },
  { header: "Vehículo", path: "quote.vehicle" }, { header: "Localidad", path: "quote.locality" },
  { header: "Valor asegurado", path: "quote.insuredAmount" }, { header: "ID de solicitud", path: "quote.requestId" },
  { header: "Código de sucursal", path: "quote.branchCode" }, { header: "ID de instalación", path: "quote.installationId" },
  { header: "Ambiente", path: "quote.environment" }, { header: "Opciones de cotización", path: "quote.options" },
  { header: "Cobertura seleccionada", path: "quote.selectedCoverage" }, { header: "Landing", path: "origin.landing" },
  { header: "Canal", path: "origin.channel" }, { header: "URL de origen", path: "origin.pageUrl" },
  { header: "Referente", path: "origin.referrer" }, { header: "UTM source", path: "origin.utmSource" },
  { header: "UTM medium", path: "origin.utmMedium" }, { header: "Campaña UTM", path: "origin.utmCampaign" },
  { header: "Pieza UTM", path: "origin.utmContent" }, { header: "Término UTM", path: "origin.utmTerm" },
  { header: "Estado", path: "status" }, { header: "Último reenvío de oferta", path: "quoteEmailResentAt" },
  { header: "Cantidad de reenvíos de oferta", path: "quoteEmailResendCount" }, { header: "Destacado", path: "pinned" },
  { header: "Prioridad", path: "priority" }, { header: "Próximo seguimiento", path: "nextFollowUpAt" },
  { header: "Motivo de pérdida", path: "lossReason" }, { header: "Notas", path: "notes" },
  { header: "ID contacto HighLevel", path: "highLevel.contactId" }, { header: "ID oportunidad HighLevel", path: "highLevel.opportunityId" },
  { header: "Estado HighLevel", path: "highLevel.syncStatus" }, { header: "Última sincronización HighLevel", path: "highLevel.lastSyncedAt" },
  { header: "Creado", path: "createdAt" }, { header: "Actualizado", path: "updatedAt" },
];

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

adminLeadsRouter.get("/export.csv", async (request, response) => {
  const product = z.enum(["hogar", "auto"]).parse(request.query.product);
  const leads = await Lead.find({ product }).sort({ createdAt: -1 }).lean();
  const rows = [
    csvColumns.map(({ header }) => csvValue(header)).join(","),
    ...leads.map((lead) => csvColumns.map(({ path }) => {
      const value = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, lead);
      return csvValue(value);
    }).join(",")),
  ];
  const date = new Date().toISOString().slice(0, 10);
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="leads-${product}-${date}.csv"`);
  response.send(`\uFEFF${rows.join("\r\n")}`);
});

adminLeadsRouter.get("/", async (request, response) => {
  const { page, limit, source, product, status, sortBy, sortOrder } = listSchema.parse(request.query);
  const filter = { ...(source ? { source } : {}), ...(product ? { product } : {}), ...(status ? { status } : {}) };
  const sortFields = { fullName: "fullName", monthlyPrice: "quote.monthlyPrice", utmCampaign: "origin.utmCampaign", status: "status", syncStatus: "highLevel.syncStatus", createdAt: "createdAt" } as const;
  const sort = { [sortFields[sortBy]]: sortOrder === "asc" ? 1 : -1 } as Record<string, 1 | -1>;
  const leads = await Lead.find(filter).sort(sort).lean();

  // Each person remains a separate quote, grouped by email/phone for display.
  const contacts = groupLeadsByContact(leads).map((group) => ({
    contactKey: String(group[0]!._id),
    latestLead: group[0]!,
    leads: group,
  }));
  const total = contacts.length;
  response.json({ contacts: contacts.slice((page - 1) * limit, page * limit), total, page, limit });
});

adminLeadsRouter.get("/:leadId/quote-email-preview", requirePermission("leads.manage"), async (request, response) => {
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "No encontramos esa cotización." }); return; }
  const input = homeQuoteEmailInput(lead);
  if (!input) { response.status(422).json({ error: "La cotización no tiene un email o los datos necesarios para mostrar la oferta." }); return; }
  response.json({ recipient: input.email, headline: `¡Listo, ${input.name.trim().split(/\s+/)[0] || ""}!`, intro: `Preparamos una cobertura para tu ${input.homeType.toLowerCase()} de ${input.quote.quotedSquareMeters} m².`, ...(await buildHomeQuoteEmail(input)) });
});

adminLeadsRouter.post("/:leadId/resend-quote-email", requirePermission("leads.manage"), async (request, response) => {
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "No encontramos esa cotización." }); return; }
  const input = homeQuoteEmailInput(lead);
  if (!input && lead.product !== "hogar") { response.status(400).json({ error: "El reenvío de oferta está disponible solo para cotizaciones de Hogar." }); return; }
  if (!input) {
    response.status(422).json({ error: "La cotización no tiene los datos necesarios para reconstruir la oferta." }); return;
  }
  const { subject, headline, intro } = resendQuoteEmailSchema.parse(request.body);

  try {
    const delivery = await sendHomeQuoteEmail(input, { subject, headline, intro });
    if (!delivery.sent) { response.status(503).json({ error: "No se pudo enviar el email. Revisá la configuración de Resend." }); return; }
    lead.quoteEmailResentAt = new Date();
    lead.quoteEmailResendCount = (lead.quoteEmailResendCount || 0) + 1;
    await lead.save();
    response.json({ lead, emailId: delivery.id });
  } catch (error) {
    console.error("Could not resend home quote email", { leadId: lead.id, error });
    response.status(502).json({ error: "No pudimos confirmar el resultado del reenvío. Revisá el email y Resend antes de volver a intentarlo para evitar duplicados." });
  }
});

adminLeadsRouter.patch("/:leadId", async (request, response) => {
  if (!request.user!.permissions.includes("*") && !request.user!.permissions.includes("leads.manage")) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = updateSchema.parse(request.body);
  const personal = input.personal;
  const fullName = personal ? [personal.firstName, personal.lastName].filter(Boolean).join(" ") : undefined;
  const update = {
    ...input,
    ...(personal ? { personal, fullName, email: personal.email, phone: personal.phone } : {}),
    ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null } : {}),
  };
  const lead = await Lead.findByIdAndUpdate(request.params.leadId, update, { new: true, runValidators: true });
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  if (personal) {
    try {
      await syncLeadToHighLevel(lead);
    } catch (error) {
      lead.highLevel!.syncStatus = "failed";
      lead.highLevel!.lastError = error instanceof Error ? error.message : "Unknown HighLevel error";
      await lead.save();
    }
  }
  response.json({ lead });
});

adminLeadsRouter.post("/:leadId/notes", async (request, response) => {
  if (!request.user!.permissions.includes("*") && !request.user!.permissions.includes("leads.manage")) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const { text } = noteSchema.parse(request.body);
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  lead.notes.push({ text, authorId: request.user!.id, authorName: request.user!.name, createdAt: new Date() });
  await lead.save();
  response.status(201).json({ lead });
});

adminLeadsRouter.delete("/:leadId/notes/:noteId", async (request, response) => {
  if (!request.user!.permissions.includes("*") && !request.user!.permissions.includes("leads.manage")) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  const note = lead.notes.id(request.params.noteId);
  if (!note) { response.status(404).json({ error: "Note not found" }); return; }
  note.deleteOne();
  await lead.save();
  response.json({ lead });
});

adminLeadsRouter.delete("/:leadId", requirePermission("leads.delete"), async (request, response) => {
  const lead = await Lead.findByIdAndDelete(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  response.status(204).end();
});

adminLeadsRouter.delete("/:leadId/group", requirePermission("leads.delete"), async (request, response) => {
  const leads = await Lead.find().lean();
  const group = groupLeadsByContact(leads).find((items) => items.some((lead) => String(lead._id) === request.params.leadId));
  if (!group) { response.status(404).json({ error: "Lead group not found" }); return; }
  const result = await Lead.deleteMany({ _id: { $in: group.map((lead) => lead._id) } });
  response.json({ deletedCount: result.deletedCount });
});

adminLeadsRouter.post("/:leadId/sync-highlevel", async (request, response) => {
  if (!request.user!.permissions.includes("*") && !request.user!.permissions.includes("leads.manage")) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  try {
    await syncLeadToHighLevel(lead);
  } catch (error) {
    lead.highLevel!.syncStatus = "failed";
    lead.highLevel!.lastError = error instanceof Error ? error.message : "Unknown HighLevel error";
    await lead.save();
  }
  response.json({ lead });
});
