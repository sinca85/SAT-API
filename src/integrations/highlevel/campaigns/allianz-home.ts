import type { HighLevelCampaign, LeadDocument } from "./types.js";

export const ALLIANZ_HOME_SOURCE = "2016_08_allianz_hogar";

function field(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "Pendiente de completar";
}

function buildSummary(lead: LeadDocument) {
  const personal = lead.personal;
  return [
    "DATOS PARA COTIZAR",
    "",
    `Nombre y apellido: ${field(lead.fullName)}`,
    `DNI: ${field(personal?.dni)}`,
    `Fecha de nacimiento: ${field(personal?.dateOfBirth)}`,
    `Domicilio: ${field(personal?.address)}`,
    `Piso: ${field(personal?.floor || lead.quote?.floor)}`,
    `Departamento: ${field(personal?.apartment)}`,
    `Código postal: ${field(personal?.postalCode || lead.quote?.postalCode)}`,
    `Mail: ${field(personal?.email || lead.email)}`,
    `Celular: ${field(personal?.phone || lead.phone)}`,
  ].join("\n");
}

export const allianzHomeCampaign: HighLevelCampaign = {
  source: ALLIANZ_HOME_SOURCE,
  tags: [ALLIANZ_HOME_SOURCE, "producto_hogar", "aseguradora_allianz"],
  pipelineId: "9DdYJgpdvNCQHDi1a4ND",
  pipelineStageName: "A contactar",
  opportunityName: (lead) => `${lead.fullName} · Seguro de Hogar`,
  buildSummaryNote: (lead) => ({
    title: "Cotización Allianz Hogar",
    body: buildSummary(lead),
    color: "#f58220",
  }),
};
