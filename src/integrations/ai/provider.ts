export interface AIProvider {
  embed(text: string): Promise<number[]>;
  answer(input: { systemInstruction: string; question: string; context: string; maxOutputTokens: number }): Promise<string>;
}
