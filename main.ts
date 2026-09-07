import {
  App,
  MarkdownView,
  MetadataCache,
  Notice,
  Plugin,
  PluginSettingTab,
  SettingDefinitionItem,
  SettingDefinitionList,
  TFile,
  normalizePath
} from "obsidian";
import { RuleEditModal } from "./settings/RuleEditModal";
import type { LegacySyncRule, SyncRule } from "./settings/types";

interface PluginSettings {
  rules: SyncRule[];
  debounceMs: number;
  debug: boolean;
}

interface PendingFileChange {
  file: TFile;
  previousFrontmatter: Record<string, unknown> | null;
}

const DEFAULT_SETTINGS: PluginSettings = {
  debounceMs: 750,
  debug: false,
  rules: []
};

export default class DependentPropertiesPlugin extends Plugin {
  settings!: PluginSettings;
  private debounceTimers = new Map<string, number>();
  private pendingChanges = new Map<string, PendingFileChange>();
  private frontmatterSnapshots = new Map<string, Record<string, unknown> | null>();
  private syncingFiles = new Set<string>();

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new DependentPropertiesSettingTab(this.app, this));

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!(file instanceof TFile)) return;
        if (file.extension !== "md") return;
        this.onMetadataChanged(file);
      })
    );

    this.addCommand({
      id: "sync-current-file",
      name: "Sync current file",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) return false;
        if (checking) return true;
        void this.syncCurrentFile(file);
        return true;
      }
    });

    this.addCommand({
      id: "sync-all-files",
      name: "Sync all matching files",
      callback: () => {
        void this.syncAllMatchingFiles();
      }
    });
  }

  onunload() {
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.frontmatterSnapshots.clear();
  }

  private onMetadataChanged(file: TFile) {
    if (this.syncingFiles.has(file.path)) return;

    const previousFrontmatter = this.frontmatterSnapshots.get(file.path) ?? null;
    const currentFrontmatter = this.getFrontmatterSnapshot(file);

    this.frontmatterSnapshots.set(
      file.path,
      currentFrontmatter ? cloneValue(currentFrontmatter) : null
    );

    this.pendingChanges.set(file.path, {
      file,
      previousFrontmatter: previousFrontmatter
        ? cloneValue(previousFrontmatter)
        : null
    });

    this.scheduleFileHandling(file);
  }

  private scheduleFileHandling(file: TFile) {
    const oldTimer = this.debounceTimers.get(file.path);
    if (oldTimer) window.clearTimeout(oldTimer);

    const delay = this.settings.debounceMs ?? 750;
    const timer = window.setTimeout(() => {
      this.debounceTimers.delete(file.path);
      void this.handleFileChanged(file);
    }, delay);

    this.debounceTimers.set(file.path, timer);
  }

  private async handleFileChanged(file: TFile) {
    if (this.syncingFiles.has(file.path)) return;

    const pending = this.pendingChanges.get(file.path);
    this.pendingChanges.delete(file.path);

    const previousFrontmatter = pending?.previousFrontmatter ?? null;
    const currentFrontmatter = this.getFrontmatterSnapshot(file);

    if (this.shouldRunForwardSync(file)) {
      await this.syncFile(file);
    }

    if (this.shouldRunReverseSync(file, previousFrontmatter, currentFrontmatter)) {
      await this.syncDependents(file);
    }
  }

  private shouldRunForwardSync(file: TFile): boolean {
    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;
      if (!this.isFileInWatchedRoot(file, rule.watchedRoot)) continue;
      return true;
    }
    return false;
  }

  private shouldRunReverseSync(
    file: TFile,
    previousFrontmatter: Record<string, unknown> | null,
    currentFrontmatter: Record<string, unknown> | null
  ): boolean {
    if (!currentFrontmatter) return false;

    if (!this.hasAnySourceAttribute(currentFrontmatter)) {
      this.debugLog(`Reverse skip (no source attribute): ${file.path}`);
      return false;
    }

    if (!previousFrontmatter) {
      this.debugLog(`Reverse skip (no snapshot): ${file.path}`);
      return false;
    }

    if (!this.haveSourceAttributesChanged(previousFrontmatter, currentFrontmatter)) {
      this.debugLog(`Reverse skip (source attribute unchanged): ${file.path}`);
      return false;
    }

    return true;
  }

  private hasAnySourceAttribute(frontmatter: Record<string, unknown>): boolean {
    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;
      for (const property of rule.attributesToCopy) {
        const value = getByPath(frontmatter, property);
        if (hasDefinedValue(value)) return true;
      }
    }
    return false;
  }

  private haveSourceAttributesChanged(
    previous: Record<string, unknown>,
    current: Record<string, unknown>
  ): boolean {
    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;
      for (const property of rule.attributesToCopy) {
        const prevValue = getByPath(previous, property);
        const currValue = getByPath(current, property);
        if (!deepEqual(prevValue, currValue)) return true;
      }
    }
    return false;
  }

  private async syncDependents(sourceFile: TFile): Promise<void> {
    const backlinks = getBacklinksForFile(this.app.metadataCache, sourceFile);
    const dependentPaths = new Set<string>();

    for (const linkPath of Object.keys(backlinks.data)) {
      dependentPaths.add(linkPath);
    }

    for (const dependentPath of dependentPaths) {
      const dependentFile = this.app.vault.getAbstractFileByPath(dependentPath);
      if (!(dependentFile instanceof TFile)) continue;
      if (dependentFile.extension !== "md") continue;
      if (!this.isDependentOfSource(dependentFile, sourceFile)) continue;

      await this.syncFile(dependentFile);
    }
  }

  private isDependentOfSource(dependentFile: TFile, sourceFile: TFile): boolean {
    const frontmatter = this.app.metadataCache.getFileCache(dependentFile)?.frontmatter;
    if (!frontmatter) return false;

    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;
      if (!rule.linkProperty.trim()) continue;
      if (!this.isFileInWatchedRoot(dependentFile, rule.watchedRoot)) continue;

      const linkedFile = this.resolveLinkedFile(dependentFile, frontmatter, rule.linkProperty.trim());
      if (linkedFile?.path === sourceFile.path) return true;
    }

    return false;
  }

  private resolveLinkedFile(
    dependentFile: TFile,
    frontmatter: Record<string, unknown>,
    linkProperty: string
  ): TFile | null {
    const linkValue = getByPath(frontmatter, linkProperty);
    const linkTarget = extractLinkTarget(linkValue);
    if (!linkTarget) return null;

    const linked = this.app.metadataCache.getFirstLinkpathDest(linkTarget, dependentFile.path);
    return linked instanceof TFile ? linked : null;
  }

  private async syncCurrentFile(file: TFile) {
    const changed = await this.syncFile(file);
    new Notice(changed ? "Properties inherited." : "Nothing to inherit.");
  }

  private async syncAllMatchingFiles() {
    let changedCount = 0;
    const seen = new Set<string>();

    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;

      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!this.isFileInWatchedRoot(file, rule.watchedRoot)) continue;
        if (seen.has(file.path)) continue;
        seen.add(file.path);

        const changed = await this.syncFile(file);
        if (changed) changedCount++;
      }
    }

    new Notice(`Synced ${changedCount} file(s).`);
  }

  async syncFile(file: TFile): Promise<boolean> {
    if (this.syncingFiles.has(file.path)) return false;

    const currentCache = this.app.metadataCache.getFileCache(file);
    const currentFrontmatter = currentCache?.frontmatter;
    if (!currentFrontmatter) return false;

    const updates: Record<string, unknown> = {};
    let skippedNoLink = false;

    for (const rule of this.settings.rules) {
      if (!rule.enabled) continue;
      if (!rule.linkProperty.trim()) continue;
      if (!this.isFileInWatchedRoot(file, rule.watchedRoot)) continue;

      const linkValue = getByPath(currentFrontmatter, rule.linkProperty.trim());
      const linkTarget = extractLinkTarget(linkValue);

      if (!linkTarget) {
        skippedNoLink = true;
        this.debugLog(`Skip without link (${rule.linkProperty}): ${file.path}`);
        continue;
      }

      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(linkTarget, file.path);
      if (!linkedFile) {
        this.debugLog(`Link target not found (${linkTarget}): ${file.path}`);
        continue;
      }

      const linkedFrontmatter = this.app.metadataCache.getFileCache(linkedFile)?.frontmatter;
      if (!linkedFrontmatter) continue;

      for (const property of rule.attributesToCopy) {
        const sourceValue = getByPath(linkedFrontmatter, property);
        if (sourceValue === undefined) continue;

        const currentValue = getByPath(currentFrontmatter, property);
        if (!deepEqual(currentValue, sourceValue)) {
          updates[property] = cloneValue(sourceValue);
        }
      }
    }

    const updateKeys = Object.keys(updates);
    if (updateKeys.length === 0) {
      if (skippedNoLink) return false;
      return false;
    }

    this.syncingFiles.add(file.path);

    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        for (const key of updateKeys) {
          setByPath(frontmatter, key, updates[key]);
        }
      });

      const updatedFm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      this.frontmatterSnapshots.set(
        file.path,
        updatedFm ? cloneValue(updatedFm) : null
      );

      this.debugLog(`Synced: ${file.path} (${updateKeys.join(", ")})`);
      return true;
    } catch (error) {
      console.error("Dependent Properties failed:", error);
      new Notice(`Property inheritance failed: ${file.path}`);
      return false;
    } finally {
      window.setTimeout(() => {
        this.syncingFiles.delete(file.path);
      }, 1000);
    }
  }

  private getFrontmatterSnapshot(file: TFile): Record<string, unknown> | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || typeof fm !== "object") return null;
    return fm as Record<string, unknown>;
  }

  isFileInWatchedRoot(file: TFile, watchedRoot: string): boolean {
    const root = normalizePath(watchedRoot.trim());
    if (!root) return true;

    const filePath = normalizePath(file.path);
    const prefix = root.endsWith("/") ? root : `${root}/`;
    return filePath === root || filePath.startsWith(prefix);
  }

  private debugLog(message: string) {
    if (this.settings.debug) {
      console.log(`[Dependent Properties] ${message}`);
    }
  }

  async loadSettings() {
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
    const rawRules = Array.isArray(loaded?.rules) ? loaded.rules : [];
    const rules = rawRules.map((rule) => migrateRule(rule as LegacySyncRule));
    const needsMigration = rawRules.some((rule) =>
      isLegacyRule(rule as LegacySyncRule)
    );

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      rules
    };

    if (typeof this.settings.debounceMs !== "number" || this.settings.debounceMs < 0) {
      this.settings.debounceMs = DEFAULT_SETTINGS.debounceMs;
    }

    if (typeof this.settings.debug !== "boolean") {
      this.settings.debug = DEFAULT_SETTINGS.debug;
    }

    if (needsMigration) {
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class DependentPropertiesSettingTab extends PluginSettingTab {
  plugin: DependentPropertiesPlugin;

  constructor(app: App, plugin: DependentPropertiesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getControlValue(key: string): unknown {
    if (key === "debounceMs") return this.plugin.settings.debounceMs;
    if (key === "debug") return this.plugin.settings.debug;
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "debounceMs") {
      const parsed = Number(value);
      if (Number.isNaN(parsed) || parsed < 0 || !Number.isInteger(parsed)) return;
      this.plugin.settings.debounceMs = parsed;
    } else if (key === "debug") {
      this.plugin.settings.debug = Boolean(value);
    }
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Debounce in ms",
        desc: "Delay after file changes before syncing.",
        control: {
          type: "number",
          key: "debounceMs",
          placeholder: "750",
          min: 0,
          step: 1
        }
      },
      {
        name: "Debug",
        desc: "Log skip and sync events to the developer console.",
        control: { type: "toggle", key: "debug" }
      },
      this.rulesGroup()
    ];
  }

  private rulesGroup(): SettingDefinitionList {
    const openModal = (
      initialValues: SyncRule,
      onSubmit: (rule: SyncRule) => Promise<void>
    ) => {
      new RuleEditModal(this.app, initialValues, onSubmit).open();
    };

    return {
      type: "list",
      heading: "Rules",
      emptyState: "No rules added.",
      addItem: {
        name: "Add rule",
        action: () => {
          openModal(
            {
              id: "",
              enabled: true,
              name: "",
              watchedRoot: "",
              linkProperty: "",
              attributesToCopy: []
            },
            async (rule) => {
              this.plugin.settings.rules.push(rule);
              await this.plugin.saveSettings();
              this.update();
            }
          );
        }
      },
      onDelete: (index) => {
        this.plugin.settings.rules.splice(index, 1);
        void this.plugin.saveSettings().then(() => this.update());
      },
      onReorder: (oldIndex, newIndex) => {
        arraymove(this.plugin.settings.rules, oldIndex, newIndex);
        void this.plugin.saveSettings().then(() => this.update());
      },
      items: this.plugin.settings.rules.map((rule, index) => ({
        name: rule.name || "Untitled",
        desc: formatRuleSummary(rule),
        action: () => {
          openModal({ ...rule }, async (updated) => {
            this.plugin.settings.rules[index] = updated;
            await this.plugin.saveSettings();
            this.update();
          });
        }
      }))
    };
  }
}

function formatRuleSummary(rule: SyncRule): string {
  const folder = rule.watchedRoot.trim() || "Entire vault";
  const link = rule.linkProperty.trim() || "—";
  const attributePart =
    rule.attributesToCopy.length > 0 ? rule.attributesToCopy.join(", ") : "—";
  return `${folder} → ${link} · ${attributePart}`;
}

function arraymove<T>(arr: T[], from: number, to: number): void {
  const item = arr.splice(from, 1)[0];
  arr.splice(to, 0, item);
}

function isLegacyRule(rule: LegacySyncRule): boolean {
  return "attributeMappings" in rule || !Array.isArray(rule.attributesToCopy);
}

function migrateRule(rule: LegacySyncRule): SyncRule {
  let attributesToCopy = Array.isArray(rule.attributesToCopy)
    ? rule.attributesToCopy.filter((name) => typeof name === "string" && name.trim())
    : [];

  if (attributesToCopy.length === 0 && rule.attributeMappings) {
    attributesToCopy = migrateAttributeMappings(rule.attributeMappings);
  }

  return {
    id: rule.id || crypto.randomUUID(),
    enabled: rule.enabled ?? true,
    name: rule.name ?? "",
    watchedRoot: rule.watchedRoot ?? "",
    linkProperty: rule.linkProperty ?? "",
    attributesToCopy
  };
}

function migrateAttributeMappings(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("->")) {
        return line.split("->")[0].trim();
      }
      if (line.includes(":")) {
        return line.split(":")[0].trim();
      }
      return line;
    })
    .filter(Boolean);
}

function extractLinkTarget(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractLinkTarget(item);
      if (extracted) return extracted;
    }
    return null;
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const wikilinkMatch = trimmed.match(/\[\[([^\]]+)\]\]/);
  if (wikilinkMatch) {
    const inner = wikilinkMatch[1];
    return inner.split("|")[0].split("#")[0].trim();
  }

  const markdownLinkMatch = trimmed.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (markdownLinkMatch) {
    return markdownLinkMatch[2].split("#")[0].trim();
  }

  return null;
}

function hasDefinedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!obj || !path) return undefined;

  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return;

  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (next == null || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = cloneValue(value) as unknown;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

interface BacklinksResult {
  data: Record<string, unknown>;
}

/** Obsidian runtime API; not yet in bundled obsidian type definitions. */
function getBacklinksForFile(cache: MetadataCache, file: TFile): BacklinksResult {
  const extended = cache as MetadataCache & {
    getBacklinksForFile?: (target: TFile) => BacklinksResult;
  };
  return extended.getBacklinksForFile?.(file) ?? { data: {} };
}
