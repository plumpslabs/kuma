// ============================================================
// KUMA IDE — Dashboard Webview Frontend
// ============================================================

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  let state = {
    hasData: false,
    dashboard: null,
    stats: null,
  };

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const loading = $("loading");
  const content = $("content");
  const error = $("error");
  const errorMsg = $("error-message");
  const healthBadge = $("health-badge");
  const nodeCount = $("node-count");
  const edgeCount = $("edge-count");
  const mermaidCode = $("mermaid-code");
  const graphPlaceholder = $("graph-placeholder");
  const gotchasList = $("gotchas-list");
  const trajectoriesList = $("trajectories-list");
  const statusReport = $("status-report");
  const refreshBtn = $("refresh-btn");
  const retryBtn = $("retry-btn");

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      tab.classList.add("active");
      const panel = $("panel-" + tab.dataset.tab);
      if (panel) panel.classList.remove("hidden");
    });
  });

  // Refresh / retry
  refreshBtn.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  retryBtn.addEventListener("click", () => {
    hideError();
    showLoading();
    vscode.postMessage({ type: "ready" });
  });

  // Notify host that we're ready
  vscode.postMessage({ type: "ready" });

  // Handle messages from extension
  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "dashboard":
        state.dashboard = msg.payload.dashboard;
        state.stats = msg.payload.stats;
        state.hasData = true;
        renderDashboard(msg.payload);
        break;
      case "error":
        showError(msg.payload);
        break;
    }
  });

  // ============================================================
  // Render
  // ============================================================

  function renderDashboard(data) {
    hideError();
    hideLoading();
    showContent();

    const d = data.dashboard;
    const s = data.stats;

    // Health badge
    const score = d.healthScore ?? 0;
    healthBadge.textContent = score >= 70 ? "● Healthy" : score >= 40 ? "● Needs Attention" : "● Critical";
    healthBadge.className = score >= 70 ? "good" : score >= 40 ? "fair" : "poor";

    // Node/Edge counts
    nodeCount.textContent = `Nodes: ${d.nodeCount}`;
    edgeCount.textContent = `Edges: ${d.edgeCount}`;

    // Graph (mermaid code)
    if (d.graph && d.graph.mermaid) {
      graphPlaceholder.classList.add("hidden");
      mermaidCode.classList.remove("hidden");
      mermaidCode.textContent = d.graph.mermaid;
    } else {
      graphPlaceholder.classList.remove("hidden");
      graphPlaceholder.textContent = "No graph data available.";
      mermaidCode.classList.add("hidden");
    }

    // Gotchas
    renderGotchas(d.gotchas);
    renderTrajectories(d.trajectories, d.skills);

    // Status report
    statusReport.textContent = data.report || "No status report available.";
  }

  function renderGotchas(gotchas) {
    if (!gotchas || gotchas.length === 0) {
      gotchasList.innerHTML = '<div class="gotcha-empty">🎉 No gotchas recorded.</div>';
      return;
    }

    gotchasList.innerHTML = gotchas
      .map(
        (g) => `
      <div class="gotcha-item severity-${g.severity}">
        <div class="gotcha-header">
          <span class="gotcha-file">${escapeHtml(g.file_path)}</span>
          <span class="gotcha-severity gotcha-${g.severity}">${g.severity}</span>
        </div>
        <p class="gotcha-desc">${escapeHtml(g.description)}</p>
        ${
          g.workaround
            ? `<p class="gotcha-workaround">💡 ${escapeHtml(g.workaround)}</p>`
            : ""
        }
      </div>
    `
      )
      .join("");
  }

  function renderTrajectories(trajectories, skills) {
    if (!trajectories || trajectories.length === 0) {
      trajectoriesList.innerHTML =
        '<div class="trajectory-empty">No trajectory data yet.</div>';
      return;
    }

    const skillCount = skills ? skills.length : 0;

    trajectoriesList.innerHTML = trajectories
      .slice(0, 10)
      .map(
        (t) => {
          const rate = Math.round((t.success_rate || 0) * 100);
          const color =
            rate >= 80
              ? "var(--accent-green)"
              : rate >= 50
              ? "var(--accent-orange)"
              : "var(--accent-red)";
          return `
        <div class="trajectory-item">
          <div class="trajectory-goal">${escapeHtml(t.goal)}</div>
          <div class="trajectory-meta">
            <span>${formatDuration(t.total_duration_ms)}</span>
            <span>Complexity: ${"●".repeat(Math.min(t.complexity, 5))}</span>
            <span>${rate}% success</span>
          </div>
          <div class="trajectory-bar">
            <div class="fill" style="width:${rate}%;background:${color}"></div>
          </div>
        </div>
      `;
        }
      )
      .join("");

    if (skillCount > 0) {
      trajectoriesList.innerHTML += `<div style="margin-top:8px;font-size:11px;color:var(--text-secondary)">🧠 ${skillCount} distilled skills</div>`;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  function showLoading() {
    loading.classList.remove("hidden");
    content.classList.add("hidden");
  }

  function hideLoading() {
    loading.classList.add("hidden");
  }

  function showContent() {
    content.classList.remove("hidden");
  }

  function showError(msg) {
    loading.classList.add("hidden");
    content.classList.add("hidden");
    error.classList.remove("hidden");
    errorMsg.textContent = msg || "Unknown error loading Kuma data.";
  }

  function hideError() {
    error.classList.add("hidden");
  }

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDuration(ms) {
    if (!ms) return "0ms";
    if (ms < 1000) return ms + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    return Math.floor(ms / 60000) + "m " + Math.floor((ms % 60000) / 1000) + "s";
  }
})();
