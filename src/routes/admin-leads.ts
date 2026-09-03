import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requireRole } from "../auth/middleware.js";
import { Lead, leadStatuses } from "../models/lead.js";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  source: z.string().trim().optional(),
  status: z.enum(leadStatuses).optional(),
});

const updateSchema = z.object({
  status: z.enum(leadStatuses).optional(),
  pinned: z.boolean().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  lossReason: z.string().trim().max(500).nullable().optional(),
});

const noteSchema = z.object({ text: z.string().trim().min(1).max(3000) });

export const adminLeadsRouter = Router();
adminLeadsRouter.use(requireAuthentication, requireActiveUser, requireRole("admin"));

adminLeadsRouter.get("/", async (request, response) => {
  const { page, limit, source, status } = listSchema.parse(request.query);
  const filter = { ...(source ? { source } : {}), ...(status ? { status } : {}) };
  const [leads, total] = await Promise.all([
    Lead.find(filter).sort({ pinned: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);
  response.json({ leads, total, page, limit });
});

adminLeadsRouter.patch("/:leadId", async (request, response) => {
  const input = updateSchema.parse(request.body);
  const update = { ...input, ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null } : {}) };
  const lead = await Lead.findByIdAndUpdate(request.params.leadId, update, { new: true, runValidators: true });
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  response.json({ lead });
});

adminLeadsRouter.post("/:leadId/notes", async (request, response) => {
  const { text } = noteSchema.parse(request.body);
  const lead = await Lead.findById(request.params.leadId);
  if (!lead) { response.status(404).json({ error: "Lead not found" }); return; }
  lead.notes.push({ text, authorId: request.user!.id, authorName: request.user!.name, createdAt: new Date() });
  await lead.save();
  response.status(201).json({ lead });
});
