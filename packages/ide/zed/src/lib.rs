// ============================================================
// KUMA ZED — Zed Extension for Kuma Dashboard
// ============================================================
//
// Registers a `/kuma` slash command that checks for the Kuma
// SQLite database and reports dashboard summary.
//
// Note: uses zed_extension_api v0.1.0 for compatibility.
//

use std::path::Path;
use zed_extension_api::{self as zed, Result};

struct KumaExtension;

impl zed::Extension for KumaExtension {
    fn new() -> Self {
        Self
    }

    /// Handle the `/kuma` slash command in the assistant panel.
    fn run_slash_command(
        &self,
        _command: zed::SlashCommand,
        _args: Vec<String>,
        worktree: Option<&zed::Worktree>,
    ) -> Result<zed::SlashCommandOutput> {
        let worktree = worktree
            .ok_or_else(|| "No project open. Open a project with a `.kuma/kuma.db` file.".to_string())?;

        let root = worktree.root_path();
        let db_path = format!("{}/.kuma/kuma.db", root);

        let text = if Path::new(&db_path).exists() {
            format!(
                "📊 **Kuma Dashboard**\n\n✅ `.kuma/kuma.db` found at:\n`{}`\n\nRun `sqlite3 -json {} \"SELECT COUNT(*) as node_count FROM nodes\"` for detailed stats.",
                db_path, db_path
            )
        } else {
            format!(
                "📊 **Kuma Dashboard**\n\n⚠️ No `.kuma/kuma.db` found in:\n`{}`\n\nMake sure Kuma is initialized in this project.",
                root
            )
        };

        let text_len = text.len();

        Ok(zed::SlashCommandOutput {
            text,
            sections: vec![zed::SlashCommandOutputSection {
                range: (0..text_len).into(),
                label: "Kuma Dashboard".to_string(),
            }],
        })
    }
}

zed::register_extension!(KumaExtension);
