import { env } from "../../config/env.js";
import type { Lead } from "../../models/lead.js";
import { highLevelClient } from "./client.js";

type LeadDocument = InstanceType<typeof Lead>;

interface UpsertContactResponse {
  contact: { id: string };
}

interface CreateOpportunityResponse {
  opportunity: { id: string };
}

function splitName(fullName: string) {
  const [firstName = fullName, ...lastNameParts] = fullName.trim().split(/\s+/);
  return { firstName, lastName: lastNameParts.join(" ") };
}

export async function syncLeadToHighLevel(lead: LeadDocument) {
  if (!env.HIGHLEVEL_LOCATION_ID) throw new Error("HighLevel Location ID is not configured");

  const { firstName, lastName } = splitName(lead.fullName);
  const contactData = await highLevelClient.request<UpsertContactResponse>("/contacts/upsert", {
    method: "POST",
    headers: { "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify({
      locationId: env.HIGHLEVEL_LOCATION_ID,
      firstName,
      lastName,
      name: lead.fullName,
      email: lead.email,
      phone: lead.phone,
      postalCode: lead.quote!.postalCode,
      source: lead.source,
    }),
  });

  await highLevelClient.request(`/contacts/${contactData.contact.id}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify({ tags: [lead.source, "producto_hogar", "aseguradora_allianz"] }),
  });

  lead.highLevel!.contactId = contactData.contact.id;
  lead.highLevel!.syncStatus = "contact_synced";
  lead.highLevel!.lastSyncedAt = new Date();
  lead.highLevel!.lastError = undefined;

  if (env.HIGHLEVEL_PIPELINE_ID) {
    const opportunityData = await highLevelClient.request<CreateOpportunityResponse>("/opportunities/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Version: "2021-07-28" },
      body: JSON.stringify({
        pipelineId: env.HIGHLEVEL_PIPELINE_ID,
        pipelineStageId: env.HIGHLEVEL_PIPELINE_STAGE_ID,
        locationId: env.HIGHLEVEL_LOCATION_ID,
        name: `${lead.fullName} · Seguro de Hogar`,
        status: "open",
        contactId: contactData.contact.id,
        monetaryValue: lead.quote!.monthlyPrice * 12,
      }),
    });
    lead.highLevel!.opportunityId = opportunityData.opportunity.id;
    lead.highLevel!.syncStatus = "synced";
  }

  await lead.save();
}
