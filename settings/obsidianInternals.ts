import type { App, MetadataCache, TFile } from "obsidian";

export interface BacklinksResult {
  data: Record<string, unknown>;
}

interface MetadataCacheWithBacklinks extends MetadataCache {
  getBacklinksForFile?: (target: TFile) => { data?: Record<string, unknown> };
}

interface MetadataTypeManager {
  getAllProperties?: () => Record<string, unknown>;
  setType?: (property: string, propertyType: string) => void;
}

interface AppWithMetadataTypeManager extends App {
  metadataTypeManager?: MetadataTypeManager;
}

export function getBacklinksForFile(cache: MetadataCache, file: TFile): BacklinksResult {
  const extended = cache as MetadataCacheWithBacklinks;
  const result = extended.getBacklinksForFile?.(file);
  return { data: result?.data ?? {} };
}

export function getMetadataTypeManager(app: App): MetadataTypeManager | undefined {
  return (app as AppWithMetadataTypeManager).metadataTypeManager;
}
