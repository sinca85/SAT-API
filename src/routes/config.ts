import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { SiteConfig, siteConfigCategories, siteConfigTypes, type SiteConfigType } from "../models/site-config.js";

const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);
const configInput = z.object({
  slug: slugSchema,
  label: z.string().trim().min(2).max(120),
  value: z.string().trim().min(1).max(1000),
  type: z.enum(siteConfigTypes),
  active: z.boolean().default(true),
});
const querySchema = z.object({ category: z.enum(siteConfigCategories).optional() });

function categoryForType(type: SiteConfigType) {
  if (type === "direccion") return "ubicacion";
  if (type === "red_social") return "redes_sociales";
  return "contactos";
}

export const publicConfigRouter = Router();

publicConfigRouter.get("/", async (request, response) => {
  const { category } = querySchema.parse(request.query);
  const entries = await SiteConfig.find({ active: true, ...(category ? { category } : {}) }).select("slug label value type category").sort({ category: 1, label: 1 }).lean();
  response.json({ entries });
});

publicConfigRouter.get("/:slug", async (request, response) => {
  const slug = slugSchema.parse(request.params.slug);
  const entry = await SiteConfig.findOne({ slug, active: true }).select("slug label value type category").lean();
  if (!entry) { response.status(404).json({ error: "Configuration entry not found" }); return; }
  response.json({ entry });
});

export const adminConfigRouter = Router();
adminConfigRouter.use(requireAuthentication, requireActiveUser, requirePermission("config.view"));

function canManage(request: Express.Request) {
  return request.user!.permissions.includes("*") || request.user!.permissions.includes("config.manage");
}

adminConfigRouter.get("/", async (_request, response) => {
  response.json({ entries: await SiteConfig.find().sort({ category: 1, label: 1 }).lean() });
});

adminConfigRouter.post("/", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = configInput.parse(request.body);
  const exists = await SiteConfig.exists({ slug: input.slug });
  if (exists) { response.status(409).json({ error: "Ya existe una configuración con ese slug" }); return; }
  const entry = await SiteConfig.create({ ...input, category: categoryForType(input.type), createdBy: request.user!.id, updatedBy: request.user!.id });
  response.status(201).json({ entry });
});

adminConfigRouter.patch("/:entryId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const input = configInput.partial().parse(request.body);
  if (input.slug) {
    const exists = await SiteConfig.exists({ slug: input.slug, _id: { $ne: request.params.entryId } });
    if (exists) { response.status(409).json({ error: "Ya existe una configuración con ese slug" }); return; }
  }
  const entry = await SiteConfig.findByIdAndUpdate(request.params.entryId, { ...input, ...(input.type ? { category: categoryForType(input.type) } : {}), updatedBy: request.user!.id }, { new: true, runValidators: true });
  if (!entry) { response.status(404).json({ error: "Configuration entry not found" }); return; }
  response.json({ entry });
});

adminConfigRouter.delete("/:entryId", async (request, response) => {
  if (!canManage(request)) { response.status(403).json({ error: "Insufficient permissions" }); return; }
  const entry = await SiteConfig.findByIdAndDelete(request.params.entryId);
  if (!entry) { response.status(404).json({ error: "Configuration entry not found" }); return; }
  response.status(204).end();
});
