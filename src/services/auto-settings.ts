import { AutoSettings } from "../models/auto-settings.js";
export const GALENO_SANDBOX_URL = "https://www.gsbeneficios.com.ar/WS-Seguros-desa";
export const autoDefaults = {
  slug: "auto", sendQuoteEmail: true, sendCommercialEmailOnContract: true, contractRecipientEmail: "",
  environment: "test", baseUrl: GALENO_SANDBOX_URL, username: "", producerCode: "", commercialPlanCode: "",
  billingModeCode: "", paymentConditionCode: "", paymentMethodCode: "", personTypeCode: "1", useTypeCode: "1",
  ivaCode: "5", iibbCode: "CF", analyticsEnabled: false,
};
export type AutoConfiguration = typeof autoDefaults & { passwordEncrypted?: string | null; authorizationEncrypted?: string | null };
export async function readAutoSettings(): Promise<AutoConfiguration> {
  const entry = await AutoSettings.findOne({ slug: "auto" }).select("+passwordEncrypted +authorizationEncrypted").lean();
  return { ...autoDefaults, ...entry };
}
export function quoteConfigured(settings: AutoConfiguration) {
  return Boolean(settings.username && settings.passwordEncrypted && settings.producerCode && settings.commercialPlanCode && settings.billingModeCode && settings.paymentConditionCode && settings.paymentMethodCode && settings.personTypeCode && settings.useTypeCode && settings.ivaCode && settings.iibbCode && settings.environment === "test" && settings.baseUrl === GALENO_SANDBOX_URL);
}
