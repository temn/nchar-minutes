import { getMlxBaseUrl, MLX_MODELS, type MlxModelConfig } from "./list-mlx";

export const MLX_WRITING_FALLBACK_ORDER: MlxModelConfig[] = [
  ...MLX_MODELS,
].sort((a, b) => b.score - a.score);

export async function findAvailableMlxEndpoint(): Promise<{
  modelId: string;
  baseUrl: string;
} | null> {
  for (const model of MLX_WRITING_FALLBACK_ORDER) {
    try {
      const response = await fetch(`http://127.0.0.1:${model.port}/v1/models`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        return { modelId: model.id, baseUrl: getMlxBaseUrl(model.id) };
      }
    } catch {
      continue;
    }
  }
  return null;
}
