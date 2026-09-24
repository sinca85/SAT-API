import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { Lead, leadStatuses } from "../models/lead.js";
import { syncLeadToHighLevel } from "../integrations/highlevel/leads.js";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  source: z.string().trim().optional(),
  status: z.enum(leadStatuses).optional(),
  sortBy: z.enum(["fullName", "monthlyPrice", "source", "status", "syncStatus", "createdAt"]).default("createdAt"),
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

export const adminLeadsRouter = Router();
adminLeadsRouter.use(requireAuthentication, requireActiveUser);
adminLeadsRouter.use(requirePermission("leads.view"));

adminLeadsRouter.get("/", async (request, response) => {
  const { page, limit, source, status, sortBy, sortOrder } = listSchema.parse(request.query);
  const filter = { ...(source ? { source } : {}), ...(status ? { status } : {}) };
  const sortFields = { fullName: "fullName", monthlyPrice: "quote.monthlyPrice", source: "source", status: "status", syncStatus: "highLevel.syncStatus", createdAt: "createdAt" } as const;
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
