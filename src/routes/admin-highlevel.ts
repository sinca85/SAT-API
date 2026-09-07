import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { env } from "../config/env.js";
import { highLevelClient } from "../integrations/highlevel/client.js";
import { HighLevelContact } from "../models/highlevel-contact.js";
import { HighLevelSyncState } from "../models/highlevel-sync-state.js";
import { upsertHighLevelContact, type HighLevelContactInput } from "../services/highlevel-contacts.js";

const contactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).optional(),
  tag: z.string().trim().max(160).optional(),
});

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface HighLevelContactsResponse {
  contacts?: HighLevelContactInput[];
  total?: number;
  count?: number;
}

export const adminHighLevelRouter = Router();

adminHighLevelRouter.use(requireAuthentication, requireActiveUser, requirePermission("highlevel.view"), requirePermission("highlevel.contacts.view"));

adminHighLevelRouter.get("/contacts", async (request, response) => {
  const { page, limit, search, tag } = contactsQuerySchema.parse(request.query);
  const filter = {
    ...(search ? { $or: ["fullName", "firstName", "lastName", "email", "phone", "tags"].map((field) => ({ [field]: { $regex: escapeRegex(search), $options: "i" } })) } : {}),
    ...(tag ? { tags: tag } : {}),
  };
  const [contacts, total, tags, syncState] = await Promise.all([
    HighLevelContact.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    HighLevelContact.countDocuments(filter),
    HighLevelContact.distinct("tags"),
    HighLevelSyncState.findOne({ key: "contacts" }).lean(),
  ]);
  response.json({
    contacts: contacts.map((contact) => ({ ...contact, id: contact.highLevelId || String(contact._id) })),
    total,
    page,
    limit,
    tags: tags.filter((value): value is string => typeof value === "string").sort((a, b) => a.localeCompare(b, "es")),
    lastSync: syncState,
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
  const lastSyncedAt = new Date();
  await HighLevelSyncState.findOneAndUpdate(
    { key: "contacts" },
    { $set: { lastSyncedAt, processed, created, updated } },
    { upsert: true, new: true },
  );
  response.json({ processed, created, updated, total: await HighLevelContact.countDocuments(), lastSyncedAt });
});
