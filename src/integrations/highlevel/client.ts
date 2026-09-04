import { env } from "../../config/env.js";

const HIGHLEVEL_API_URL = "https://services.leadconnectorhq.com";

export class HighLevelRequestError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, rawBody: string) {
    super(`HighLevel request failed with status ${status}${rawBody ? `: ${rawBody}` : ""}`);
    this.name = "HighLevelRequestError";
  }
}

export class HighLevelClient {
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN) {
      throw new Error("HighLevel private integration token is not configured");
    }

    const response = await fetch(`${HIGHLEVEL_API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN}`,
        Version: "2021-07-28",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 1500);
      let parsedBody: unknown = responseBody;
      try { parsedBody = JSON.parse(responseBody); } catch { /* Keep the raw response. */ }
      throw new HighLevelRequestError(response.status, parsedBody, responseBody);
    }

    return (await response.json()) as T;
  }
}

export const highLevelClient = new HighLevelClient();
