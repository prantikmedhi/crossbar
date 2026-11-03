#!/usr/bin/env node
// crossbar: your X (Twitter) account from the terminal, and as an MCP server for your agents.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as x from "../src/x.mjs";

const SELF = fileURLToPath(import.meta.url);

const HELP = `crossbar: your X account from the terminal and from your AI agents

Account
  crossbar login [--window] [--profile "Chrome/Profile 1"] [--cookies file]
                                    import your x.com sign-in from your browser (or sign in in a window)
  crossbar logout                   forget Crossbar's copy of the session
  crossbar whoami                   the signed-in account

Read
  crossbar home [--following] [--count n] [--cursor c]
  crossbar search <query> [--mode latest|top|media|people]
  crossbar read <post-id-or-url>    a post with its thread and replies
  crossbar profile <@user>
  crossbar posts <@user> [--replies]
  crossbar likes | bookmarks | notifications | mentions
  crossbar followers [@user] | following [@user]
  crossbar dms | dm-read <conversation_id>

Write (acts as you on x.com)
  crossbar post "<text>" [--again]
  crossbar reply <post> "<text>"     crossbar quote <post> "<text>"
  crossbar delete <post>
  crossbar like <post> [--undo]      crossbar repost <post> [--undo]     crossbar bookmark <post> [--undo]
  crossbar follow <@user> [--undo]   crossbar mute <@user> [--undo]      crossbar block <@user> [--undo]
  crossbar dm <@user|conversation_id> "<text>"

Agents (MCP)
  crossbar setup [--dry-run] [--read-only]  connect the Crossbar MCP server to Claude Code, Claude Desktop,
                                            Cursor, VS Code, Codex and Gemini CLI found on this machine
  crossbar mcp [--read-only]                run the MCP server on stdio (what the agents launch)
  crossbar mcp --print-config               print the config to add it by hand

Other
  crossbar install [--force]        (re)install Crossbar's X spec into ~/.api-anything
  crossbar status                   how each X operation has been doing (api-anything status)
  --json                            print the raw JSON answer
`;

const { values: f, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    window: { type: "boolean" }, profile: { type: "string" }, cookies: { type: "string" },
    following: { type: "boolean" }, count: { type: "string" }, cursor: { type: "string" },
    mode: { type: "string" }, replies: { type: "boolean" }, undo: { type: "boolean" },
    again: { type: "boolean" }, force: { type: "boolean" }, json: { type: "boolean" },
    "read-only": { type: "boolean" }, "print-config": { type: "boolean" }, "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }, yes: { type: "boolean", short: "y" },
  },
});
const [cmd, a1, ...rest] = pos;
const count = f.count ? Number(f.count) : undefined;
const page = { count, cursor: f.cursor };

function need(v, what) {
  if (!v) {
    console.error(`missing ${what}\n\n${HELP}`);
    process.exit(2);
  }
  return v;
}

// ---- pretty printing ---------------------------------------------------------------------------

const c = process.stdout.isTTY && !process.env.NO_COLOR ? { b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m` } : { b: String, d: String, r: String, g: String };
const n = (v) => (v === undefined ? "" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : String(v));

function printPost(p, indent = "") {
  const head = `${c.b(`@${p.author ?? "?"}`)}${p.author_name ? ` ${p.author_name}` : ""} ${c.d(p.created_at ?? "")}`;
  console.log(indent + head);
  if (p.repost_of) console.log(`${indent}  ${c.d(`reposted @${p.repost_of.author}:`)} ${p.repost_of.text ?? ""}`);
  else for (const line of String(p.text ?? "").split("\n")) console.log(`${indent}  ${line}`);
  const stats = [p.replies !== undefined && `💬 ${n(p.replies)}`, p.reposts !== undefined && `🔁 ${n(p.reposts)}`, p.likes !== undefined && `${p.liked ? "❤️" : "♡"} ${n(p.likes)}`, p.views && `👁 ${n(p.views)}`].filter(Boolean);
  console.log(`${indent}  ${c.d([...stats, p.url].join("  "))}`);
  console.log();
}

function show(r) {
  if (f.json) return console.log(JSON.stringify(r, null, 2));
  if (!r.ok) {
    console.error(c.r(`✗ ${r.class ?? "error"}: ${r.reason ?? ""}`));
    if (r.next) console.error(`  next: ${r.next}`);
    return;
  }
  const d = r.data ?? {};
  if (r.done) {
    console.log(c.g(`✓ ${r.done}`) + (r.url ? `  ${r.url}` : "") + (r.write ? c.d(`  (${r.write})`) : ""));
    if (r.warning) console.log(`  warning: ${r.warning}`);
    if (r.note) console.log(c.d(`  ${r.note}`));
    return;
  }
  if (d.post || d.replies) {
    for (const p of d.above ?? []) printPost(p);
    if (d.post) printPost(d.post);
    if (d.replies?.length) console.log(c.d(`— ${d.replies.length} replies —\n`));
    for (const p of d.replies ?? []) printPost(p, "  ");
  } else if (d.posts) {
    for (const p of d.posts) printPost(p);
    if (!d.posts.length) console.log(c.d("(nothing)"));
  } else if (d.users) {
    for (const u of d.users) console.log(`${c.b(`@${u.screen_name}`)} ${u.name ?? ""} ${c.d(`${n(u.followers)} followers`)}${u.follows_you ? c.d(" · follows you") : ""}\n  ${(u.bio ?? "").replace(/\n/g, " ")}`);
  } else if (d.notifications) {
    for (const x of d.notifications) console.log(`${c.d(x.time ?? "")}  ${x.text ?? ""}`);
  } else if (d.conversations) {
    for (const cv of d.conversations) console.log(`${c.b(cv.conversation_id)}  ${c.d(cv.latest?.time ?? "")}  ${cv.latest?.text ?? ""}`);
  } else if (d.messages) {
    for (const m of [...d.messages].reverse()) console.log(`${c.d(m.time ?? "")} ${c.b(m.sender_id)}: ${m.text ?? ""}`);
  } else {
    console.log(JSON.stringify(r.note ? { ...d, note: r.note } : d, null, 2));
  }
  if (d.next_cursor) console.log(c.d(`more: --cursor ${d.next_cursor}`));
}

// ---- MCP setup ---------------------------------------------------------------------------------

const launch = (readOnly) => ({ command: process.execPath, args: [SELF, "mcp", ...(readOnly ? ["--read-only"] : [])] });

function claudeDesktopConfig() {
  const h = homedir();
  if (platform() === "darwin") return join(h, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (platform() === "win32") return join(process.env.APPDATA ?? join(h, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(h, ".config", "Claude", "claude_desktop_config.json");
}

const has = (bin) => {
  try {
    execFileSync(platform() === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

function mergeJson(file, key, entry, dry) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8") || "{}") : {};
  data[key] ??= {};
  data[key].crossbar = entry;
  if (dry) return `would write ${file}`;
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file) && !existsSync(`${file}.bak-crossbar`)) copyFileSync(file, `${file}.bak-crossbar`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return `wrote ${file}`;
}

function setup({ dry, readOnly }) {
  const l = launch(readOnly);
  const done = [];
  const run = (bin, args) => {
    if (dry) return done.push(`would run: ${bin} ${args.join(" ")}`);
    try {
      execFileSync(bin, args, { stdio: "ignore", shell: platform() === "win32" });
      done.push(`${bin}: added`);
    } catch {
      done.push(`${bin}: could not add (already there? run: ${bin} mcp remove crossbar, then setup again)`);
    }
  };
  if (has("claude")) run("claude", ["mcp", "add", "--scope", "user", "crossbar", "--", l.command, ...l.args]);
  if (has("codex")) run("codex", ["mcp", "add", "crossbar", "--", l.command, ...l.args]);
  if (has("gemini")) run("gemini", ["mcp", "add", "--scope", "user", "crossbar", l.command, ...l.args]);
  const desktop = claudeDesktopConfig();
  if (existsSync(dirname(desktop))) done.push(`Claude Desktop: ${mergeJson(desktop, "mcpServers", l, dry)}`);
  const cursor = join(homedir(), ".cursor");
  if (existsSync(cursor)) done.push(`Cursor: ${mergeJson(join(cursor, "mcp.json"), "mcpServers", l, dry)}`);
  if (has("code")) {
    const cfg = JSON.stringify({ name: "crossbar", ...l });
    if (dry) done.push(`would run: code --add-mcp ${cfg}`);
    else
      try {
        execFileSync("code", ["--add-mcp", cfg], { stdio: "ignore", shell: platform() === "win32" });
        done.push("VS Code: added");
      } catch {
        done.push("VS Code: could not add");
      }
  }
  if (!done.length) done.push("no MCP client found; add it by hand: crossbar mcp --print-config");
  return done;
}

function printConfig(readOnly) {
  const l = launch(readOnly);
  const q = (s) => (/\s/.test(s) ? `"${s}"` : s);
  const line = [l.command, ...l.args].map(q).join(" ");
  console.log(`# Claude Code\nclaude mcp add --scope user crossbar -- ${line}\n`);
  console.log(`# Codex\ncodex mcp add crossbar -- ${line}\n`);
  console.log(`# Gemini CLI\ngemini mcp add --scope user crossbar ${line}\n`);
  console.log(`# Claude Desktop (${claudeDesktopConfig()}), Cursor (~/.cursor/mcp.json), Windsurf, others:`);
  console.log(JSON.stringify({ mcpServers: { crossbar: l } }, null, 2));
  console.log(`\n# VS Code (.vscode/mcp.json)\n${JSON.stringify({ servers: { crossbar: { type: "stdio", ...l } } }, null, 2)}`);
}

// ---- commands ----------------------------------------------------------------------------------

const text = () => need([...rest].join(" ") || undefined, "text");
const commands = {
  login: () => x.login({ window: f.window, profile: f.profile, cookies: f.cookies }),
  logout: () => x.logout(),
  whoami: () => x.whoami(),
  me: () => x.whoami(),
  home: () => x.home({ feed: f.following ? "following" : "for_you", ...page }),
  timeline: () => commands.home(),
  search: () => x.search({ query: need([a1, ...rest].join(" ") || undefined, "query"), mode: f.mode, ...page }),
  read: () => x.getPost({ post: need(a1, "post"), cursor: f.cursor }),
  profile: () => x.profile({ user: need(a1, "user") }),
  user: () => commands.profile(),
  posts: () => x.userPosts({ user: need(a1, "user"), replies: f.replies, ...page }),
  likes: () => x.likes({ user: a1, ...page }),
  bookmarks: () => x.bookmarks(page),
  followers: () => x.people({ user: a1, which: "followers", ...page }),
  following: () => x.people({ user: a1, which: "following", ...page }),
  notifications: () => x.notifications({ count }),
  mentions: () => x.mentions({ count }),
  dms: () => x.dmInbox(),
  "dm-read": () => x.dmConversation({ conversation_id: need(a1, "conversation_id") }),
  post: () => x.createPost({ text: need([a1, ...rest].join(" ") || undefined, "text"), again: f.again }),
  tweet: () => commands.post(),
  reply: () => x.reply({ post: need(a1, "post"), text: text(), again: f.again }),
  quote: () => x.quote({ post: need(a1, "post"), text: text(), again: f.again }),
  delete: () => x.deletePost({ post: need(a1, "post") }),
  like: () => x.toggle({ post: need(a1, "post"), action: "like", undo: f.undo }),
  unlike: () => x.toggle({ post: need(a1, "post"), action: "like", undo: true }),
  repost: () => x.toggle({ post: need(a1, "post"), action: "repost", undo: f.undo }),
  bookmark: () => x.toggle({ post: need(a1, "post"), action: "bookmark", undo: f.undo }),
  follow: () => x.relate({ user: need(a1, "user"), action: "follow", undo: f.undo }),
  unfollow: () => x.relate({ user: need(a1, "user"), action: "follow", undo: true }),
  mute: () => x.relate({ user: need(a1, "user"), action: "mute", undo: f.undo }),
  block: () => x.relate({ user: need(a1, "user"), action: "block", undo: f.undo }),
  dm: () => {
    const to = need(a1, "@user or conversation_id");
    const isConv = /^\d+-\d+$/.test(to) || (/^\d+$/.test(to) && to.length > 15);
    return x.sendDM({ ...(isConv ? { conversation_id: to } : { user: to }), text: text(), again: f.again });
  },
  install: () => ({ ok: true, data: x.installSpec({ force: f.force }) }),
  status: async () => ({ ok: true, data: await x.aa(["status", "x"]) }),
};

async function main() {
  if (!cmd || f.help || cmd === "help") return console.log(HELP);
  if (cmd === "mcp") {
    if (f["print-config"]) return printConfig(f["read-only"]);
    const { serve } = await import("../src/mcp.mjs");
    return serve({ readOnly: f["read-only"] });
  }
  if (cmd === "setup") {
    const spec = x.installSpec();
    console.log(`X spec: ${spec.installed ? "installed" : spec.note} (${spec.path})`);
    for (const line of setup({ dry: f["dry-run"], readOnly: f["read-only"] })) console.log(`  ${line}`);
    console.log("\nNext: crossbar login, then restart your agent and ask it: \"what's on my X timeline?\"");
    return;
  }
  const fn = commands[cmd];
  if (!fn) {
    console.error(`unknown command "${cmd}"\n\n${HELP}`);
    process.exit(2);
  }
  try {
    const r = await fn();
    show(r);
    process.exitCode = r?.ok === false ? 1 : 0;
  } catch (e) {
    show({ ok: false, class: e instanceof x.InputError ? "input" : "error", reason: e?.message ?? String(e) });
    process.exitCode = 1;
  } finally {
    const { closeBrowser } = await import("api-anything");
    await closeBrowser().catch(() => {});
  }
}

await main();
