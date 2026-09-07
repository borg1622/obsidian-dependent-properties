import { App, Modal, Setting } from "obsidian";
import { FolderSuggest } from "./FolderSuggest";
import { PropertyNameSuggest } from "./PropertyNameSuggest";
import { registerPropertyType } from "./propertyTypes";
import type { SyncRule } from "./types";

export class RuleEditModal extends Modal {
  private rule: SyncRule;
  private linkPropertySetting!: Setting;
  private attributesContainer!: HTMLElement;
  private attributeValues: string[] = [];

  constructor(
    app: App,
    initialValues: SyncRule,
    private onSubmit: (rule: SyncRule) => Promise<void>
  ) {
    super(app);
    this.rule = { ...initialValues, attributesToCopy: [...initialValues.attributesToCopy] };
  }

  onOpen() {
    this.setTitle("Rule");
    const { contentEl } = this;

    new Setting(contentEl)
      .setName("Enabled")
      .addToggle((toggle) => {
        toggle.setValue(this.rule.enabled).onChange((value) => {
          this.rule.enabled = value;
        });
      });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) => {
        text
          .setPlaceholder("e.g. Venue coordinates")
          .setValue(this.rule.name)
          .onChange((value) => {
            this.rule.name = value;
          });
      });

    new Setting(contentEl)
      .setName("Root folder")
      .setDesc("Optional. Leave empty to watch the entire vault.")
      .addText((text) => {
        new FolderSuggest(this.app, text.inputEl);
        text
          .setPlaceholder("30 Resources/Events")
          .setValue(this.rule.watchedRoot)
          .onChange((value) => {
            this.rule.watchedRoot = value;
          });
      });

    this.linkPropertySetting = new Setting(contentEl)
      .setName("Link property")
      .setDesc(
        "Frontmatter property containing a wikilink or markdown link to the source note."
      )
      .addText((text) => {
        new PropertyNameSuggest(this.app, text.inputEl);
        text
          .setPlaceholder("venue")
          .setValue(this.rule.linkProperty)
          .onChange((value) => {
            this.rule.linkProperty = value;
          });
      });

    new Setting(contentEl)
      .setName("Attributes to copy")
      .setDesc("Properties to copy from the linked source note (same name on both notes).");

    this.attributeValues = this.rule.attributesToCopy.length > 0
      ? [...this.rule.attributesToCopy]
      : [""];
    this.attributesContainer = contentEl.createDiv({ cls: "dependent-properties-attribute-list" });
    this.renderAttributeRows();

    new Setting(contentEl).addButton((button) =>
      button.setButtonText("Add attribute").onClick(() => {
        this.attributeValues.push("");
        this.renderAttributeRows();
      })
    );

    new Setting(contentEl)
      .addButton((button) =>
        button
          .setButtonText("Done")
          .setCta()
          .onClick(async () => {
            if (!this.rule.linkProperty.trim()) {
              this.linkPropertySetting.setErrorMessage(
                "Link property cannot be empty"
              );
              return;
            }

            const attributesToCopy = [
              ...new Set(
                this.attributeValues.map((value) => value.trim()).filter(Boolean)
              )
            ];

            await registerPropertyType(this.app, this.rule.linkProperty.trim());
            for (const property of attributesToCopy) {
              await registerPropertyType(this.app, property);
            }

            const rule: SyncRule = {
              ...this.rule,
              id: this.rule.id || crypto.randomUUID(),
              attributesToCopy
            };
            await this.onSubmit(rule);
            this.close();
          })
      )
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  private renderAttributeRows() {
    this.attributesContainer.empty();

    this.attributeValues.forEach((value, index) => {
      new Setting(this.attributesContainer)
        .addText((text) => {
          new PropertyNameSuggest(this.app, text.inputEl);
          text
            .setPlaceholder("coordinates")
            .setValue(value)
            .onChange((newValue) => {
              this.attributeValues[index] = newValue;
            });
        })
        .addButton((button) =>
          button
            .setIcon("trash")
            .setTooltip("Remove attribute")
            .onClick(() => {
              this.attributeValues.splice(index, 1);
              if (this.attributeValues.length === 0) {
                this.attributeValues.push("");
              }
              this.renderAttributeRows();
            })
        );
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
