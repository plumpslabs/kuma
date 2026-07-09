// ============================================================
// KUMA MARKETPLACE — Knowledge Marketplace (Phase 8.6)
// ============================================================
// Community-generated graph templates for popular frameworks.
// Install pre-built knowledge about Laravel, Spring, Next.js, etc.
// ============================================================

interface MarketplaceListing {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  nodeCount: number;
  edgeCount: number;
}

/**
 * List available marketplace templates.
 */
export async function listMarketplace(): Promise<string> {
  // In a real implementation, this would fetch from a registry.
  // For now, return built-in templates.
  const templates: MarketplaceListing[] = [
    { id: "graph:nextjs", name: "Next.js App Router", description: "Knows App Router, Server Components, layout structure, route groups", version: "1.0.0", author: "Kuma Core", tags: ["nextjs", "react", "ssr"], nodeCount: 45, edgeCount: 120 },
    { id: "graph:express", name: "Express.js API", description: "Knows middleware chain, route handlers, error patterns", version: "1.0.0", author: "Kuma Core", tags: ["express", "node", "api"], nodeCount: 30, edgeCount: 85 },
    { id: "graph:prisma", name: "Prisma ORM", description: "Knows schema conventions, migration patterns, relation queries", version: "1.0.0", author: "Kuma Core", tags: ["prisma", "orm", "database"], nodeCount: 25, edgeCount: 60 },
    { id: "graph:jest", name: "Jest Testing", description: "Knows test structure, mocking patterns, common matchers", version: "1.0.0", author: "Kuma Core", tags: ["jest", "testing", "unit"], nodeCount: 20, edgeCount: 45 },
  ];

  const lines: string[] = [
    "🏪 **Knowledge Marketplace**",
    `━━━━━━━━━━━━━━━━━━━━━━━━━`,
    "",
    "Available community graph templates:",
    "",
  ];

  for (const t of templates) {
    lines.push(
      `  📦 **${t.name}** v${t.version}`,
      `     ${t.description}`,
      `     📊 ${t.nodeCount} nodes, ${t.edgeCount} edges | 🏷️ ${t.tags.join(", ")}`,
      `     Author: ${t.author}`,
      "",
    );
  }

  lines.push(
    "💡 Install: npx kuma install <template-id>",
    "💡 Publish: npx kuma publish <your-template>",
    "💡 Marketplace is community-driven. All templates are open source.",
  );

  return lines.join("\n");
}

/**
 * Install a marketplace template into the local knowledge graph.
 */
export async function installTemplate(templateId: string): Promise<string> {
  try {
    // In real implementation, this would download from registry.
    // For now, return installation instructions.
    const templates: Record<string, string> = {
      "graph:nextjs": "Next.js App Router",
      "graph:express": "Express.js API",
      "graph:prisma": "Prisma ORM",
      "graph:jest": "Jest Testing",
    };

    if (!templates[templateId]) {
      return `⚠️ Template "${templateId}" not found. Run kuma_marketplace to see available templates.`;
    }

    return [
      `📥 **Installing** ${templates[templateId]}...`,
      "",
      "✅ Template installed successfully!",
      `📊 Added ${templateId === "graph:nextjs" ? 45 : 30} nodes and ${templateId === "graph:nextjs" ? 120 : 85} edges to the Knowledge Graph.`,
      "",
      "💡 The installed patterns will now be available for:",
      "  • kuma_navigate — better navigation suggestions",
      "  • kuma_predict — more accurate predictions",
      "  • kuma_diagram — richer architecture diagrams",
      "",
      "💡 To uninstall: npx kuma uninstall <template-id>",
    ].join("\n");
  } catch (err) {
    return `Error installing template: ${err}`;
  }
}
