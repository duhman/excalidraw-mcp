import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "diagram-from-spec",
    {
      description: "Generate a structured Excalidraw diagram plan from requirements text",
      argsSchema: {
        requirements: z.string().min(1),
        style: z.string().optional(),
        targetAudience: z.string().optional()
      }
    },
    async ({ requirements, style, targetAudience }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Convert the following requirements into an Excalidraw scene strategy.",
              "Output:",
              "1) Diagram structure (sections/layers)",
              "2) Element plan with element type, labels, and coordinates strategy",
              "3) Mermaid snippet if helpful",
              "4) Suggested MCP tool call sequence",
              targetAudience ? `Audience: ${targetAudience}` : "",
              style ? `Style guidance: ${style}` : "",
              `Requirements:\n${requirements}`
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "refine-layout",
    {
      description: "Review and improve scene layout/readability",
      argsSchema: {
        goals: z.string().min(1),
        constraints: z.string().optional()
      }
    },
    async ({ goals, constraints }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Improve the current Excalidraw scene layout.",
              "Focus areas:",
              "- alignment and spacing consistency",
              "- reduced connector crossings",
              "- semantic grouping",
              "- readability at 100% zoom",
              constraints ? `Constraints: ${constraints}` : "",
              `Goals: ${goals}`,
              "Return an ordered list of MCP tool calls and exact patch operations."
            ]
              .filter(Boolean)
              .join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "convert-notes-to-scene",
    {
      description: "Convert unstructured notes into an actionable scene model",
      argsSchema: {
        notes: z.string().min(1),
        diagramType: z.string().optional()
      }
    },
    async ({ notes, diagramType }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Transform notes into an Excalidraw-ready scene model.",
              diagramType ? `Preferred diagram type: ${diagramType}` : "",
              "Output JSON with:",
              "- nodes",
              "- edges/relationships",
              "- grouping",
              "- annotations",
              "Then include MCP operations to build it.",
              `Notes:\n${notes}`
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "scene-review-checklist",
    {
      description: "Run a quality checklist against a scene",
      argsSchema: {
        focus: z.string().optional()
      }
    },
    async ({ focus }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Review the active Excalidraw scene and produce findings with severity.",
              "Checklist:",
              "- inconsistent labels/casing",
              "- overlaps and clipping risks",
              "- disconnected elements",
              "- missing titles/legends",
              "- visual hierarchy issues",
              focus ? `Focus area: ${focus}` : "",
              "For each finding: include rationale and exact MCP patch recommendations."
            ]
              .filter(Boolean)
              .join("\n")
          }
        }
      ]
    })
  );
}
