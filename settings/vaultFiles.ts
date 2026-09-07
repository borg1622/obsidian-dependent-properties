import { TFile, TFolder, Vault, normalizePath } from "obsidian";

function collectMarkdownFiles(folder: TFolder, results: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      results.push(child);
    } else if (child instanceof TFolder) {
      collectMarkdownFiles(child, results);
    }
  }
}

export function getMarkdownFilesForRule(vault: Vault, watchedRoot: string): TFile[] {
  const root = normalizePath(watchedRoot.trim());
  if (!root) {
    return vault.getMarkdownFiles();
  }

  const folder = vault.getFolderByPath(root);
  if (!folder) return [];

  const results: TFile[] = [];
  collectMarkdownFiles(folder, results);
  return results;
}
