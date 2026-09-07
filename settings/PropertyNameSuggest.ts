import { AbstractInputSuggest, App } from "obsidian";
import { getVaultPropertyNames } from "./propertyTypes";

export class PropertyNameSuggest extends AbstractInputSuggest<string> {
  private justChose = false;

  constructor(app: App, protected readonly inputEl: HTMLInputElement) {
    super(app, inputEl);
  }

  async getSuggestions(query: string): Promise<string[]> {
    if (this.justChose) return [];

    const names = await getVaultPropertyNames(this.app);
    const lower = query.toLowerCase();
    const filtered = names.filter((name) => name.toLowerCase().includes(lower));
    const trimmed = query.trim();

    if (trimmed && !filtered.includes(trimmed)) {
      filtered.push(trimmed);
    }

    return filtered.slice(0, 1000);
  }

  renderSuggestion(name: string, el: HTMLElement): void {
    el.setText(name);
  }

  selectSuggestion(name: string, _evt: MouseEvent | KeyboardEvent): void {
    this.justChose = true;
    this.setValue(name);
    this.inputEl.trigger("input");
    this.close();
    window.setTimeout(() => (this.justChose = false), 0);
  }
}
