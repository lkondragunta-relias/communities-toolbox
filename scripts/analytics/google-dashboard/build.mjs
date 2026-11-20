import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const source = name => new URL(name, import.meta.url);
const target = name => new URL(`../../../dist-google-analytics-dashboard/${name}`, import.meta.url);
const result = await build({
  configFile: false, envFile: false, plugins: [react()],
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.VITE_PRIVATE_ANALYTICS": "false",
    "import.meta.env.VITE_GOOGLE_ANALYTICS_DASHBOARD_URL": '""',
  },
  build: {
    write: false,
    lib: { entry: fileURLToPath(source("entry.jsx")), formats: ["iife"], name: "ToolboxAnalytics" },
  },
});
const outputs = result[0].output;
const script = outputs.find(file => file.type === "chunk")?.code;
const style = outputs.find(file => file.type === "asset" && file.fileName.endsWith(".css"))?.source;
if (!script || typeof style !== "string" || outputs.length !== 2) throw new Error("Unexpected Analytics build outputs");
const inlineScript = script.replace(/<\/script/gi, match => `<\\/${match.slice(2)}`);
if (/<\/style/i.test(style)) throw new Error("Unexpected closing style tag in Analytics CSS");
await mkdir(target(""), { recursive: true });
const serverSources = await Promise.all(["Code.gs", "../../google-apps-script/AnalyticsTable.gs"]
  .map(name => readFile(source(name), "utf8")));
await Promise.all([
  writeFile(target("Code.gs"), serverSources.join("\n")),
  copyFile(source("appsscript.json"), target("appsscript.json")),
  writeFile(target("Dashboard.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive">
<base target="_top"><style>${style}</style></head>
<body><main class="dashboard-shell"><header>
<a href="https://lkondragunta-relias.github.io/communities-toolbox/">Communities Toolbox</a>
<h1>Analytics</h1></header><div id="analytics-root"></div></main><script>${inlineScript}</script></body></html>`),
]);
