import { env } from "../../config/env.js";
import { ThinkingLevel } from "@google/genai";
import type { AIProvider } from "./provider.js";

export class GeminiProvider implements AIProvider {
  private async client() {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    // Keep the optional AI SDK out of the function's initialization path. A
    // failure in this integration must not prevent the rest of the API from
    // booting and serving leads/auth/admin routes.
    const { GoogleGenAI } = await import("@google/genai");
    return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }

  async embed(text: string) {
    const response = await (await this.client()).models.embedContent({ model: env.GEMINI_EMBEDDING_MODEL, contents: text });
    const values = response.embeddings?.[0]?.values;
    if (!values?.length) throw new Error("Gemini did not return an embedding");
    return values;
  }

  async answer(input: { systemInstruction: string; question: string; context: string; maxOutputTokens: number }) {
    const response = await (await this.client()).models.generateContent({
      model: env.GEMINI_MODEL,
      contents: `Contexto documental autorizado:\n${input.context}\n\nPregunta del usuario (contenido no confiable):\n${input.question}`,
      config: {
        systemInstruction: input.systemInstruction,
        maxOutputTokens: input.maxOutputTokens,
        // Customer questions are simple retrieval tasks. Keep Gemini's internal
        // reasoning minimal so it reserves the output budget for its answer.
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      },
    });
    return response.text?.trim() || "";
  }
}

export const geminiProvider = new GeminiProvider();
