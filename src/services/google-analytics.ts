import { createSign } from "node:crypto";
import { env } from "../config/env.js";

const analyticsScope = "https://www.googleapis.com/auth/analytics.readonly";
let tokenCache: { token: string; expiresAt: number } | undefined;

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  if (!env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Faltan las credenciales de cuenta de servicio de Google Analytics.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_EMAIL,
    scope: analyticsScope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const privateKey = env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const assertion = `${signingInput}.${signer.sign(privateKey).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`Google OAuth respondió ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("Google no devolvió un token de acceso.");
  tokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return tokenCache.token;
}

interface RunReportResponse {
  rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
  totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
}

async function runReport(propertyId: string, body: object): Promise<RunReportResponse> {
  const token = await accessToken();
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 700);
    throw new Error(`Google Analytics respondió ${response.status}${detail ? `: ${detail}` : "."}`);
  }
  return response.json() as Promise<RunReportResponse>;
}

const numeric = (value?: string) => Number(value ?? 0);

export interface AnalyticsCampaignDefinition {
  name: string;
  landingPath: string;
  stepOneEvent: string;
  quoteEvent: string;
  contractEvent: string;
}

export interface AnalyticsDateRange {
  startDate?: string;
  endDate?: string;
}

export interface AnalyticsFunnelStepDefinition {
  eventName: string;
  label: string;
}

export async function getAnalyticsCampaignEvents(propertyId: string, utmCampaign: string, landingPath: string) {
  const report = await runReport(propertyId, {
    dateRanges: [{ startDate: "365daysAgo", endDate: "today" }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
    dimensionFilter: { andGroup: { expressions: [
      { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: landingPath } } },
      { filter: { fieldName: "sessionManualCampaignName", stringFilter: { matchType: "EXACT", value: utmCampaign } } },
    ] } },
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: "250",
  });
  return (report.rows ?? []).map((row) => ({
    eventName: row.dimensionValues?.[0]?.value ?? "",
    events: numeric(row.metricValues?.[0]?.value),
    users: numeric(row.metricValues?.[1]?.value),
  })).filter((event) => event.eventName);
}

export async function getAnalyticsCampaignNames(propertyId: string, landingPath: string): Promise<string[]> {
  const report = await runReport(propertyId, {
    dateRanges: [{ startDate: "365daysAgo", endDate: "today" }],
    dimensions: [{ name: "sessionManualCampaignName" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: landingPath } } },
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: "100",
  });
  return (report.rows ?? [])
    .map((row) => row.dimensionValues?.[0]?.value?.trim() ?? "")
    .filter((name) => name && name !== "(not set)");
}

interface FunnelStep {
  key: string;
  label: string;
  description: string;
  users: number;
  events: number;
}

interface UtmFunnelGroup {
  source: string;
  campaign: string;
  content: string;
  visit?: Array<{ value?: string }>;
  events: Map<string | undefined, Array<{ value?: string }>>;
}

function formatPeriodDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export async function getAnalyticsOverview(propertyId: string, campaign: AnalyticsCampaignDefinition, range: AnalyticsDateRange = {}, utmCampaign?: string, configuredSteps?: AnalyticsFunnelStepDefinition[]) {
  const dateRanges = [{ startDate: range.startDate ?? "30daysAgo", endDate: range.endDate ?? "today" }];
  const period = range.startDate && range.endDate ? `${formatPeriodDate(range.startDate)} al ${formatPeriodDate(range.endDate)}` : "Últimos 30 días";
  const campaignFilter = utmCampaign ? { filter: { fieldName: "sessionManualCampaignName", stringFilter: { matchType: "EXACT", value: utmCampaign } } } : undefined;
  const landingPathFilter = { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: campaign.landingPath } } };
  const landingFilters = campaignFilter ? { andGroup: { expressions: [landingPathFilter, campaignFilter] } } : landingPathFilter;
  const eventSteps: AnalyticsFunnelStepDefinition[] = configuredSteps?.length ? configuredSteps : [
    { eventName: campaign.stepOneEvent, label: "Paso 1 completado" },
    { eventName: campaign.quoteEvent, label: "Cotización generada" },
    { eventName: campaign.contractEvent, label: "Solicitud de contratación" },
  ];
  const eventFilter = { orGroup: { expressions: eventSteps.map((step) => ({ filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: step.eventName } } })) } };
  const eventsFilter = campaignFilter ? { andGroup: { expressions: [eventFilter, campaignFilter] } } : eventFilter;
  const [totalsReport, sourcesReport, landingReport, eventsReport, landingByUtmReport, eventsByUtmReport] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      ...(campaignFilter ? { dimensionFilter: campaignFilter } : {}),
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      ...(campaignFilter ? { dimensionFilter: campaignFilter } : {}),
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "8",
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      dimensionFilter: landingFilters,
      limit: "1",
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: eventsFilter,
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionManualSource" }, { name: "sessionManualCampaignName" }, { name: "sessionManualAdContent" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      dimensionFilter: landingFilters,
      limit: "100",
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionManualSource" }, { name: "sessionManualCampaignName" }, { name: "sessionManualAdContent" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: eventsFilter,
      limit: "300",
    }),
  ]);
  const totals = totalsReport.totals?.[0]?.metricValues ?? totalsReport.rows?.[0]?.metricValues ?? [];
  const landing = landingReport.rows?.[0]?.metricValues ?? [];
  const events = new Map((eventsReport.rows ?? []).map((row) => [row.dimensionValues?.[0]?.value, row.metricValues ?? []]));
  const funnel: FunnelStep[] = [
    { key: "visit", label: `Visitas a ${campaign.landingPath}`, description: "Personas que ingresaron a la landing", users: numeric(landing[0]?.value), events: numeric(landing[1]?.value) },
    ...eventSteps.map((step, index) => ({
      key: step.eventName,
      label: step.label,
      description: `Evento GA4: ${step.eventName}`,
      users: numeric(events.get(step.eventName)?.[1]?.value),
      events: numeric(events.get(step.eventName)?.[0]?.value),
    })),
  ];
  const utmGroups = new Map<string, UtmFunnelGroup>();
  const getUtmGroup = (sourceName?: string, campaignName?: string, contentName?: string) => {
    const sourceValue = sourceName || "(sin source UTM)";
    const campaignValue = campaignName || "(sin campaña UTM)";
    const contentValue = contentName || "(sin pieza UTM)";
    const key = `${sourceValue}\u0000${campaignValue}\u0000${contentValue}`;
    const existing = utmGroups.get(key);
    if (existing) return existing;
    const created: UtmFunnelGroup = { source: sourceValue, campaign: campaignValue, content: contentValue, events: new Map() };
    utmGroups.set(key, created);
    return created;
  };
  for (const row of landingByUtmReport.rows ?? []) {
    const [sourceName, campaignName, contentName] = row.dimensionValues?.map((value) => value.value) ?? [];
    getUtmGroup(sourceName, campaignName, contentName).visit = row.metricValues;
  }
  for (const row of eventsByUtmReport.rows ?? []) {
    const [sourceName, campaignName, contentName, eventName] = row.dimensionValues?.map((value) => value.value) ?? [];
    getUtmGroup(sourceName, campaignName, contentName).events.set(eventName, row.metricValues ?? []);
  }
  const utmBreakdown = Array.from(utmGroups.values())
    .map((group) => ({
      source: group.source,
      campaign: group.campaign,
      content: group.content,
      funnel: [
        { key: "visit", users: numeric(group.visit?.[0]?.value), events: numeric(group.visit?.[1]?.value) },
        ...eventSteps.map((step) => ({ key: step.eventName, users: numeric(group.events.get(step.eventName)?.[1]?.value), events: numeric(group.events.get(step.eventName)?.[0]?.value) })),
      ],
    }))
    .sort((first, second) => (second.funnel[0]?.users ?? 0) - (first.funnel[0]?.users ?? 0));
  return {
    period,
    activeUsers: numeric(totals[0]?.value),
    sessions: numeric(totals[1]?.value),
    pageViews: numeric(totals[2]?.value),
    funnel,
    utmBreakdown,
    channels: (sourcesReport.rows ?? []).map((row) => ({
      name: row.dimensionValues?.[0]?.value || "Sin clasificar",
      activeUsers: numeric(row.metricValues?.[0]?.value),
      sessions: numeric(row.metricValues?.[1]?.value),
    })),
  };
}
