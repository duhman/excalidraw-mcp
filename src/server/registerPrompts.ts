import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "agent-workflow-guide",
    {
      description:
        "Explain the preferred Excalidraw MCP tool-selection strategy for an agent and propose the safest next-step sequence",
      argsSchema: {
        objective: z.string().optional(),
        diagramType: z.string().optional(),
      }
    },
    async ({ objective, diagramType }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "You are using excalidraw-mcp.",
              "Explain the best tool-selection strategy for producing a high-quality Excalidraw scene.",
              "Preferred operating loop:",
              "1) scene_analyze",
              "2) scene_normalize only if structural issues are present",
              "3) higher-level helpers such as nodes_compose, layout_swimlanes, layout_flow, frames_assign_elements, styles_apply_preset, elements_arrange, and layout_polish",
              "4) scene_validate",
              "5) export_svg / export_png / export_webp",
              "Selection guidance:",
              "- prefer nodes_compose over manual shape + text assembly when semantic cards or blocks are needed",
              "- prefer layout_swimlanes over manually creating lane frames and headers",
              "- prefer styles_apply_preset over ad hoc color/font edits",
              "- treat scene_patch and exact element updates as last-mile tools",
              "- use recommendedActions from scene_analyze as the default next-step planner",
              "Call out any likely title, legend, spacing, overlap, hierarchy, or connector concerns an agent should watch for.",
              "Then provide an ordered MCP tool-call plan tailored to the objective.",
              objective ? `Objective: ${objective}` : "",
              diagramType ? `Diagram type: ${diagramType}` : "",
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        }
      ]
    })
  );

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
              "Prioritize deterministic Excalidraw MCP helpers before manual patches.",
              "Output:",
              "1) Diagram structure (sections/layers)",
              "2) Element plan with element type, labels, frames, and coordinates strategy",
              "3) Recommended style presets, title/legend treatment, and spacing scale",
              "4) Mermaid snippet if helpful",
              "5) Suggested MCP tool call sequence using tools like nodes_compose, layout_swimlanes, layout_flow, frames_create, styles_apply_preset, scene_analyze, layout_polish, and scene_validate",
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
              "Use a hybrid loop: run scene_analyze first, apply deterministic helpers second, and reserve patch operations for final polish only.",
              "Focus areas:",
              "- alignment and spacing consistency",
              "- reduced connector crossings",
              "- semantic grouping",
              "- readability at 100% zoom",
              "- title, legend, and visual hierarchy quality",
              constraints ? `Constraints: ${constraints}` : "",
              `Goals: ${goals}`,
              "Return an ordered list of MCP tool calls.",
              "Prefer scene_analyze, scene_normalize, layout_polish, elements_arrange, layout_swimlanes, layout_flow, frames_assign_elements, styles_apply_preset, and layers_reorder before exact patch operations.",
              "Include exact patch operations only if deterministic tools cannot finish the refinement."
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
              "- frames/swimlanes",
              "- annotations",
              "- suggested style presets",
              "Then include MCP operations to build it using higher-level helpers first.",
              "Favor nodes_compose, layout_swimlanes, layout_flow, frames_create, frames_assign_elements, connectors_create, styles_apply_preset, and layout_polish.",
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
              "Start from scene_analyze and scene_validate results, then add judgment where human taste still matters.",
              "Checklist:",
              "- inconsistent labels/casing",
              "- overlaps and clipping risks",
              "- disconnected elements",
              "- missing titles/legends",
              "- visual hierarchy issues",
              "- dense or crowded regions",
              "- unreadable text and typography inconsistencies",
              "- frame membership and container-text binding issues",
              focus ? `Focus area: ${focus}` : "",
              "For each finding: include rationale, exact MCP recommendations, and whether the fix should use a deterministic helper or a direct patch.",
              "When deterministic fixes are available, recommend the loop scene_analyze -> layout_polish / styles_apply_preset / layout_swimlanes -> scene_validate -> export."
            ]
              .filter(Boolean)
              .join("\n")
          }
        }
      ]
    })
  );
}
