import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requireRole } from "../auth/middleware.js";
import { User, userRoles, userStatuses } from "../models/user.js";

const updateUserSchema = z.object({
  role: z.enum(userRoles).optional(),
  status: z.enum(userStatuses).optional(),
});

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuthentication, requireActiveUser, requireRole("admin"));

adminUsersRouter.get("/", async (_request, response) => {
  const users = await User.find()
    .select("email name avatarUrl role status lastLoginAt createdAt updatedAt")
    .sort({ createdAt: -1 })
    .lean();

  response.json({ users });
});

adminUsersRouter.patch("/:userId", async (request, response) => {
  const input = updateUserSchema.parse(request.body);
  const user = await User.findByIdAndUpdate(request.params.userId, input, {
    new: true,
    runValidators: true,
  }).select("email name avatarUrl role status lastLoginAt createdAt updatedAt");

  if (!user) {
    response.status(404).json({ error: "User not found" });
    return;
  }

  response.json({ user });
});
