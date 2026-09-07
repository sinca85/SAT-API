import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { env } from "../config/env.js";
import { highLevelClient } from "../integrations/highlevel/client.js";
import { HighLevelContact } from "../models/highlevel-contact.js";
import { upsertHighLevelContact, type HighLevelContactInput } from "../services/highlevel-contacts.js";

const contactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

interface HighLevelContactsResponse {
  contacts?: HighLevelContactInput[];
  total?: number;
  count?: number;
}

export const adminHighLevelRouter = Router();

adminHighLevelRouter.use(requireAuthentication, requireActiveUser, requirePermission("highlevel.view"), requirePermission("highlevel.contacts.view"));

adminHighLevelRouter.get("/contacts", async (request, response) => {
  const { page, limit } = contactsQuerySchema.parse(request.query);
  const [contacts, total] = await Promise.all([
    HighLevelContact.find().sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    HighLevelContact.countDocuments(),
  ]);
  response.json({
    contacts: contacts.map((contact) => ({ ...contact, id: contact.highLevelId || String(contact._id) })),
    total,
    page,
    limit,
  });
});

adminHighLevelRouter.post("/contacts/sync", async (_request, response) => {
  if (!env.HIGHLEVEL_LOCATION_ID) {
    response.status(503).json({ error: "HighLevel Location ID is not configured" });
    return;
  }
  const pageLimit = 100;
  let page = 1;
  let remoteTotal: number | undefined;
  let processed = 0;
  let created = 0;
  let updated = 0;
  while (true) {
    const data = await highLevelClient.request<HighLevelContactsResponse>("/contacts/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId: env.HIGHLEVEL_LOCATION_ID, page, pageLimit }),
    });
    const batch = data.contacts ?? [];
    remoteTotal ??= data.total ?? data.count;
    const results = await Promise.all(batch.map((contact) => upsertHighLevelContact(contact)));
    created += results.filter((result) => result.created).length;
    updated += results.filter((result) => !result.created).length;
    processed += batch.length;
    if (!batch.length || batch.length < pageLimit || (remoteTotal !== undefined && processed >= remoteTotal)) break;
    page += 1;
  }
  response.json({ processed, created, updated, total: await HighLevelContact.countDocuments() });
});
