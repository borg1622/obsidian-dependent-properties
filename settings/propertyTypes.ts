import { App } from "obsidian";
import { getMetadataTypeManager } from "./obsidianInternals";
import { isTypesJson } from "./typeGuards";

type PropertyTypeName = string;

export async function getVaultPropertyNames(app: App): Promise<string[]> {
  const names = new Set<string>();

  try {
    const typesPath = `${app.vault.configDir}/types.json`;
    if (await app.vault.adapter.exists(typesPath)) {
      const raw = await app.vault.adapter.read(typesPath);
      const parsed: unknown = JSON.parse(raw);
      if (isTypesJson(parsed)) {
        for (const key of Object.keys(parsed.types ?? {})) {
          names.add(key);
        }
      }
    }
  } catch (error) {
    console.warn("Dependent Properties: could not read types.json", error);
  }

  try {
    const manager = getMetadataTypeManager(app);
    const getAllProperties = manager?.getAllProperties;
    if (getAllProperties) {
      for (const key of Object.keys(getAllProperties())) {
        names.add(key);
      }
    }
  } catch {
    // metadataTypeManager unavailable
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

export async function registerPropertyType(
  app: App,
  name: string,
  type: PropertyTypeName = "text"
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  const known = await getVaultPropertyNames(app);
  if (known.includes(trimmed)) return;

  try {
    const manager = getMetadataTypeManager(app);
    const setType = manager?.setType;
    if (setType) {
      setType(trimmed, type);
      return;
    }
  } catch (error) {
    console.warn("Dependent Properties: metadataTypeManager.setType failed", error);
  }

  const typesPath = `${app.vault.configDir}/types.json`;
  let data: { types: Record<string, string> } = { types: {} };

  try {
    if (await app.vault.adapter.exists(typesPath)) {
      const parsed: unknown = JSON.parse(await app.vault.adapter.read(typesPath));
      if (isTypesJson(parsed)) {
        data = { types: parsed.types ?? {} };
      }
    }
  } catch {
    data = { types: {} };
  }

  if (data.types[trimmed]) return;

  data.types[trimmed] = type;
  await app.vault.adapter.write(typesPath, JSON.stringify(data, null, 2));
}
