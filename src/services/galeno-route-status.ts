import { AutoSettings } from "../models/auto-settings.js";
import { GalenoRouteStatus } from "../models/galeno-route-status.js";
import { SiteConfig } from "../models/site-config.js";
import { sendGalenoRouteNotification } from "./email.js";

export type GalenoRoute = "oracle" | "fixie";

async function notificationRecipient() {
  const [auto, commercial] = await Promise.all([
    AutoSettings.findOne({ slug: "auto" }).select("contractRecipientEmail").lean(),
    SiteConfig.findOne({ slug: "email-comercial", type: "email", active: true }).select("value").lean(),
  ]);
  return auto?.contractRecipientEmail?.trim() || commercial?.value?.trim() || "";
}

export async function recordGalenoRoute(route: GalenoRoute, detail = "") {
  const now = new Date();
  const previous = await GalenoRouteStatus.findOneAndUpdate(
    { key: "galeno" },
    { $set: {
      activeRoute: route,
      lastError: route === "fixie" ? detail.slice(0, 300) : "",
      ...(route === "oracle" ? { lastOracleSuccessAt: now } : { lastFixieUseAt: now }),
    }, $setOnInsert: { key: "galeno", switchedAt: now } },
    { new: false, upsert: true },
  ).lean().catch(async error => {
    if ((error as { code?: number }).code !== 11000) throw error;
    return await GalenoRouteStatus.findOne({ key: "galeno" }).lean();
  });
  const changed = previous?.activeRoute !== route;
  if (changed) {
    await GalenoRouteStatus.updateOne({ key: "galeno" }, { $set: { switchedAt: now } });
    const shouldNotify = route === "fixie" || previous?.activeRoute === "fixie";
    const to = shouldNotify ? await notificationRecipient() : "";
    if (to) await sendGalenoRouteNotification({ to, route, detail }).catch(error => console.error("Could not send Galeno route notification", { name: error instanceof Error ? error.name : "UnknownError" }));
  }
}

export async function readGalenoRouteStatus() {
  return await GalenoRouteStatus.findOne({ key: "galeno" }).select("activeRoute switchedAt lastOracleSuccessAt lastFixieUseAt lastError updatedAt").lean();
}
