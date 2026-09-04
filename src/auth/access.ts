import type { Types } from "mongoose";
import { Role } from "../models/role.js";
import type { User } from "../models/user.js";

type UserDocument = InstanceType<typeof User>;

export async function ensureDefaultRoles() {
  const [admin, seller] = await Promise.all([
    Role.findOneAndUpdate(
      { slug: "admin" },
      { $set: { name: "Administrador", description: "Acceso total al sistema", permissions: ["*"], system: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    Role.findOneAndUpdate(
      { slug: "vendedor" },
      { $setOnInsert: { name: "Vendedor", description: "Gestión comercial de leads", permissions: ["leads.view", "leads.manage"], system: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  ]);
  return { admin, seller };
}

export async function resolveUserAccess(user: UserDocument) {
  const defaults = await ensureDefaultRoles();
  if (user.role === "admin" && !user.roleIds.some((id) => String(id) === defaults.admin.id)) {
    user.roleIds.push(defaults.admin._id as Types.ObjectId);
    await user.save();
  }
  const roles = await Role.find({ _id: { $in: user.roleIds } }).select("name slug permissions").lean();
  const permissions = user.role === "admin" || roles.some((role) => role.slug === "admin")
    ? ["*"]
    : [...new Set(roles.flatMap((role) => role.permissions))];
  return {
    roles: roles.map((role) => ({ id: String(role._id), name: role.name, slug: role.slug })),
    permissions,
  };
}
