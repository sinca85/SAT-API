import { z } from "zod";
import { GalenoError, type GalenoClient } from "./galeno-client.js";
import { type AutoConfiguration, quoteConfigured } from "./auto-settings.js";

export type Option = { value: string; label: string };
const scalar = z.union([z.string(), z.number()]).transform(String);
const rows = (value: unknown): unknown[] => {
  const list = Array.isArray(value) ? value : (value as { lista?: unknown } | null)?.lista;
  if (!Array.isArray(list)) throw new GalenoError("invalid_response", "Galeno devolvió un catálogo no válido.");
  return list;
};
const optionSchema = z.object({ codigo: scalar, descripcion: z.string() });
export function options(value: unknown): Option[] {
  const parsed = z.array(optionSchema).safeParse(rows(value));
  if (!parsed.success) throw new GalenoError("invalid_response", "No pudimos interpretar las opciones de Galeno.");
  return parsed.data.map(row => ({ value: row.codigo, label: row.descripcion }));
}
export const part = (value: string) => encodeURIComponent(value);
export async function loadAdminCatalogs(client: GalenoClient, selection: { commercialPlanCode?: string; billingModeCode?: string }) {
  const [plansRaw, people, usesRaw, iva, iibb] = await Promise.all([
    client("/api/administracion/usuario/planes/comerciales?rama=4"),
    client("/api/cotizadores/comun/tiposPersona"), client("/api/cotizadores/comun/tiposDeUso"),
    client("/api/cotizadores/comun/categoriasIva"), client("/api/cotizadores/comun/codigosIIBB"),
  ]);
  const plansParsed = z.array(z.object({ codPlanComercial: scalar, productorCodigo: scalar, descripcionPlanComercial: z.string().nullable().optional() })).safeParse(rows(plansRaw));
  const usesParsed = z.array(z.object({ codigoUsoVehiculo: scalar, descripcionUsoVehiculo: z.string() })).safeParse(rows(usesRaw));
  if (!plansParsed.success || !usesParsed.success) throw new GalenoError("invalid_response", "No pudimos interpretar los planes de Galeno.");
  const plans = plansParsed.data.map(plan => ({ value: plan.codPlanComercial, label: plan.descripcionPlanComercial || plan.codPlanComercial, producerCode: plan.productorCodigo }));
  const plan = selection.commercialPlanCode;
  if (plan && !plans.some(item => item.value === plan)) throw new GalenoError("invalid_plan", "El plan seleccionado no está habilitado para este usuario.", 422);
  const billingModes = plan ? options(await client("/api/cotizadores/comun/modosDeFacturacion", { codigoRama: 4, planComercial: plan })) : [];
  const billing = selection.billingModeCode;
  if (billing && !billingModes.some(item => item.value === billing)) throw new GalenoError("invalid_billing", "La facturación seleccionada no pertenece al plan.", 422);
  const [conditions, methods] = plan && billing ? await Promise.all([
    client("/api/cotizadores/comun/condicionesDePago", { codigoRama: "4", modoFacturacion: billing }),
    client("/api/cotizadores/comun/formasDePago", { codigoRama: 4, modoFacturacion: billing, planComercial: plan }),
  ]) : [[], []];
  return { plans, people: options(people), uses: usesParsed.data.map(use => ({ value: use.codigoUsoVehiculo, label: use.descripcionUsoVehiculo })), iva: options(iva), iibb: options(iibb), billingModes, paymentConditions: options(conditions), paymentMethods: options(methods) };
}
export async function versions(client: GalenoClient, brand: string, model: string, year: string) {
  const data = await client(`/api/cotizadores/auto/submodelos/${part(brand)}/${part(model)}/${part(year)}`);
  const parsed = z.array(z.object({ version: z.string(), codigoMarca: scalar, codigoModelo: scalar, codigoSubModelo: scalar })).safeParse(rows(data));
  if (!parsed.success) throw new GalenoError("invalid_response", "No pudimos interpretar las versiones del vehículo.");
  return parsed.data.map(row => ({ value: `${row.codigoMarca}:${row.codigoModelo}:${row.codigoSubModelo}`, label: row.version.trim(), brandCode: row.codigoMarca, modelCode: row.codigoModelo, subModelCode: row.codigoSubModelo }));
}
export async function locations(client: GalenoClient, postalCode: string) {
  const data = await client(`/api/cotizadores/comun/codigoPostal/4/${part(postalCode)}`);
  const parsed = z.array(z.object({ subCodigoPostal: scalar, localidad: z.string() })).safeParse(rows(data));
  if (!parsed.success) throw new GalenoError("invalid_response", "No pudimos validar la localidad.");
  return parsed.data.map(row => ({ value: row.subCodigoPostal, label: row.localidad }));
}
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T12:00:00Z`);
  const now = new Date();
  const argentinaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= argentinaToday;
}, "Ingresá una fecha de vigencia válida, desde hoy.");
export const quoteInput = z.object({
  brand: z.string().min(1).max(40), model: z.string().min(1).max(120), year: z.string().regex(/^\d{4}$/), version: z.string().min(1).max(120),
  zeroKm: z.boolean(), postalCode: z.string().regex(/^\d{4}$/), locality: z.string().min(1).max(40),
  startDate: date, gnc: z.boolean(), gncValue: z.number().finite().min(0).max(999999999), name: z.string().trim().max(120).default(""),
}).strict().refine(value => !value.gnc || value.gncValue > 0, "Ingresá el valor del equipo de GNC.");
export type AutoQuoteInput = z.infer<typeof quoteInput>;
export async function quoteAuto(client: GalenoClient, settings: AutoConfiguration, input: AutoQuoteInput) {
  if (!quoteConfigured(settings)) throw new GalenoError("not_configured", "El cotizador todavía no está configurado. Volvé a intentar más tarde.", 503);
  const [catalogs, availableVersions, availableLocations] = await Promise.all([
    loadAdminCatalogs(client, settings), versions(client, input.brand, input.model, input.year), locations(client, input.postalCode),
  ]);
  if (!catalogs.plans.some(plan => plan.value === settings.commercialPlanCode && plan.producerCode === settings.producerCode)) throw new GalenoError("invalid_producer", "La combinación de productor y plan no está habilitada.", 422);
  for (const [list, value] of [[catalogs.billingModes, settings.billingModeCode], [catalogs.paymentConditions, settings.paymentConditionCode], [catalogs.paymentMethods, settings.paymentMethodCode], [catalogs.people, settings.personTypeCode], [catalogs.uses, settings.useTypeCode], [catalogs.iva, settings.ivaCode], [catalogs.iibb, settings.iibbCode]] as const) {
    if (!list.some(option => option.value === value)) throw new GalenoError("invalid_configuration", "Revisá las opciones comerciales de Auto en el panel.", 422);
  }
  const vehicle = availableVersions.find(item => item.value === input.version);
  if (!vehicle || vehicle.brandCode !== input.brand) throw new GalenoError("invalid_vehicle", "Elegí nuevamente la versión de tu vehículo.", 422);
  if (!availableLocations.some(item => item.value === input.locality)) throw new GalenoError("invalid_locality", "Elegí una localidad válida para tu código postal.", 422);
  const [year, month, day] = input.startDate.split("-");
  const payload = {
    rama: 4, tipoPolizaCodigo: "AUT01", planComercialCodigo: settings.commercialPlanCode, productorCodigo: settings.producerCode,
    marcaCodigo: vehicle.brandCode, modeloCodigo: vehicle.modelCode, subModeloCodigo: vehicle.subModelCode,
    anioFabricacion: input.year, ceroKM: input.zeroKm ? "S" : "", codigoPostal: input.postalCode, subCodigoPostal: input.locality,
    tomadorTipoPersona: settings.personTypeCode, tipoUso: settings.useTypeCode, tomadoCategoriaIVACodigo: settings.ivaCode, tomadorIIBBCodigo: settings.iibbCode,
    modoFacturacionCodigo: settings.billingModeCode, condicionPagoCodigo: settings.paymentConditionCode, formaPagoCodigo: settings.paymentMethodCode,
    vigenciaDesde: `${day}/${month}/${year}`, poseeEquipoGNC: input.gnc ? "2" : "", poseeEquipoRastreo: "",
    ...(input.gnc ? { accesorio1Codigo: "25", accesorio1Valor: input.gncValue } : {}),
    ...(input.name ? { tomadorNombre: input.name } : {}),
    modificarBonificacion: "N", modificarRecargoAdministrativo: "N", bonificacionPorc: 0, recargoAdministrativoPorc: 0,
  };
  const raw = await client("/api/cotizadores/auto/cotizar", payload);
  return { ...normalizeQuote(raw), billing: {
    mode: catalogs.billingModes.find(option => option.value === settings.billingModeCode)!.label,
    condition: catalogs.paymentConditions.find(option => option.value === settings.paymentConditionCode)!.label,
    method: catalogs.paymentMethods.find(option => option.value === settings.paymentMethodCode)!.label,
  } };
}
const amount = z.number().finite().nonnegative();
export function normalizeQuote(raw: unknown) {
  const schema = z.object({
    solicitud: z.union([z.number(), z.string()]).optional(), descripcionVehiculo: z.string().optional(), sumaAsegurada: amount.optional(),
    coberturas: z.array(z.object({ item: scalar, cobertura: z.string(), descripcionCobertura: z.string(), premio: amount, importeCuota1: amount, importeRestoCuotas: amount, listaAdicionales: z.array(z.string()).nullable().optional(), franquicia: z.string().nullable().optional() })).nullable().optional(),
    errores: z.array(z.object({ descripcion: z.string() })).nullable().optional(),
    excepciones: z.array(z.object({ item: scalar, estado: z.string(), detalle: z.string() })).nullable().optional(),
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new GalenoError("invalid_quote", "Galeno devolvió una cotización incompleta. Intentá nuevamente.");
  const data = parsed.data;
  if (data.errores?.length) throw new GalenoError("quote_rejected", "Galeno no pudo cotizar estos datos. Revisá el vehículo, año y vigencia.", 422);
  const restricted = new Set((data.excepciones ?? []).map(item => item.item));
  const generalRestriction = restricted.has("0");
  return { environment: "test", requestId: String(data.solicitud ?? ""), vehicle: data.descripcionVehiculo ?? "", insuredAmount: data.sumaAsegurada ?? null,
    coverages: (generalRestriction ? [] : data.coberturas ?? []).filter(item => !restricted.has(item.item)).map(item => ({ code: item.cobertura, name: item.descripcionCobertura, premium: item.premio, firstInstallment: item.importeCuota1, remainingInstallment: item.importeRestoCuotas, benefits: (item.listaAdicionales ?? []).filter(text => text.trim()), deductible: item.franquicia || "" })),
    hasRestrictions: restricted.size > 0,
  };
}
