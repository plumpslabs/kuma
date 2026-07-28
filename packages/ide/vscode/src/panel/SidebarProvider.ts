// ============================================================
// VS CODE KUMA — Sidebar Webview Provider
// ============================================================

import * as vscode from "vscode";
import * as path from "node:path";

export class KumaDashboardProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;

  constructor(context: vscode.ExtensionContext) {
    this._extensionUri = context.extensionUri;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "src", "panel", "media"),
      ],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
          await this._sendDashboardData(webviewView);
          break;
        case "refresh":
          await this._sendDashboardData(webviewView);
          break;
        case "error":
          console.error("[Kuma] Webview error:", message.payload);
          break;
      }
    });
  }

  public refresh() {
    if (this._view) {
      this._sendDashboardData(this._view);
    }
  }

  private async _sendDashboardData(webviewView: vscode.WebviewView) {
    try {
      // Dynamically import core library from the workspace
      const core = await this._loadCore();
      if (!core) {
        webviewView.webview.postMessage({
          type: "error",
          payload: "Kuma DB not found. Run Kuma in this workspace first.",
        });
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        webviewView.webview.postMessage({
          type: "error",
          payload: "No workspace folder open.",
        });
        return;
      }

      const projectRoot = workspaceFolders[0].uri.fsPath;
      const { openDb, loadDashboard, getDbStats, getStatusReport } = core;

      const { db } = await openDb(projectRoot);

      try {
        const dashboard = loadDashboard(db);
        const stats = await getDbStats(projectRoot);
        const report = getStatusReport(db);

        webviewView.webview.postMessage({
          type: "dashboard",
          payload: {
            dashboard,
            stats,
            report,
            hasDb: true,
          },
        });
      } finally {
        db.close();
      }
    } catch (err: any) {
      webviewView.webview.postMessage({
        type: "error",
        payload: `Failed to load Kuma data: ${err.message}`,
      });
    }
  }

  private async _loadCore(): Promise<any> {
    try {
      // Try workspace import (pnpm workspace)
      return await import("@kuma/ide-core");
    } catch {
      try {
        // Fallback: try direct path
        return await import(
          path.join(this._extensionUri.fsPath, "..", "..", "core", "dist", "index.js")
        );
      } catch {
        return null;
      }
    }
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const mediaUri = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "panel",
      "media"
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, "style.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, "app.js")
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  } 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Kuma Dashboard</title>
</head>
<body>
  <div id="app">
    <header>
      <h1>🦊 Kuma</h1>
      <span class="version">IDE</span>
    </header>
    <div id="loading">
      <div class="spinner"></div>
      <p>Loading Kuma data...</p>
    </div>
    <div id="content" class="hidden">
      <div id="status-bar">
        <span id="health-badge"></span>
        <span id="node-count"></span>
        <span id="edge-count"></span>
        <button id="refresh-btn" title="Refresh">↻</button>
      </div>
      <div id="tabs">
        <button class="tab active" data-tab="graph">Graph</button>
        <button class="tab" data-tab="gotchas">Gotchas</button>
        <button class="tab" data-tab="trajectories">Trajectories</button>
        <button class="tab" data-tab="status">Status</button>
      </div>
      <div id="tab-content">
        <div class="tab-panel active" id="panel-graph">
          <div id="graph-placeholder">Waiting for data...</div>
          <pre id="mermaid-code" class="hidden"></pre>
        </div>
        <div class="tab-panel hidden" id="panel-gotchas">
          <div id="gotchas-list"></div>
        </div>
        <div class="tab-panel hidden" id="panel-trajectories">
          <div id="trajectories-list"></div>
        </div>
        <div class="tab-panel hidden" id="panel-status">
          <pre id="status-report"></pre>
        </div>
      </div>
    </div>
    <div id="error" class="hidden">
      <p class="error-icon">⚠️</p>
      <p id="error-message"></p>
      <button id="retry-btn">Retry</button>
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
