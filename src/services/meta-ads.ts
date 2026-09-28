import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

export interface MetaAdsDateRange { startDate?: string; endDate?: string }

interface MetaAction { action_type?: string; value?: string }
interface MetaInsight {
  campaign_id?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
}

const number = (value?: string) => Number(value ?? 0) || 0;
const money = (value: number) => Math.round(value * 100) / 100;
const leadActionNames = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"]);

function metricRow(row: MetaInsight, index: number, kind: "campaign" | "ad") {
  const spend = number(row.spend);
  const impressions = number(row.impressions);
  const clicks = number(row.clicks);
  const leads = Math.max(0, ...(row.actions ?? []).filter(action => leadActionNames.has(action.action_type ?? "")).map(action => number(action.value)));
  return {
    id: (kind === "campaign" ? row.campaign_id : row.ad_id) ?? `${kind}-${index}`,
    name: (kind === "campaign" ? row.campaign_name : row.ad_name) ?? (kind === "campaign" ? "Campaña sin nombre" : "Anuncio sin nombre"),
    spend: money(spend), impressions, reach: number(row.reach), clicks,
    linkClicks: number(row.inline_link_clicks), leads,
    ctr: impressions ? money((clicks / impressions) * 100) : 0,
    cpc: clicks ? money(spend / clicks) : 0,
    costPerLead: leads ? money(spend / leads) : 0,
  };
}

function metricTotals(rows: ReturnType<typeof metricRow>[]) {
  const totals = rows.reduce((sum, row) => ({
    spend: money(sum.spend + row.spend), impressions: sum.impressions + row.impressions,
    reach: sum.reach + row.reach, clicks: sum.clicks + row.clicks,
    linkClicks: sum.linkClicks + row.linkClicks, leads: sum.leads + row.leads,
  }), { spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, leads: 0 });
  return { ...totals, ctr: totals.impressions ? money((totals.clicks / totals.impressions) * 100) : 0, cpc: totals.clicks ? money(totals.spend / totals.clicks) : 0, costPerLead: totals.leads ? money(totals.spend / totals.leads) : 0 };
}

function period(range: MetaAdsDateRange) {
  const until = range.endDate ?? new Date().toISOString().slice(0, 10);
  const sinceDate = new Date(`${until}T00:00:00Z`);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 29);
  return { since: range.startDate ?? sinceDate.toISOString().slice(0, 10), until };
}

function credentials() {
  if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
    throw new Error("Faltan META_ACCESS_TOKEN o META_AD_ACCOUNT_ID en Vercel.");
  }
  const digits = env.META_AD_ACCOUNT_ID.replace(/^act_/, "");
  if (!/^\d+$/.test(digits)) throw new Error("META_AD_ACCOUNT_ID debe contener el identificador numérico de la cuenta publicitaria.");
  return { token: env.META_ACCESS_TOKEN, accountId: `act_${digits}` };
}

function graphUrl(path: string, params: Record<string, string> = {}) {
  const { token } = credentials();
  const query = new URLSearchParams(params);
  if (env.META_APP_SECRET) query.set("appsecret_proof", createHmac("sha256", env.META_APP_SECRET).update(token).digest("hex"));
  return `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${path}?${query.toString()}`;
}

async function graph<T>(path: string, params: Record<string, string> = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const { token } = credentials();
  const response = await fetcher(graphUrl(path, params), { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    let message = `Meta respondió ${response.status}.`;
    try {
      const body = await response.json() as { error?: { message?: string; code?: number } };
      if (body.error?.message) message = `Meta respondió ${response.status}: ${body.error.message}${body.error.code ? ` (código ${body.error.code})` : ""}`;
    } catch { /* Keep the sanitized status-only error. */ }
    throw new Error(message.replace(token, "[token oculto]").slice(0, 700));
  }
  return response.json() as Promise<T>;
}

export async function testMetaAdsConnection(fetcher: typeof fetch = fetch) {
  const { accountId } = credentials();
  return graph<{ id: string; name: string; account_status: number; currency: string; timezone_name: string }>(
    accountId,
    { fields: "id,name,account_status,currency,timezone_name" },
    fetcher,
  );
}

export async function getMetaAdsOverview(range: MetaAdsDateRange = {}, fetcher: typeof fetch = fetch) {
  const account = await testMetaAdsConnection(fetcher);
  const { since, until } = period(range);
  const { accountId } = credentials();
  const body = await graph<{ data?: MetaInsight[] }>(`${accountId}/insights`, {
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,reach,clicks,inline_link_clicks,actions",
    time_range: JSON.stringify({ since, until }),
    time_increment: "all_days",
    limit: "500",
  }, fetcher);
  const campaigns = (body.data ?? []).map((row, index) => metricRow(row, index, "campaign"));
  return {
    period: `${since} al ${until}`,
    account: { id: account.id, name: account.name, status: account.account_status, currency: account.currency, timezone: account.timezone_name },
    totals: metricTotals(campaigns),
    campaigns,
  };
}

export async function getMetaCampaignAds(campaignId: string, range: MetaAdsDateRange = {}, fetcher: typeof fetch = fetch) {
  if (!/^\d+$/.test(campaignId)) throw new Error("El identificador de campaña no es válido.");
  const { since, until } = period(range);
  const [campaign, body] = await Promise.all([
    graph<{ id: string; name: string }>(campaignId, { fields: "id,name" }, fetcher),
    graph<{ data?: MetaInsight[] }>(`${campaignId}/insights`, {
      level: "ad",
      fields: "ad_id,ad_name,spend,impressions,reach,clicks,inline_link_clicks,actions",
      time_range: JSON.stringify({ since, until }),
      time_increment: "all_days",
      limit: "500",
    }, fetcher),
  ]);
  const ads = (body.data ?? []).map((row, index) => metricRow(row, index, "ad"));
  return { period: `${since} al ${until}`, campaign, totals: metricTotals(ads), ads };
}
