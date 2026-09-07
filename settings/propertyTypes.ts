import { App } from "obsidian";

type PropertyTypeName = string;

interface TypesJson {
  types?: Record<string, PropertyTypeName>;
}

export async function getVaultPropertyNames(app: App): Promise<string[]> {
  const names = new Set<string>();

  try {
    const typesPath = `${app.vault.configDir}/types.json`;
    if (await app.vault.adapter.exists(typesPath)) {
      const raw = await app.vault.adapter.read(typesPath);
      const data = JSON.parse(raw) as TypesJson;
      for (const key of Object.keys(data.types ?? {})) {
        names.add(key);
      }
    }
  } catch (error) {
    console.warn("Dependent Properties: could not read types.json", error);
  }

  try {
    // @ts-expect-error unofficial Obsidian API
    const manager = app.metadataTypeManager as {
      getAllProperties?: () => Record<string, unknown>;
    } | undefined;
    if (manager?.getAllProperties) {
      for (const key of Object.keys(manager.getAllProperties())) {
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
    // @ts-expect-error unofficial Obsidian API
    const manager = app.metadataTypeManager as {
      setType?: (property: string, propertyType: string) => void;
    } | undefined;
    if (manager?.setType) {
      manager.setType(trimmed, type);
      return;
    }
  } catch (error) {
    console.warn("Dependent Properties: metadataTypeManager.setType failed", error);
  }

  const typesPath = `${app.vault.configDir}/types.json`;
  let data: TypesJson = { types: {} };

  try {
    if (await app.vault.adapter.exists(typesPath)) {
      data = JSON.parse(await app.vault.adapter.read(typesPath)) as TypesJson;
    }
  } catch {
    data = { types: {} };
  }

  data.types = data.types ?? {};
  if (data.types[trimmed]) return;

  data.types[trimmed] = type;
  await app.vault.adapter.write(typesPath, JSON.stringify(data, null, 2));
}
