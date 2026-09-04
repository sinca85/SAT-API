import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { accessPermissions, Role } from "../models/role.js";
import { User } from "../models/user.js";
import { ensureDefaultRoles } from "../auth/access.js";

const roleInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).default(""),
  permissions: z.array(z.enum(accessPermissions)).max(accessPermissions.length).default([]),
});

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const adminRolesRouter = Router();
adminRolesRouter.use(requireAuthentication, requireActiveUser, requirePermission("roles.manage"));

adminRolesRouter.get("/", async (_request, response) => {
  await ensureDefaultRoles();
  response.json({ roles: await Role.find().sort({ system: -1, name: 1 }).lean(), permissions: accessPermissions });
});

adminRolesRouter.post("/", async (request, response) => {
  const input = roleInput.parse(request.body);
  const slug = slugify(input.name);
  if (!slug) { response.status(400).json({ error: "Invalid role name" }); return; }
  const role = await Role.create({ ...input, slug, system: false });
  response.status(201).json({ role });
});

adminRolesRouter.patch("/:roleId", async (request, response) => {
  const input = roleInput.partial().parse(request.body);
  const existing = await Role.findById(request.params.roleId);
  if (!existing) { response.status(404).json({ error: "Role not found" }); return; }
  if (existing.system) { response.status(400).json({ error: "The administrator role is protected" }); return; }
  if (input.name) existing.slug = slugify(input.name);
  Object.assign(existing, input);
  await existing.save();
  response.json({ role: existing });
});

adminRolesRouter.delete("/:roleId", async (request, response) => {
  const role = await Role.findById(request.params.roleId);
  if (!role) { response.status(404).json({ error: "Role not found" }); return; }
  if (role.system) { response.status(400).json({ error: "The administrator role is protected" }); return; }
  await Promise.all([role.deleteOne(), User.updateMany({ roleIds: role._id }, { $pull: { roleIds: role._id } })]);
  response.status(204).end();
});
