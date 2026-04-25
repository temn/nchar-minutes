import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  generateText,
  type LanguageModel,
  Output,
  smoothStream,
  streamText,
} from "ai";
import { wrapLanguageModel, extractReasoningMiddleware } from "ai";
import { z } from "zod";

import {
  commands as templateCommands,
  type TemplateSection,
} from "@hypr/plugin-template";
import { templateSectionSchema } from "@hypr/store";

import type { TaskArgsMapTransformed, TaskConfig } from ".";
import { createEnhanceValidator } from "./enhance-validator";

import { findAvailableMlxEndpoint } from "~/settings/ai/shared/mlx-fallback";
import type { Store } from "~/store/tinybase/store/main";
import { normalizeBulletPoints } from "~/store/zustand/ai-task/shared/transform_impl";
import { withEarlyValidationRetry } from "~/store/zustand/ai-task/shared/validate";
import { assertCanonicalTemplateSections } from "~/templates/codec";

export const enhanceWorkflow: Pick<
  TaskConfig<"enhance">,
  "executeWorkflow" | "transforms"
> = {
  executeWorkflow,
  transforms: [
    normalizeBulletPoints(),
    smoothStream({ delayInMs: 250, chunking: "line" }),
  ],
};

async function* executeWorkflow(params: {
  model: LanguageModel;
  args: TaskArgsMapTransformed["enhance"];
  onProgress: (step: any) => void;
  signal: AbortSignal;
  store: Store;
}) {
  const { model, args, onProgress, signal, store } = params;

  const sections = await generateTemplateIfNeeded({
    model,
    args,
    onProgress,
    signal,
    store,
  });
  const argsWithTemplate: TaskArgsMapTransformed["enhance"] = {
    ...args,
    template: sections ? { title: "", description: null, sections } : null,
  };

  const system = await getSystemPrompt(argsWithTemplate);
  const prompt = await getUserPrompt(argsWithTemplate, store);

  try {
    yield* generateSummary({
      model,
      args: argsWithTemplate,
      system,
      prompt,
      onProgress,
      signal,
    });
  } catch (err) {
    const fallback = await tryMlxFallback();
    if (!fallback) {
      throw err;
    }
    onProgress({ type: "fallback", modelId: fallback.modelId });
    yield* generateSummary({
      model: fallback.model,
      args: argsWithTemplate,
      system,
      prompt,
      onProgress,
      signal,
    });
  }
}

async function tryMlxFallback(): Promise<{
  model: LanguageModel;
  modelId: string;
} | null> {
  const endpoint = await findAvailableMlxEndpoint();
  if (!endpoint) {
    return null;
  }
  const provider = createOpenAICompatible({
    fetch: tauriFetch,
    name: "mlx_local",
    baseURL: endpoint.baseUrl,
  });
  const raw = provider.chatModel(endpoint.modelId);
  const model = wrapLanguageModel({
    model: raw,
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });
  return { model: model as LanguageModel, modelId: endpoint.modelId };
}

async function getSystemPrompt(args: TaskArgsMapTransformed["enhance"]) {
  const format = args.outputFormat ?? "summary";

  let templateArg: Parameters<typeof templateCommands.render>[0];
  switch (format) {
    case "minutes":
      templateArg = {
        ncharMinutesSystem: { language: args.language },
      };
      break;
    case "action_items":
      templateArg = {
        ncharActionItemsSystem: { language: args.language },
      };
      break;
    default:
      templateArg = {
        enhanceSystem: { language: args.language },
      };
  }

  const result = await templateCommands.render(templateArg);

  if (result.status === "error") {
    throw new Error(result.error);
  }

  return result.data;
}

async function getUserPrompt(
  args: TaskArgsMapTransformed["enhance"],
  _store: Store,
) {
  const {
    session,
    participants,
    template: rawTemplate,
    transcripts,
    preMeetingMemo,
    postMeetingMemo,
  } = args;
  const template = rawTemplate
    ? {
        ...rawTemplate,
        sections: assertCanonicalTemplateSections(
          rawTemplate.sections,
          "enhance render template.sections",
        ),
      }
    : null;

  const result = await templateCommands.render({
    enhanceUser: {
      session,
      participants,
      template,
      transcripts,
      preMeetingMemo,
      postMeetingMemo,
    },
  });

  if (result.status === "error") {
    throw new Error(result.error);
  }

  return result.data;
}

async function generateTemplateIfNeeded(params: {
  model: LanguageModel;
  args: TaskArgsMapTransformed["enhance"];
  onProgress: (step: any) => void;
  signal: AbortSignal;
  store: Store;
}): Promise<TemplateSection[] | null> {
  const { model, args, onProgress, signal, store } = params;

  if (!args.template) {
    onProgress({ type: "analyzing" });

    const schema = z.object({ sections: z.array(templateSectionSchema) });
    const userPrompt = await getUserPrompt(args, store);

    const result = await generateStructuredOutput({
      model,
      schema,
      signal,
      prompt: createTemplatePrompt(userPrompt, schema),
    });

    if (!result) {
      return null;
    }

    return result.sections.map((s) => ({
      title: s.title,
      description: s.description ?? null,
    }));
  } else {
    return args.template.sections;
  }
}

function createTemplatePrompt(
  userPrompt: string,
  schema: z.ZodObject<any>,
): string {
  return `Analyze this meeting content and suggest appropriate section headings for a comprehensive summary.
  The sections should cover the main themes and topics discussed.
  Generate around 5-7 sections based on the content depth.
  Avoid generic catch-all headings like "Overview", "Meeting Overview", "Introduction", "Summary", or "Participants".
  Prefer concrete, topic-specific section titles tied to the actual discussion.
  Do not create a standalone participants section unless the meeting materially focused on stakeholder roles, ownership, or org structure.
  Give me in bullet points.

  Content:
  ---
  ${userPrompt}
  ---

  Follow this JSON schema for your response. No additional properties.
  ---
  ${JSON.stringify(z.toJSONSchema(schema))}
  ---

  IMPORTANT: Start with '{', NO \`\`\`json. (I will directly parse it with JSON.parse())`;
}

async function generateStructuredOutput<T extends z.ZodTypeAny>(params: {
  model: LanguageModel;
  schema: T;
  signal: AbortSignal;
  prompt: string;
}): Promise<z.infer<T> | null> {
  const { model, schema, signal, prompt } = params;

  try {
    const result = await generateText({
      model,
      temperature: 0,
      output: Output.object({ schema }),
      abortSignal: signal,
      prompt,
    });

    if (!result.output) {
      return null;
    }

    return result.output as z.infer<T>;
  } catch (error) {
    try {
      const fallbackResult = await generateText({
        model,
        temperature: 0,
        abortSignal: signal,
        prompt,
      });

      const jsonMatch = fallbackResult.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return schema.parse(parsed);
    } catch {
      return null;
    }
  }
}

async function* generateSummary(params: {
  model: LanguageModel;
  args: TaskArgsMapTransformed["enhance"];
  system: string;
  prompt: string;
  onProgress: (step: any) => void;
  signal: AbortSignal;
}) {
  const { model, args, system, prompt, onProgress, signal } = params;

  onProgress({ type: "generating" });

  const validator = createEnhanceValidator(args.template);

  yield* withEarlyValidationRetry(
    (retrySignal, { previousFeedback }) => {
      let enhancedPrompt = prompt;

      if (previousFeedback) {
        enhancedPrompt = `${prompt}

IMPORTANT: Previous attempt failed. ${previousFeedback}`;
      }

      const combinedController = new AbortController();

      const abortFromOuter = () => combinedController.abort();
      const abortFromRetry = () => combinedController.abort();

      signal.addEventListener("abort", abortFromOuter);
      retrySignal.addEventListener("abort", abortFromRetry);

      try {
        const result = streamText({
          model,
          system,
          prompt: enhancedPrompt,
          abortSignal: combinedController.signal,
        });
        return result.fullStream;
      } finally {
        signal.removeEventListener("abort", abortFromOuter);
        retrySignal.removeEventListener("abort", abortFromRetry);
      }
    },
    validator,
    {
      minChar: 10,
      maxChar: 30,
      maxRetries: 2,
      onRetry: (attempt, feedback) => {
        onProgress({ type: "retrying", attempt, reason: feedback });
      },
      onRetrySuccess: () => {
        onProgress({ type: "generating" });
      },
      onGiveUp: () => {
        onProgress({ type: "generating" });
      },
    },
  );
}
