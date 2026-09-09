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

function formatPeriodDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

export async function getAnalyticsOverview(propertyId: string, campaign: AnalyticsCampaignDefinition, range: AnalyticsDateRange = {}) {
  const dateRanges = [{ startDate: range.startDate ?? "30daysAgo", endDate: range.endDate ?? "today" }];
  const period = range.startDate && range.endDate ? `${formatPeriodDate(range.startDate)} al ${formatPeriodDate(range.endDate)}` : "Últimos 30 días";
  const [totalsReport, sourcesReport, landingReport, eventsReport] = await Promise.all([
    runReport(propertyId, {
      dateRanges,
      metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "8",
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      dimensionFilter: { filter: { fieldName: "pagePath", stringFilter: { matchType: "BEGINS_WITH", value: campaign.landingPath } } },
      limit: "1",
    }),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: { orGroup: { expressions: [
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: campaign.stepOneEvent } } },
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: campaign.quoteEvent } } },
        { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: campaign.contractEvent } } },
      ] } },
    }),
  ]);
  const totals = totalsReport.totals?.[0]?.metricValues ?? totalsReport.rows?.[0]?.metricValues ?? [];
  const landing = landingReport.rows?.[0]?.metricValues ?? [];
  const events = new Map((eventsReport.rows ?? []).map((row) => [row.dimensionValues?.[0]?.value, row.metricValues ?? []]));
  const funnel = [
    { key: "visit", label: `Visitas a ${campaign.landingPath}`, description: "Personas que ingresaron a la landing", users: numeric(landing[0]?.value), events: numeric(landing[1]?.value) },
    { key: "home", label: "Paso 1 completado", description: "Datos iniciales validados", users: numeric(events.get(campaign.stepOneEvent)?.[1]?.value), events: numeric(events.get(campaign.stepOneEvent)?.[0]?.value) },
    { key: "quote", label: "Cotización generada", description: "Primera etapa enviada", users: numeric(events.get(campaign.quoteEvent)?.[1]?.value), events: numeric(events.get(campaign.quoteEvent)?.[0]?.value) },
    { key: "contract", label: "Solicitud de contratación", description: "Datos finales enviados correctamente", users: numeric(events.get(campaign.contractEvent)?.[1]?.value), events: numeric(events.get(campaign.contractEvent)?.[0]?.value) },
  ];
  return {
    period,
    activeUsers: numeric(totals[0]?.value),
    sessions: numeric(totals[1]?.value),
    pageViews: numeric(totals[2]?.value),
    funnel,
    channels: (sourcesReport.rows ?? []).map((row) => ({
      name: row.dimensionValues?.[0]?.value || "Sin clasificar",
      activeUsers: numeric(row.metricValues?.[0]?.value),
      sessions: numeric(row.metricValues?.[1]?.value),
    })),
  };
}
