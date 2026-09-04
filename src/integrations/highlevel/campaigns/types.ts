import type { Lead } from "../../../models/lead.js";

export type LeadDocument = InstanceType<typeof Lead>;

export interface CampaignSummaryNote {
  title: string;
  body: string;
  color?: string;
}

export interface HighLevelCampaign {
  source: string;
  tags: string[];
  pipelineId: string;
  pipelineStageName: string;
  opportunityName: (lead: LeadDocument) => string;
  buildSummaryNote: (lead: LeadDocument) => CampaignSummaryNote;
}
