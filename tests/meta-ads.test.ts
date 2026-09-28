import assert from "node:assert/strict";
import { test } from "node:test";
import { env } from "../src/config/env.js";
import { getMetaAdsOverview, testMetaAdsConnection } from "../src/services/meta-ads.js";

Object.assign(env, {
  META_ACCESS_TOKEN: "secret-meta-token",
  META_AD_ACCOUNT_ID: "2957417184503029",
  META_APP_SECRET: "secret-app-value",
  META_GRAPH_API_VERSION: "v23.0",
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

test("Meta connection uses a bearer token and normalizes the account id", async () => {
  let requestUrl = "";
  let authorization = "";
  const fetcher: typeof fetch = async (url, init) => {
    requestUrl = String(url);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return json({ id: "act_2957417184503029", name: "Seguro a tiempo", account_status: 1, currency: "ARS", timezone_name: "America/Argentina/Buenos_Aires" });
  };
  const account = await testMetaAdsConnection(fetcher);
  assert.equal(account.name, "Seguro a tiempo");
  assert.match(requestUrl, /v23\.0\/act_2957417184503029/);
  assert.match(requestUrl, /appsecret_proof=/);
  assert.ok(!requestUrl.includes("secret-meta-token"));
  assert.equal(authorization, "Bearer secret-meta-token");
});

test("Meta overview aggregates campaign metrics without counting duplicate lead action variants", async () => {
  const fetcher: typeof fetch = async (url) => String(url).includes("/insights?")
    ? json({ data: [
      { campaign_id: "1", campaign_name: "Autos", spend: "1000.50", impressions: "10000", reach: "8000", clicks: "200", inline_link_clicks: "150", actions: [{ action_type: "lead", value: "10" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "10" }] },
      { campaign_id: "2", campaign_name: "Hogar", spend: "500", impressions: "5000", reach: "4000", clicks: "50", inline_link_clicks: "40", actions: [] },
    ] })
    : json({ id: "act_2957417184503029", name: "Seguro a tiempo", account_status: 1, currency: "ARS", timezone_name: "America/Argentina/Buenos_Aires" });
  const result = await getMetaAdsOverview({ startDate: "2026-09-01", endDate: "2026-09-28" }, fetcher);
  assert.equal(result.totals.spend, 1500.5);
  assert.equal(result.totals.leads, 10);
  assert.equal(result.totals.clicks, 250);
  assert.equal(result.campaigns[0]?.costPerLead, 100.05);
});

test("Meta errors do not expose the access token", async () => {
  const fetcher: typeof fetch = async () => json({ error: { message: "Invalid token secret-meta-token", code: 190 } }, 401);
  await assert.rejects(() => testMetaAdsConnection(fetcher), (error: Error) => error.message.includes("[token oculto]") && !error.message.includes("secret-meta-token"));
});
