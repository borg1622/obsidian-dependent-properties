import { App, ConfirmationModal } from "obsidian";

export function confirmBulkSync(
  app: App,
  onConfirm: () => void | Promise<void>
): void {
  const modal = new ConfirmationModal(app);
  modal.setTitle("Sync all matching files?");
  modal.contentEl.createEl("p", {
    text:
      "This command scans Markdown files in your vault (or within each rule's root folder) to run property inheritance. Continue?"
  });
  modal.addButton((button) =>
    button.setButtonText("Sync").setCta().onClick(() => {
      void onConfirm();
    })
  );
  modal.addCancelButton();
  modal.open();
}
