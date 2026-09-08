import { LandingSettings } from "../models/landing-settings.js";

export const HOME_LANDING_SLUG = "hogar";

const homeDefaults = {
  slug: HOME_LANDING_SLUG,
  name: "Seguro Hogar Allianz",
  publicUrl: "https://cotizar.seguroatiempo.com/hogar",
  sendQuoteEmail: true,
  sendCommercialEmailOnContract: true,
  contractRecipientEmail: "",
};

export async function ensureHomeLandingSettings() {
  return LandingSettings.findOneAndUpdate(
    { slug: HOME_LANDING_SLUG },
    { $setOnInsert: homeDefaults },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function getHomeLandingSettings() {
  return ensureHomeLandingSettings();
}
