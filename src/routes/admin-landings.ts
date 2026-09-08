import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { LandingSettings } from "../models/landing-settings.js";
import { SiteConfig } from "../models/site-config.js";
import { ensureHomeLandingSettings } from "../services/landing-settings.js";

const settingsInput = z.object({
  sendQuoteEmail: z.boolean(),
  sendCommercialEmailOnContract: z.boolean(),
});

export const adminLandingsRouter = Router();
adminLandingsRouter.use(requireAuthentication, requireActiveUser, requirePermission("landings.view"));

adminLandingsRouter.get("/", async (_request, response) => {
  const [home, commercial] = await Promise.all([
    ensureHomeLandingSettings(),
    SiteConfig.findOne({ slug: "email-comercial", type: "email", active: true }).select("value").lean(),
  ]);
  response.json({ landings: [home], commercialEmail: commercial?.value ?? "" });
});

adminLandingsRouter.patch("/:slug", requirePermission("landings.manage"), async (request, response) => {
  const input = settingsInput.parse(request.body);
  if (request.params.slug === "hogar") await ensureHomeLandingSettings();
  const entry = await LandingSettings.findOneAndUpdate(
    { slug: request.params.slug },
    { $set: { ...input, updatedBy: request.user!.id } },
    { new: true, runValidators: true },
  ).lean();
  if (!entry) { response.status(404).json({ error: "Landing not found" }); return; }
  response.json({ landing: entry });
});
