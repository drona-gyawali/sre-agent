import { createProviderRegistry } from "ai";
import { google } from "@ai-sdk/google";


const registry = createProviderRegistry({
    google,
});

export type RegistryModelId = Parameters<typeof registry.languageModel>[0];

export function getModel(modelString: RegistryModelId) {
  return registry.languageModel(modelString);
}