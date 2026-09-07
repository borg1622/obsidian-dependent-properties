# Dependent Properties

Automatically copy properties from a linked source note into dependent notes in Obsidian.

Useful when one note references another (for example via a wikilink or markdown link in a property) and should **inherit** selected frontmatter values from that source — without maintaining duplicate data by hand.

## What it does

You define **source notes** that hold the canonical values for certain [properties](https://obsidian.md/help/properties). **Dependent notes** point to a source through a [property which contains a link](https://obsidian.md/help/properties#Text). The plugin copies the properties you configure from the linked source note into the dependent note, so for example Bases, queries, maps, and other views can use the data where you need it.

The linked note remains the **source of truth**. Changes on either side trigger an update:

- **Forward sync** — you set or change the link on a dependent note → properties are pulled from the target.
- **Reverse sync** — you change a source property on the linked note → all dependent notes that link to it are updated via backlinks.

### Example

A common setup with the official [Maps](https://obsidian.md/help/bases/views/map) plugin: each place lives in its own note under `Locations/`, with `coordinates` property in frontmatter. A [Base](https://obsidian.md/help/bases) in that folder shows every place on one map.

Event notes under `Events/` may link to the matching location note via a property (for example `venue`) instead of duplicating address and coordinates. **Dependent Properties** reads that link, copies the configured properties from the location note, and keeps dependent event notes in sync when the source changes.

#### Rule for this example

| Field | Value |
|-------|-------|
| Root folder | `Events` |
| Link property | `venue` |
| Attributes to copy | `coordinates` |

#### target file (event note)
**Dependent note `Events/Public Festival.md`:**

```yaml
---
venue: "[[Berlin Mitte]]"
coordinates:   # filled in automatically from source note
---
```

#### source file (location node)

**Source note `Locations/Berlin Mitte.md` (location):**

```yaml
---
coordinates: ["52.5200", "13.4050"]
---
```

## Features

- Configurable sync rules (root folder, link property, properties to copy)
- Property name suggestions from your vault's `types.json`
- Forward and reverse sync with debouncing
- Manual sync via command palette
- Works with wikilinks and markdown links in properties


## Usage

### Automatic sync

Once enabled, the plugin watches your vault according to the rules in **Settings → Dependent Properties**.

Typical workflow:

1. Create or open a note under the configured folder (e.g. `Events/`).
2. Set the internal link in a [property](https://obsidian.md/help/properties#Text) (e.g. `venue`) to point at a source note (e.g. `Locations/Berlin Mitte.md`).
3. Mapped properties (e.g. `coordinates`) are copied from the source note into the new note automatically.

When you update coordinates on the source note, all linked notes receive the new values.

### Commands

| Command | Description |
|---------|-------------|
| **Sync current file** | Sync the active markdown file in the editor (click into the note first). |
| **Sync all matching files** | Run all enabled rules on every note under the configured root folders. Asks for confirmation before scanning. |

Open the command palette (default shortcut `Ctrl/Cmd + P`) to run these commands.

## Configuration

Open **Settings → Dependent Properties**.

| Setting | Description |
|---------|-------------|
| **Debounce in ms** | Delay after file changes before syncing (default: `750`). |
| **Debug** | Log skip and sync events to the developer console. |
| **Rules** | One or more sync rules (see below). |

### Sync rule fields

| Field | Description |
|-------|-------------|
| **Enabled** | Enable or disable the rule. |
| **Name** | Label for your own reference. |
| **Root folder** | Only notes under this path are synced (e.g. `Events`). Folder suggestions appear while typing. |
| **Link property** | Property on the dependent note that contains the wikilink or markdown link to the source. Suggestions come from your vault property types. |
| **Attributes to copy** | One or more properties to copy from the source note (same property name on both notes). Add multiple entries in the rule editor. New property names can be registered in `types.json`. |

Fresh installs start with no rules configured. Debug logging is off by default.

## Permissions and privacy

- **Automatic sync** reacts to metadata changes on individual notes only. It does not scan your vault on startup or in the background.
- **Sync all matching files** (command palette) scans markdown files to apply inheritance in bulk. Rules with a root folder only walk that folder tree; rules with an empty root folder scan the entire vault. A confirmation dialog appears before the scan starts.
- **Folder suggestions** in the rule editor use `getAllFolders()` only while you edit a rule in settings.
- **Reverse sync** uses backlink metadata and direct file lookups — not a full vault enumeration.
- The plugin does not access the network or send vault data outside Obsidian.

## Requirements

- Obsidian 1.13.0 or newer
- Desktop and mobile

## Mobile support

`isDesktopOnly` is set to `false` in `manifest.json`. Reverse sync uses `MetadataCache.getBacklinksForFile` when available; on older builds without that API, forward sync still works and reverse sync is skipped gracefully.


## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # Obsidian community scanner rules
```

Build artifacts and dev files follow Obsidian community scanner ignore patterns (`esbuild.config.mjs`, `node_modules/`, `*.test.*`, etc.).


## License

MIT — see [LICENSE](LICENSE).

## Author

[borg1622 (Dirk Osburg)](https://github.com/borg1622)
