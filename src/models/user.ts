import { Schema, model } from "mongoose";

export const userRoles = ["admin", "user"] as const;
export const userStatuses = ["pending", "active", "disabled"] as const;

export type UserRole = (typeof userRoles)[number];
export type UserStatus = (typeof userStatuses)[number];

const userSchema = new Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String },
    role: { type: String, enum: userRoles, default: "user", required: true },
    status: { type: String, enum: userStatuses, default: "pending", required: true },
    permissions: { type: [String], default: [] },
    roleIds: [{ type: Schema.Types.ObjectId, ref: "Role" }],
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const User = model("User", userSchema);
