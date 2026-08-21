import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";

export interface AIQueryOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  openaiModel?: string;
  anthropicModel?: string;
  provider?: "openai" | "anthropic";
}

export interface AIResponse {
  content: string;
  provider: "openai" | "anthropic";
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface OllamaQueryOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  baseUrl?: string;
}

export interface OllamaResponse {
  content: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

const DEFAULT_OPENAI_MODEL = "gpt-5.2";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";
const DEFAULT_OLLAMA_BASE_URL = env.FASTLANE_WORKER_URL?.replace("3200", "11434") ?? "http://localhost:11434"; // too lazy
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 4000;

interface OllamaChatResponse {
  model: string;
  message?: { role: string; content: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export class AIClient {
  private readonly openai?: OpenAI;
  private readonly anthropic?: Anthropic;
  private readonly preferredProvider: "openai" | "anthropic";

  constructor() {
    if (env.OPENAI_API_KEY) this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    if (env.ANTHROPIC_API_KEY) this.anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.preferredProvider = env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
  }

  get hasProvider(): boolean {
    return !!(this.openai || this.anthropic);
  }

  get hasOpenAI(): boolean {
    return !!this.openai;
  }

  async query(systemPrompt: string, userPrompt: string, options?: AIQueryOptions): Promise<AIResponse> {
    if (options?.provider === "openai" && this.openai) {
      return this.callOpenAI(systemPrompt, userPrompt, options);
    }
    if (options?.provider === "anthropic" && this.anthropic) {
      return this.callAnthropic(systemPrompt, userPrompt, options);
    }
    if (this.preferredProvider === "anthropic" && this.anthropic) {
      return this.callAnthropic(systemPrompt, userPrompt, options);
    }
    if (this.openai) {
      return this.callOpenAI(systemPrompt, userPrompt, options);
    }
    if (this.anthropic) {
      return this.callAnthropic(systemPrompt, userPrompt, options);
    }
    throw new Error("No AI provider available");
  }

  private async callOpenAI(systemPrompt: string, userPrompt: string, options?: AIQueryOptions): Promise<AIResponse> {
    const model = options?.openaiModel ?? DEFAULT_OPENAI_MODEL;
    const response = await this.openai!.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(options?.jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    return {
      content: response.choices[0]?.message?.content ?? "",
      provider: "openai",
      model,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
    };
  }

  private async callAnthropic(systemPrompt: string, userPrompt: string, options?: AIQueryOptions): Promise<AIResponse> {
    const model = options?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL;
    const response = await this.anthropic!.messages.create({
      model,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      content: text,
      provider: "anthropic",
      model,
      promptTokens: response.usage?.input_tokens,
      completionTokens: response.usage?.output_tokens,
    };
  }
}

function ollamaUrl(baseUrl?: string): string {
  return (baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
}

export async function queryOllama(
  systemPrompt: string,
  userPrompt: string,
  options?: OllamaQueryOptions,
): Promise<OllamaResponse> {
  const model = options?.model ?? DEFAULT_OLLAMA_MODEL;
  const res = await fetch(`${ollamaUrl(options?.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...(options?.jsonMode ? { format: "json" } : {}),
      options: {
        temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
        num_predict: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama request failed: ${res.status} ${res.statusText}, model: ${model}, response: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (data.error) throw new Error(`Ollama error: ${data.error}`);

  return {
    content: data.message?.content ?? "",
    model,
    promptTokens: data.prompt_eval_count,
    completionTokens: data.eval_count,
  };
}

export async function isOllamaAvailable(baseUrl?: string): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaUrl(baseUrl)}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const res = await fetch(`${ollamaUrl(baseUrl)}/api/tags`, { method: "GET" });
  if (!res.ok) throw new Error(`Ollama tags request failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as OllamaTagsResponse;
  return (data.models ?? []).map((m) => m.name);
}

export async function ensureOllamaModel(model: string, baseUrl?: string): Promise<void> {
  const url = ollamaUrl(baseUrl);
  const res = await fetch(`${url}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model }),
  });
  if (res.ok) return;

  const pullRes = await fetch(`${url}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!pullRes.ok) {
    throw new Error(`Failed to pull Ollama model "${model}": ${pullRes.status} ${pullRes.statusText}`);
  }
}
