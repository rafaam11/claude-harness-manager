import { updateProjectRegistry, type SharedProject } from "../project-registry.js";

interface WriterPayload {
  filePath: string;
  delayMs: number;
  project: SharedProject;
}

const payload = JSON.parse(process.env.PROJECT_REGISTRY_WRITER_PAYLOAD ?? "null") as WriterPayload | null;
if (!payload) throw new Error("PROJECT_REGISTRY_WRITER_PAYLOAD is required");

await updateProjectRegistry(
  async (registry) => {
    process.stdout.write("locked\n");
    if (payload.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, payload.delayMs));
    }
    registry.projects[payload.project.id] = payload.project;
  },
  { filePath: payload.filePath },
);
