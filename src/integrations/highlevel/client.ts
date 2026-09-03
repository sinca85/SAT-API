import { env } from "../../config/env.js";

const HIGHLEVEL_API_URL = "https://services.leadconnectorhq.com";

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
      throw new Error(`HighLevel request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}

export const highLevelClient = new HighLevelClient();
