import { env } from "../../config/env.js";
import type { Lead } from "../../models/lead.js";
import { highLevelClient } from "./client.js";
import { ensureHomeContactFields } from "./custom-fields.js";

type LeadDocument = InstanceType<typeof Lead>;

interface UpsertContactResponse {
  contact: { id: string };
}

interface CreateOpportunityResponse {
  opportunity: { id: string };
}

interface PipelinesResponse {
  pipelines?: Array<{
    id: string;
    name: string;
    stages?: Array<{ id: string; name: string }>;
  }>;
}

const HOME_PIPELINE_ID = "9DdYJgpdvNCQHDi1a4ND";
const HOME_PIPELINE_STAGE_NAME = "A contactar";
let cachedHomeStageId: string | undefined;

async function getHomePipelineStageId() {
  if (cachedHomeStageId) return cachedHomeStageId;

  const data = await highLevelClient.request<PipelinesResponse>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(env.HIGHLEVEL_LOCATION_ID!)}`,
  );
  const pipeline = data.pipelines?.find(({ id }) => id === HOME_PIPELINE_ID);
  const stage = pipeline?.stages?.find(({ name }) => name.trim().toLocaleLowerCase("es") === HOME_PIPELINE_STAGE_NAME.toLocaleLowerCase("es"));
  if (!stage) throw new Error(`HighLevel stage "${HOME_PIPELINE_STAGE_NAME}" was not found`);
  cachedHomeStageId = stage.id;
  return stage.id;
}

function splitName(fullName: string) {
  const [firstName = fullName, ...lastNameParts] = fullName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(" ") };
}

export async function syncLeadToHighLevel(lead: LeadDocument) {
  if (!env.HIGHLEVEL_LOCATION_ID) throw new Error("HighLevel Location ID is not configured");

  const fallbackName = splitName(lead.fullName);
  const firstName = lead.personal?.firstName || fallbackName.firstName;
  const lastName = lead.personal?.lastName || fallbackName.lastName;
  const contactFields = await ensureHomeContactFields();
  const customFields = [
    { id: contactFields.dni, fieldValue: lead.personal?.dni || "" },
    { id: contactFields.piso, fieldValue: lead.personal?.floor || lead.quote!.floor },
    { id: contactFields.departamento, fieldValue: lead.personal?.apartment || "" },
    { id: contactFields.tipo_vivienda, fieldValue: lead.quote!.homeType },
    { id: contactFields.metros_cuadrados, fieldValue: lead.quote!.areaLabel },
    { id: contactFields.precio_mensual, fieldValue: lead.quote!.monthlyPrice },
    { id: contactFields.suma_asegurada_estructura, fieldValue: lead.quote!.structureCoverage },
  ];
  const existingContactId = lead.highLevel?.contactId;
  const contactPayload = {
    ...(!existingContactId ? { locationId: env.HIGHLEVEL_LOCATION_ID } : {}),
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" "),
    email: lead.personal?.email || lead.email || null,
    phone: lead.personal?.phone || lead.phone || null,
    address1: lead.personal?.address || null,
    postalCode: lead.personal?.postalCode || lead.quote!.postalCode,
    dateOfBirth: lead.personal?.dateOfBirth || null,
    customFields,
    source: lead.source,
  };
  const contactData = await highLevelClient.request<UpsertContactResponse>(
    existingContactId ? `/contacts/${existingContactId}` : "/contacts/upsert",
    {
      method: existingContactId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Version: "v3" },
      body: JSON.stringify(contactPayload),
    },
  );
  const contactId = contactData.contact?.id || existingContactId;
  if (!contactId) throw new Error("HighLevel did not return a contact ID");

  await highLevelClient.request(`/contacts/${contactId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify({ tags: [lead.source, "producto_hogar", "aseguradora_allianz"] }),
  });

  lead.highLevel!.contactId = contactId;
  lead.highLevel!.syncStatus = "contact_synced";
  lead.highLevel!.lastSyncedAt = new Date();
  lead.highLevel!.lastError = undefined;

  const pipelineStageId = await getHomePipelineStageId();
  if (pipelineStageId && !lead.highLevel!.opportunityId) {
    const opportunityData = await highLevelClient.request<CreateOpportunityResponse>("/opportunities/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Version: "2021-07-28" },
      body: JSON.stringify({
        pipelineId: HOME_PIPELINE_ID,
        pipelineStageId,
        locationId: env.HIGHLEVEL_LOCATION_ID,
        name: `${lead.fullName} · Seguro de Hogar`,
        status: "open",
        contactId,
        monetaryValue: lead.quote!.monthlyPrice * 12,
      }),
    });
    lead.highLevel!.opportunityId = opportunityData.opportunity.id;
    lead.highLevel!.syncStatus = "synced";
  }

  await lead.save();
}
