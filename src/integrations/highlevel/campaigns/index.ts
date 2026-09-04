import { ALLIANZ_HOME_SOURCE, allianzHomeCampaign } from "./allianz-home.js";
import type { HighLevelCampaign } from "./types.js";

const campaigns = new Map<string, HighLevelCampaign>([
  [ALLIANZ_HOME_SOURCE, allianzHomeCampaign],
]);

export function getHighLevelCampaign(source: string) {
  const campaign = campaigns.get(source);
  if (!campaign) throw new Error(`No HighLevel campaign integration is configured for source "${source}"`);
  return campaign;
}

export { ALLIANZ_HOME_SOURCE } from "./allianz-home.js";
