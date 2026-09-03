import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../models/user.js";

export function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!request.isAuthenticated() || !request.user) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
}

export function requireActiveUser(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (!request.user || request.user.status !== "active") {
    response.status(403).json({ error: "User is pending approval or disabled" });
    return;
  }

  next();
}

export function requireRole(...roles: UserRole[]) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}
