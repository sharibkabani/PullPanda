// Live smoke test over stdio: lists the tools and reads findings from a real PR.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [repo = "sharibkabani/PullPanda", pr = "1"] = process.argv.slice(2);
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "bun", args: [new URL("../src/index.ts", import.meta.url).pathname] }));
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const res = await client.callTool({ name: "get_review_findings", arguments: { repo, pr: Number(pr) } });
const out = JSON.parse((res.content as { text: string }[])[0]!.text);
console.log(`${out.open_findings} open findings on ${repo}#${pr}; first:`, JSON.stringify(out.findings[0], null, 1).slice(0, 500));
await client.close();
