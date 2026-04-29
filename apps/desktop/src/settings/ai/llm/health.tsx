import { useQuery } from "@tanstack/react-query";
import { generateText } from "ai";
import { useEffect } from "react";

import { Spinner } from "@hypr/ui/components/ui/spinner";

import { useLanguageModel } from "~/ai/hooks";
import { useConfigValues } from "~/shared/config";

export type LlmHealthStatus = {
  status: "pending" | "error" | "success" | null;
  message?: string;
};

export function HealthStatusIndicator() {
  const health = useConnectionHealth();

  if (health.status === "pending") {
    return <Spinner size={14} className="shrink-0 text-neutral-400" />;
  }

  return null;
}

const CLI_PROVIDERS = new Set(["claude_cli", "codex_cli", "gemini_cli"]);

export function useConnectionHealth(): LlmHealthStatus {
  const model = useLanguageModel();
  const { current_llm_provider } = useConfigValues([
    "current_llm_provider",
  ] as const);

  const isCliProvider = CLI_PROVIDERS.has(current_llm_provider ?? "");

  const text = useQuery({
    enabled: !!model && !isCliProvider,
    queryKey: ["llm-health-check", model],
    staleTime: 0,
    retry: 5,
    retryDelay: 200,
    queryFn: async () => {
      const result = await generateText({
        model: model!,
        system: "If user says hi, respond with hello, without any other text.",
        prompt: "Hi",
      });
      return result;
    },
  });

  const { refetch } = text;
  useEffect(() => {
    if (model) {
      void refetch();
    }
  }, [model, refetch]);

  if (!model) {
    return { status: null };
  }

  if (isCliProvider) {
    return { status: "success" };
  }

  if (text.status === "error") {
    const error = text.error as Error;
    const message = error.message || "Unknown error";
    return {
      status: "error",
      message: `Connection failed: ${message}`,
    };
  }

  return { status: text.status };
}
