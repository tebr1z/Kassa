import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

const targets = [...await files("app/api"), "proxy.ts"];
for (const file of targets) {
  let text = await readFile(file, "utf8");
  if (!text.includes("console.error(") || text.includes("logSystemError(")) continue;
  const importLine = file === "proxy.ts"
    ? 'import { logSystemError } from "./lib/log-error";\n'
    : 'import { logSystemError } from "@/lib/log-error";\n';
  text = text.replace(/^(import .+\r?\n)/, `$1${importLine}`);
  text = text.replace(/console\.error\(([^;\n]+)\)/g, (match, args) => {
    const parts = args.split(",").map((part) => part.trim());
    const source = (parts[0] || '"api"').replace(/^['"]|['"]$/g, "");
    const errorName = parts[1] || "error";
    return `console.error(${args});void logSystemError(${JSON.stringify(source)}, ${errorName})`;
  });
  await writeFile(file, text);
  console.log("wired", file);
}
