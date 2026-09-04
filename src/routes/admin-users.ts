import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { User, userStatuses } from "../models/user.js";
import { Role } from "../models/role.js";
import { ensureDefaultRoles } from "../auth/access.js";

const updateUserSchema = z.object({
  status: z.enum(userStatuses).optional(),
  roleIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).max(20).optional(),
});

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuthentication, requireActiveUser, requirePermission("users.view"));

adminUsersRouter.get("/", async (_request, response) => {
  await ensureDefaultRoles();
  const [users, roles] = await Promise.all([
    User.find().select("email name avatarUrl role roleIds status lastLoginAt createdAt updatedAt").sort({ createdAt: -1 }).lean(),
    Role.find().sort({ system: -1, name: 1 }).lean(),
  ]);

  response.json({ users, roles });
});

adminUsersRouter.patch("/:userId", async (request, response) => {
  if (!request.user!.permissions.includes("*") && !request.user!.permissions.includes("users.manage")) {
    response.status(403).json({ error: "Insufficient permissions" }); return;
  }
  const input = updateUserSchema.parse(request.body);
  if (input.roleIds) {
    const roles = await Role.find({ _id: { $in: input.roleIds } }).select("slug").lean();
    if (roles.length !== new Set(input.roleIds).size) { response.status(400).json({ error: "One or more roles do not exist" }); return; }
    if (roles.some((role) => role.slug === "admin") && !request.user!.permissions.includes("*")) {
      response.status(403).json({ error: "Only an administrator can assign the administrator role" }); return;
    }
  }
  const user = await User.findByIdAndUpdate(request.params.userId, input, {
    new: true,
    runValidators: true,
  }).select("email name avatarUrl role roleIds status lastLoginAt createdAt updatedAt");

  if (!user) {
    response.status(404).json({ error: "User not found" });
    return;
  }

  response.json({ user });
});
