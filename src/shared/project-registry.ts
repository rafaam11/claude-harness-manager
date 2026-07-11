export const PROJECT_REGISTRY_SCHEMA_VERSION = 1 as const;

export type ProjectSource = "manual" | "claude" | "codex";
export type ProjectStatus = "진행중" | "보류" | "완료" | "보관";

export interface SharedProjectTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface SharedProjectTrack {
  id: string;
  title: string;
  items: SharedProjectTodo[];
}

export interface SharedProject {
  id: string;
  rootPath: string;
  displayName: string | null;
  sources: ProjectSource[];
  providerRefs: {
    claude: string[];
    codex: string[];
  };
  status: ProjectStatus | null;
  memo: string;
  tracks: SharedProjectTrack[];
  hidden: boolean;
  order: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRegistryV1 {
  schemaVersion: typeof PROJECT_REGISTRY_SCHEMA_VERSION;
  updatedAt: string;
  migratedFromBoardAt?: string;
  projects: Record<string, SharedProject>;
}
