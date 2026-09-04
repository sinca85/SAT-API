import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { env } from "../config/env.js";
import { highLevelClient } from "../integrations/highlevel/client.js";

const contactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

interface HighLevelContact {
  id: string;
  contactName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateAdded?: string;
  tags?: string[];
}

interface HighLevelContactsResponse {
  contacts?: HighLevelContact[];
  total?: number;
  count?: number;
}

export const adminHighLevelRouter = Router();

adminHighLevelRouter.use(requireAuthentication, requireActiveUser, requirePermission("highlevel.contacts.view"));

adminHighLevelRouter.get("/contacts", async (request, response) => {
  if (!env.HIGHLEVEL_LOCATION_ID) {
    response.status(503).json({ error: "HighLevel Location ID is not configured" });
    return;
  }

  const { page, limit } = contactsQuerySchema.parse(request.query);
  const data = await highLevelClient.request<HighLevelContactsResponse>("/contacts/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locationId: env.HIGHLEVEL_LOCATION_ID,
      page,
      pageLimit: limit,
    }),
  });

  response.json({
    contacts: data.contacts ?? [],
    total: data.total ?? data.count ?? data.contacts?.length ?? 0,
    page,
    limit,
  });
});
