import { ChatOpenAI } from "@langchain/openai";

export const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

export function getModel(modelName?: string) {
  return new ChatOpenAI({
    model: modelName ?? DEFAULT_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
    temperature: 0.2,
  });
}
