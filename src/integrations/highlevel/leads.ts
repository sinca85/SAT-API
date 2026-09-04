import { env } from "../../config/env.js";
import { createHash } from "node:crypto";
import type { Lead } from "../../models/lead.js";
import { HighLevelRequestError, highLevelClient } from "./client.js";
import { ensureHomeContactFields } from "./custom-fields.js";
import { getHighLevelCampaign } from "./campaigns/index.js";

type LeadDocument = InstanceType<typeof Lead>;

interface UpsertContactResponse {
  contact: { id: string };
}

interface CreateOpportunityResponse {
  opportunity: { id: string };
}

interface NoteResponse {
  note?: { id: string };
}

interface PipelinesResponse {
  pipelines?: Array<{
    id: string;
    name: string;
    stages?: Array<{ id: string; name: string }>;
  }>;
}

interface DuplicateContactBody {
  meta?: { contactId?: string };
}

const cachedStageIds = new Map<string, string>();

async function getPipelineStageId(pipelineId: string, stageName: string) {
  const cacheKey = `${pipelineId}:${stageName}`;
  const cachedStageId = cachedStageIds.get(cacheKey);
  if (cachedStageId) return cachedStageId;

  const data = await highLevelClient.request<PipelinesResponse>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(env.HIGHLEVEL_LOCATION_ID!)}`,
  );
  const pipeline = data.pipelines?.find(({ id }) => id === pipelineId);
  const stage = pipeline?.stages?.find(({ name }) => name.trim().toLocaleLowerCase("es") === stageName.toLocaleLowerCase("es"));
  if (!stage) throw new Error(`HighLevel stage "${stageName}" was not found`);
  cachedStageIds.set(cacheKey, stage.id);
  return stage.id;
}

async function syncSummaryNote(lead: LeadDocument, contactId: string) {
  const note = getHighLevelCampaign(lead.source).buildSummaryNote(lead);
  const fingerprint = createHash("sha256").update(JSON.stringify(note)).digest("hex");
  if (lead.highLevel?.summaryNoteFingerprint === fingerprint) return;

  const payload = { ...note, pinned: true };
  const noteId = lead.highLevel?.summaryNoteId;
  if (noteId) {
    await highLevelClient.request(`/contacts/${contactId}/notes/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Version: "v3" },
      body: JSON.stringify(payload),
    });
  } else {
    const data = await highLevelClient.request<NoteResponse>(`/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Version: "v3" },
      body: JSON.stringify(payload),
    });
    if (!data.note?.id) throw new Error("HighLevel did not return a summary note ID");
    lead.highLevel!.summaryNoteId = data.note.id;
  }
  lead.highLevel!.summaryNoteFingerprint = fingerprint;
}

function splitName(fullName: string) {
  const [firstName = fullName, ...lastNameParts] = fullName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(" ") };
}

export async function syncLeadToHighLevel(lead: LeadDocument) {
  if (!env.HIGHLEVEL_LOCATION_ID) throw new Error("HighLevel Location ID is not configured");
  const campaign = getHighLevelCampaign(lead.source);

  const fallbackName = splitName(lead.fullName);
  const firstName = lead.personal?.firstName || fallbackName.firstName;
  const lastName = lead.personal?.lastName || fallbackName.lastName;
  const contactFields = await ensureHomeContactFields();
  const customFields = [
    { id: contactFields.dni, fieldValue: lead.personal?.dni || "" },
    { id: contactFields.fecha_nacimiento, fieldValue: lead.personal?.dateOfBirth || "" },
    { id: contactFields.domicilio, fieldValue: lead.personal?.address || "" },
    { id: contactFields.piso, fieldValue: lead.personal?.floor || lead.quote!.floor },
    { id: contactFields.departamento, fieldValue: lead.personal?.apartment || "" },
    { id: contactFields.codigo_postal, fieldValue: lead.personal?.postalCode || lead.quote!.postalCode },
    { id: contactFields.mail, fieldValue: lead.personal?.email || lead.email || "" },
    { id: contactFields.celular, fieldValue: lead.personal?.phone || lead.phone || "" },
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
  const updateContact = (contactId: string) => highLevelClient.request<UpsertContactResponse>(
    `/contacts/${contactId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Version: "v3" },
      body: JSON.stringify({ ...contactPayload, locationId: undefined }),
    },
  );
  let recoveredContactId = existingContactId;
  let contactData: UpsertContactResponse;
  if (existingContactId) {
    contactData = await updateContact(existingContactId);
  } else {
    try {
      contactData = await highLevelClient.request<UpsertContactResponse>("/contacts/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json", Version: "v3" },
        body: JSON.stringify(contactPayload),
      });
    } catch (error) {
      const duplicateContactId = error instanceof HighLevelRequestError && error.status === 400
        ? (error.body as DuplicateContactBody)?.meta?.contactId
        : undefined;
      if (!duplicateContactId) throw error;
      recoveredContactId = duplicateContactId;
      contactData = await updateContact(duplicateContactId);
    }
  }
  /*
   * HighLevel can return an existing contact ID inside a duplicate-contact error.
   * In that case, the update response is not guaranteed to repeat the ID.
   */
  const contactId = contactData.contact?.id || recoveredContactId;
  if (!contactId) throw new Error("HighLevel did not return a contact ID");

  await highLevelClient.request(`/contacts/${contactId}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify({ tags: campaign.tags }),
  });

  lead.highLevel!.contactId = contactId;
  lead.highLevel!.syncStatus = "contact_synced";
  lead.highLevel!.lastSyncedAt = new Date();
  lead.highLevel!.lastError = undefined;

  const pipelineStageId = await getPipelineStageId(campaign.pipelineId, campaign.pipelineStageName);
  if (pipelineStageId && !lead.highLevel!.opportunityId) {
    const opportunityData = await highLevelClient.request<CreateOpportunityResponse>("/opportunities/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Version: "2021-07-28" },
      body: JSON.stringify({
        pipelineId: campaign.pipelineId,
        pipelineStageId,
        locationId: env.HIGHLEVEL_LOCATION_ID,
        name: campaign.opportunityName(lead),
        status: "open",
        contactId,
        monetaryValue: lead.quote!.monthlyPrice * 12,
      }),
    });
    lead.highLevel!.opportunityId = opportunityData.opportunity.id;
    lead.highLevel!.syncStatus = "synced";
  }

  await syncSummaryNote(lead, contactId);
  lead.highLevel!.syncStatus = "synced";

  await lead.save();
}
