import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { Spinner } from "@hypr/ui/components/ui/spinner";

import { useConfigValues } from "~/shared/config";
import {
  tryLaunchMlxWhisperServer,
  type MlxWhisperStatus,
} from "~/stt/mlx-whisper-health";
import { useSTTConnection } from "~/stt/useSTTConnection";

export type HealthStatus = {
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

function useDeepgramHealth(enabled: boolean, apiKey?: string) {
  return useQuery({
    enabled,
    queryKey: ["stt-health-check", "deepgram", apiKey],
    staleTime: 0,
    retry: 3,
    retryDelay: 200,
    queryFn: async () => {
      const response = await tauriFetch(
        "https://api.deepgram.com/v1/projects",
        {
          headers: {
            Authorization: `Token ${apiKey}`,
          },
        },
      );
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.status;
    },
  });
}

function useMlxWhisperHealth(enabled: boolean) {
  return useQuery<MlxWhisperStatus>({
    enabled,
    queryKey: ["stt-health-check", "mlx_whisper"],
    staleTime: 5000,
    retry: 1,
    queryFn: () => tryLaunchMlxWhisperServer(),
  });
}

export function useConnectionHealth(): HealthStatus {
  const { conn, local } = useSTTConnection();
  const { current_stt_provider, current_stt_model } = useConfigValues([
    "current_stt_provider",
    "current_stt_model",
  ] as const);

  const isCloud =
    (current_stt_provider === "hyprnote" && current_stt_model === "cloud") ||
    current_stt_provider !== "hyprnote";
  const isDeepgram = current_stt_provider === "deepgram";
  const isMlxWhisper = current_stt_provider === "mlx_whisper";

  const deepgramHealth = useDeepgramHealth(isDeepgram && !!conn, conn?.apiKey);
  const mlxWhisperHealth = useMlxWhisperHealth(isMlxWhisper);

  if (!isCloud) {
    const serverStatus = local.data?.status ?? "unavailable";
    if (serverStatus === "not_downloaded") {
      return {
        status: "error",
        message: "Selected model is not downloaded.",
      };
    }
    if (serverStatus === "loading") {
      return {
        status: "pending",
        message: "Local STT server is starting up…",
      };
    }
    if (serverStatus === "ready" && conn) {
      return { status: "success" };
    }
    return {
      status: "error",
      message: "Could not connect to the local speech-to-text model.",
    };
  }

  if (!conn) {
    return { status: "error", message: "Provider not configured." };
  }

  if (isMlxWhisper) {
    if (mlxWhisperHealth.isPending) {
      return { status: "pending", message: "Checking MLX Whisper server…" };
    }
    if (mlxWhisperHealth.data?.status === "starting") {
      return { status: "pending", message: "Starting MLX Whisper server…" };
    }
    if (mlxWhisperHealth.data?.status === "running") {
      return { status: "success" };
    }
    if (mlxWhisperHealth.data?.status === "unavailable") {
      return {
        status: "error",
        message: mlxWhisperHealth.data.message,
      };
    }
    return { status: "error", message: "MLX Whisper server not available." };
  }

  if (isDeepgram) {
    if (deepgramHealth.isPending) {
      return { status: "pending", message: "Verifying API key..." };
    }
    if (deepgramHealth.isError) {
      return {
        status: "error",
        message: `API key verification failed: ${deepgramHealth.error.message}`,
      };
    }
    if (deepgramHealth.isSuccess) {
      return { status: "success" };
    }
  }

  return { status: "success" };
}
