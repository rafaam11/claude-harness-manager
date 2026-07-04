import type { NormalizedConfigFile } from "@shared/provider-types";
import { validateConfig } from "./json-validate.js";
import { validateTomlConfig } from "./toml-validate.js";

type ValidationDescriptor = Pick<NormalizedConfigFile, "id" | "format">;

export function validateConfigContent(desc: ValidationDescriptor, content: string): void {
  if (desc.format === "json") {
    validateConfig(desc.id, content);
    return;
  }
  if (desc.format === "toml") {
    validateTomlConfig(desc.id, content);
    return;
  }
  throw Object.assign(new Error("read-only config format"), { statusCode: 403 });
}
