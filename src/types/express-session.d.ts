import type { UserRole, UserStatus } from "../models/user.js";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatarUrl?: string;
      role: UserRole;
      status: UserStatus;
      permissions: string[];
    }
  }
}

export {};
