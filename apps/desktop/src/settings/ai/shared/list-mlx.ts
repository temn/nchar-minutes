import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import {
  DEFAULT_RESULT,
  type InputModality,
  type ListModelsResult,
  type ModelMetadata,
} from "./list-common";

export type MlxModelConfig = {
  id: string;
  displayName: string;
  port: number;
  category: "writing" | "writing_vision" | "writing_small" | "reasoning";
  mlxRepo: string;
  ramGb: number;
  score: number;
};

export const MLX_MODELS: MlxModelConfig[] = [
  {
    id: "qwen3-next-80b-a3b",
    displayName: "Qwen3-Next-80B-A3B",
    port: 8080,
    category: "writing",
    mlxRepo: "mlx-community/Qwen3-Next-80B-A3B-4bit",
    ramGb: 30,
    score: 0.873,
  },
  {
    id: "qwen3-vl-32b-thinking",
    displayName: "Qwen3-VL-32B-Thinking",
    port: 8081,
    category: "writing_vision",
    mlxRepo: "mlx-community/Qwen3-VL-32B-Thinking-4bit",
    ramGb: 18,
    score: 0.862,
  },
  {
    id: "qwen3-vl-8b-thinking",
    displayName: "Qwen3-VL-8B-Thinking",
    port: 8082,
    category: "writing_small",
    mlxRepo: "mlx-community/Qwen3-VL-8B-Thinking-4bit",
    ramGb: 5,
    score: 0.855,
  },
  {
    id: "llama-3.3-70b",
    displayName: "Llama-3.3-70B",
    port: 8086,
    category: "reasoning",
    mlxRepo: "mlx-community/Llama-3.3-70B-Instruct-4bit",
    ramGb: 40,
    score: 0.72,
  },
];

export function getModelPort(modelId: string): number | null {
  const model = MLX_MODELS.find((m) => m.id === modelId);
  return model?.port ?? null;
}

export function getMlxBaseUrl(modelId: string): string {
  const port = getModelPort(modelId) ?? 8080;
  return `http://127.0.0.1:${port}/v1`;
}

async function probePort(port: number): Promise<boolean> {
  try {
    const response = await tauriFetch(`http://127.0.0.1:${port}/v1/models`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listMlxModels(
  _baseUrl: string,
  _apiKey: string,
): Promise<ListModelsResult> {
  try {
    const probes = await Promise.all(
      MLX_MODELS.map(async (model) => ({
        model,
        available: await probePort(model.port),
      })),
    );

    const available = probes.filter((p) => p.available);

    if (available.length === 0) {
      return DEFAULT_RESULT;
    }

    const models = available.map((p) => p.model.id);
    const metadata: Record<string, ModelMetadata> = {};
    for (const p of available) {
      const modalities: InputModality[] =
        p.model.category === "writing_vision" ? ["text", "image"] : ["text"];
      metadata[p.model.id] = { input_modalities: modalities };
    }

    return {
      models,
      ignored: probes
        .filter((p) => !p.available)
        .map((p) => ({ id: p.model.id, reasons: [] })),
      metadata,
    };
  } catch {
    return DEFAULT_RESULT;
  }
}
