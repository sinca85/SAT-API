import { Router } from "express";
import { z } from "zod";
import { requireActiveUser, requireAuthentication, requirePermission } from "../auth/middleware.js";
import { AutoSettings } from "../models/auto-settings.js";
import { SiteConfig } from "../models/site-config.js";
import { autoDefaults, GALENO_PRODUCTION_URL, GALENO_SANDBOX_URL, readAutoSettings } from "../services/auto-settings.js";
import { createGalenoClient, GalenoError } from "../services/galeno-client.js";
import { loadAdminCatalogs, options } from "../services/galeno-quotes.js";
import { canStoreAutoSecrets, encryptAutoSecret } from "../services/auto-secrets.js";
import { readGalenoRouteStatus } from "../services/galeno-route-status.js";

const code = z.string().trim().max(80).regex(/^[a-zA-Z0-9_-]*$/, "Usá el código informado por Galeno");
const settingsInput = z.object({
  sendQuoteEmail: z.boolean(), sendCommercialEmailOnContract: z.boolean(),
  contractRecipientEmail: z.string().trim().max(254).refine(value => !value || z.email().safeParse(value).success, "Ingresá un email válido"),
  environment: z.enum(["test", "production"]),
  connectionRoute: z.enum(["oracle", "fixie"]),
  sandboxUsername: z.string().trim().max(200), productionUsername: z.string().trim().max(200),
  sandboxPassword: z.string().max(1000).optional(), productionPassword: z.string().max(1000).optional(),
  sandboxBasicAuthorization: z.string().trim().max(2000).optional(), productionBasicAuthorization: z.string().trim().max(2000).optional(),
  producerCode: code, commercialPlanCode: code, billingModeCode: code, paymentConditionCode: code, paymentMethodCode: code,
  commercialDiscountEnabled: z.boolean(), commercialDiscountPercent: z.number().finite().min(0).max(100),
  personTypeCode: code.optional(), useTypeCode: code.optional(), ivaCode: code.optional(), iibbCode: code.optional(), analyticsEnabled: z.boolean().optional(),
}).strict().refine(value => !value.commercialDiscountEnabled || value.commercialDiscountPercent > 0, { path: ["commercialDiscountPercent"], message: "Ingresá un porcentaje mayor a 0" });

const defaults = autoDefaults;
function serialize(entry: Record<string, unknown>) {
  // Explicit allowlist: encrypted secrets are never returned to the browser.
  return { ...Object.fromEntries(Object.keys(defaults).map(key => [key, entry[key] ?? defaults[key as keyof typeof defaults]])),
    sandboxUsername: entry.sandboxUsername || entry.username || "", productionUsername: entry.productionUsername || "",
    baseUrl: entry.environment === "production" ? GALENO_PRODUCTION_URL : GALENO_SANDBOX_URL,
    hasSandboxPassword: Boolean(entry.passwordEncrypted), hasSandboxBasicAuthorization: Boolean(entry.authorizationEncrypted),
    hasProductionPassword: Boolean(entry.productionPasswordEncrypted), hasProductionBasicAuthorization: Boolean(entry.productionAuthorizationEncrypted),
    mode: entry.environment === "production" ? "production" : "sandbox", secretsStorageAvailable: canStoreAutoSecrets() };
}
export const adminAutoRouter = Router();

async function runConnectionTest() {
  const settings = await readAutoSettings();
  const client = createGalenoClient(settings);
  const brands = options(await client("/api/cotizadores/auto/marcas?rama=4"));
  return { ok: true, route: settings.connectionRoute, environment: settings.environment, brands };
}

adminAutoRouter.use(requireAuthentication, requireActiveUser, requirePermission("landings.view"));
adminAutoRouter.get("/", async (_request, response) => {
  const [entry, commercial, connectionStatus] = await Promise.all([
    AutoSettings.findOne({ slug: "auto" }).select("+passwordEncrypted +authorizationEncrypted +productionPasswordEncrypted +productionAuthorizationEncrypted").lean(),
    SiteConfig.findOne({ slug: "email-comercial", type: "email", active: true }).select("value").lean(),
    readGalenoRouteStatus(),
  ]);
  response.json({ settings: serialize(entry ?? defaults), commercialEmail: commercial?.value ?? "", connectionStatus });
});
adminAutoRouter.patch("/", requirePermission("landings.manage"), async (request, response) => {
  const { sandboxPassword, productionPassword, sandboxBasicAuthorization, productionBasicAuthorization, ...input } = settingsInput.parse(request.body);
  if ((sandboxPassword || productionPassword || sandboxBasicAuthorization || productionBasicAuthorization) && !canStoreAutoSecrets()) {
    response.status(503).json({ error: "Configurá GALENO_SETTINGS_ENCRYPTION_KEY en el servidor para guardar credenciales cifradas." }); return;
  }
  const entry = await AutoSettings.findOneAndUpdate({ slug: "auto" }, { $set: {
    ...input, baseUrl: input.environment === "production" ? GALENO_PRODUCTION_URL : GALENO_SANDBOX_URL, username: input.sandboxUsername, updatedBy: request.user!.id,
    ...(sandboxPassword ? { passwordEncrypted: encryptAutoSecret(sandboxPassword) } : {}),
    ...(sandboxBasicAuthorization ? { authorizationEncrypted: encryptAutoSecret(sandboxBasicAuthorization) } : {}),
    ...(productionPassword ? { productionPasswordEncrypted: encryptAutoSecret(productionPassword) } : {}),
    ...(productionBasicAuthorization ? { productionAuthorizationEncrypted: encryptAutoSecret(productionBasicAuthorization) } : {}),
  } }, { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }).select("+passwordEncrypted +authorizationEncrypted +productionPasswordEncrypted +productionAuthorizationEncrypted").lean();
  response.json({ settings: serialize(entry!) });
});

adminAutoRouter.post("/catalogs", requirePermission("landings.manage"), async (request, response) => {
  const selection = z.object({ commercialPlanCode: code.optional(), billingModeCode: code.optional() }).strict().parse(request.body);
  const settings = await readAutoSettings();
  response.json({ catalogs: await loadAdminCatalogs(createGalenoClient(settings), selection) });
});

adminAutoRouter.post("/oracle-test", requirePermission("landings.manage"), async (_request, response) => {
  response.json(await runConnectionTest());
});
adminAutoRouter.use((error: unknown, _request: import("express").Request, response: import("express").Response, next: import("express").NextFunction) => {
  if (error instanceof GalenoError) { response.status(error.status).json({ error: error.message, code: error.code, ...(error.galeno !== undefined ? { galeno: error.galeno } : {}) }); return; }
  next(error);
});
