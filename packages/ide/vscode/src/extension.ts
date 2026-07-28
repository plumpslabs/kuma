// ============================================================
// VS CODE KUMA — Extension Entry Point
// ============================================================

import * as vscode from "vscode";
import { KumaDashboardProvider } from "./panel/SidebarProvider";

export function activate(context: vscode.ExtensionContext) {
  console.log("[Kuma] Activating Kuma IDE extension...");

  // Register sidebar webview provider
  const provider = new KumaDashboardProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("kuma.dashboard", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("kuma.openDashboard", () => {
      vscode.commands.executeCommand(
        "workbench.view.extension.kuma-sidebar"
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("kuma.refreshDashboard", () => {
      provider.refresh();
      vscode.window.showInformationMessage("[Kuma] Dashboard refreshed.");
    })
  );

  // Auto-refresh on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      provider.refresh();
    })
  );

  // Show notification on startup (auto-dismiss not supported by VS Code API)
  vscode.window.showInformationMessage(
    "🦊 Kuma IDE is active! Look for the Kuma icon in the activity bar."
  );
}

export function deactivate() {
  console.log("[Kuma] Deactivating Kuma IDE extension.");
}
