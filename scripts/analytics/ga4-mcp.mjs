import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverName = "google-analytics-4";
const reportTool = "run_report";

function configuredTransport(configPath) {
  let server;
  try {
    server = JSON.parse(readFileSync(configPath, "utf8")).mcpServers?.[serverName];
  } catch {
    throw new Error("ANALYTICS_MCP_CONFIG_UNAVAILABLE");
  }
  const { type, command, args = [], env = {}, tools, disabled } = server ?? {};
  if (!["local", "stdio"].includes(type) || typeof command !== "string" || !command ||
      !Array.isArray(args) || args.some(arg => typeof arg !== "string") ||
      !env || typeof env !== "object" || Array.isArray(env) || Object.values(env).some(value => typeof value !== "string") ||
      disabled || !Array.isArray(tools) || !tools.some(tool => tool === "*" || tool === reportTool)) {
    throw new Error("ANALYTICS_MCP_CONFIG_INVALID");
  }
  return new StdioClientTransport({ command, args, env, stderr: "ignore" });
}

function decodeResult(result) {
  if (result.isError) throw new Error("GA4 report rejected");
  const report = result.structuredContent ?? (result.content?.length === 1 && result.content[0].type === "text"
    ? JSON.parse(result.content[0].text) : null);
  if (!Array.isArray(report?.metric_headers) || typeof report.metadata !== "object" || !report.metadata) {
    throw new Error("Invalid GA4 report payload");
  }
  return report;
}

export async function collectGa4Reports(plan, {
  configPath = join(homedir(), ".copilot", "mcp-config.json"),
  timeout = 45_000,
  warn = console.warn,
} = {}) {
  const transport = configuredTransport(configPath);
  const client = new Client({ name: "toolbox-analytics-refresh", version: "1.0.0" });
  const options = { timeout };
  try {
    try {
      await client.connect(transport, options);
    } catch {
      throw new Error("ANALYTICS_MCP_CONNECT_FAILED");
    }

    try {
      let cursor;
      for (let pageNumber = 0; ; pageNumber++) {
        const page = await client.listTools(cursor ? { cursor } : undefined, options);
        if (page.tools.some(tool => tool.name === reportTool)) break;
        if (!page.nextCursor || page.nextCursor === cursor || pageNumber >= 9) throw new Error("GA4 report tool not offered");
        cursor = page.nextCursor;
      }
    } catch {
      throw new Error("ANALYTICS_MCP_REPORT_TOOL_UNAVAILABLE");
    }

    const reports = {};
    for (const { id, args } of plan.requests) {
      try {
        reports[id] = decodeResult(await client.callTool({ name: reportTool, arguments: args }, undefined, options));
      } catch {
        warn(`Analytics MCP report unavailable for ${id}`);
        reports[id] = null;
      }
    }
    if (!Object.values(reports).some(Boolean)) throw new Error("ANALYTICS_MCP_NO_REPORTS");
    return { runAt: plan.runAt, reports };
  } finally {
    await client.close().catch(() => undefined);
  }
}
