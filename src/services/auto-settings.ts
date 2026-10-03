import { AutoSettings } from "../models/auto-settings.js";
export const GALENO_SANDBOX_URL = "https://www.gsbeneficios.com.ar/WS-Seguros-desa";
export const GALENO_PRODUCTION_URL = "https://www.gsbeneficios.com.ar/WS-Seguros";
export const autoDefaults = {
  slug: "auto", sendQuoteEmail: true, sendCommercialEmailOnContract: true, contractRecipientEmail: "",
  environment: "test" as "test" | "production", baseUrl: GALENO_SANDBOX_URL, connectionRoute: "oracle" as "oracle" | "fixie", username: "",
  sandboxUsername: "", productionUsername: "", producerCode: "", commercialPlanCode: "",
  commercialDiscountEnabled: false, commercialDiscountPercent: 0,
  billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "", personTypeCode: "1", useTypeCode: "1",
  ivaCode: "5", iibbCode: "CF", analyticsEnabled: false,
};
export type AutoConfiguration = typeof autoDefaults & { passwordEncrypted?: string | null; authorizationEncrypted?: string | null; productionPasswordEncrypted?: string | null; productionAuthorizationEncrypted?: string | null };
export async function readAutoSettings(): Promise<AutoConfiguration> {
  const entry = await AutoSettings.findOne({ slug: "auto" }).select("+passwordEncrypted +authorizationEncrypted +productionPasswordEncrypted +productionAuthorizationEncrypted").lean();
  const stored = { ...autoDefaults, ...entry } as AutoConfiguration;
  const sandboxUsername = stored.sandboxUsername || stored.username;
  if (stored.environment === "production") return { ...stored, sandboxUsername, baseUrl: GALENO_PRODUCTION_URL, username: stored.productionUsername, passwordEncrypted: stored.productionPasswordEncrypted, authorizationEncrypted: stored.productionAuthorizationEncrypted };
  return { ...stored, sandboxUsername, baseUrl: GALENO_SANDBOX_URL, username: sandboxUsername };
}
export function quoteConfigured(settings: AutoConfiguration) {
  const expectedUrl = settings.environment === "production" ? GALENO_PRODUCTION_URL : GALENO_SANDBOX_URL;
  return Boolean(settings.username && settings.passwordEncrypted && settings.producerCode && settings.commercialPlanCode && settings.billingModeCode && settings.paymentConditionCode && settings.paymentMethodCode && settings.personTypeCode && settings.useTypeCode && settings.ivaCode && settings.iibbCode && settings.baseUrl === expectedUrl);
}
