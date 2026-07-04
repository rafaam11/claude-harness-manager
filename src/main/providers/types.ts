import type {
  NormalizedConfigFile,
  NormalizedPlan,
  NormalizedProject,
  NormalizedSession,
  ProviderId,
} from "@shared/provider-types";
import type { CatalogItem } from "../services/catalog.js";
import type { McpServer } from "../services/mcp.js";

export interface ProviderRoots {
  home: string;
  configFiles: string[];
  appData?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  roots: ProviderRoots;
  listConfigFiles(): Promise<NormalizedConfigFile[]>;
  readMcpServers(): Promise<McpServer[]>;
  listCatalog(): Promise<CatalogItem[]>;
  listProjects(): Promise<NormalizedProject[]>;
  listSessions(): Promise<NormalizedSession[]>;
  listPlans(): Promise<NormalizedPlan[]>;
  detectRunning(): Promise<boolean>;
}
