// Crossbar core: your X account through api-anything. The MCP server and the CLI both call these.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { call } from "api-anything";

export const SITE = "x";
const here = dirname(fileURLToPath(import.meta.url));
export const SPEC = join(here, "..", "spec", "x.json");
const aaHome = () => process.env.API_ANYTHING_HOME || join(homedir(), ".api-anything");
const stampFile = () => join(aaHome(), "crossbar.json");
/** api-anything's own CLI, run with this same node: works the same on Linux, macOS and Windows. */
export const AA_CLI = join(dirname(fileURLToPath(import.meta.resolve("api-anything"))), "cli.js");

const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * Put Crossbar's X spec where api-anything looks first (~/.api-anything/sites/x.json).
 * A copy api-anything healed since (a rotated queryId) is kept unless `force`.
 */
export function installSpec({ force = false } = {}) {
  const ours = readFileSync(SPEC, "utf8");
  const dest = join(aaHome(), "sites", "x.json");
  const stamp = existsSync(stampFile()) ? JSON.parse(readFileSync(stampFile(), "utf8")) : {};
  if (existsSync(dest)) {
    const theirs = readFileSync(dest, "utf8");
    if (theirs === ours) return { installed: false, path: dest, note: "already current" };
    const untouched = stamp.specSha && sha(theirs) === stamp.specSha;
    if (!untouched && !force)
      return { installed: false, path: dest, note: "kept your copy: api-anything healed or you edited it (crossbar install --force replaces it)" };
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, ours);
  writeFileSync(stampFile(), JSON.stringify({ specSha: sha(ours), at: new Date().toISOString() }, null, 2));
  return { installed: true, path: dest };
}

/** Run api-anything's CLI and parse its JSON answer. Interactive output (a login window) passes through stderr. */
export function aa(args, { inherit = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [AA_CLI, ...args], { stdio: ["ignore", "pipe", inherit ? "inherit" : "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
      try {
        resolve({ code, ...JSON.parse(line) });
      } catch {
        resolve({ code, ok: code === 0, output: out.trim(), error: err.trim() || undefined });
      }
    });
  });
}

// ---- input helpers ----------------------------------------------------------------------------

/** A post id from an id, an x.com / twitter.com URL, or a status path. */
export function postId(input) {
  const s = String(input ?? "").trim();
  const m = /status(?:es)?\/(\d{1,25})/.exec(s) ?? /^(\d{1,25})$/.exec(s);
  if (!m) throw new InputError(`"${s}" is not a post id or a post URL (x.com/<user>/status/<id>)`);
  return m[1];
}

export class InputError extends Error {}

const handleOf = (input) => {
  const s = String(input ?? "").trim();
  const url = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/.exec(s);
  return (url ? url[1] : s).replace(/^@/, "");
};

/** A numeric user id from an id, @handle, handle or profile URL (one getUser call for a handle). */
export async function userId(input) {
  const s = String(input ?? "").trim();
  if (/^\d{1,25}$/.test(s)) return s;
  const handle = handleOf(s);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new InputError(`"${s}" is not an X handle, user id or profile URL`);
  const r = await run("getUser", { screen_name: handle });
  const id = r.ok && (r.data?.rest_id ?? r.data?.[0]?.rest_id);
  if (!id) throw new InputError(`no X account @${handle}${r.reason ? ` (${r.reason})` : ""}`);
  return String(id);
}

// ---- calling ----------------------------------------------------------------------------------

const BIG = { maxChars: 200_000 };
/** Tests swap in a fake fetch here; nothing else sets it. */
export const testHooks = { fetch: undefined };

/** One api-anything call of an X op, answered as api-anything answers it. */
export async function run(op, args = {}, { write = false, again = false, maxTier, view } = {}) {
  installSpec();
  const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return call(SITE, op, clean, {
    allowWrites: write,
    again,
    maxTier,
    view: view ?? BIG,
    ...(testHooks.fetch ? { fetchImpl: testHooks.fetch, minIntervalMs: 0, maxTier: 1 } : {}),
  });
}

/** The answer an agent or person sees: data on success, else what happened and what to do. */
function answer(r, data = r.data, extra = {}) {
  if (!r.ok) {
    const out = { ok: false, class: r.class, reason: r.reason, next: r.next };
    if (r.class === "auth") out.next = "sign in: crossbar login (or the x_login tool), then try again";
    if (r.write) out.write = r.write;
    return out;
  }
  return { ok: true, ...(r.write ? { write: r.write } : {}), ...extra, data, ...(r.tier > 1 ? { tier: r.tier } : {}) };
}

// ---- shaping X's answers ----------------------------------------------------------------------

const num = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

function post(e) {
  const id = e.id ?? e.v_id;
  if (!id) return undefined;
  const author = e.author ?? e.v_author;
  return prune({
    id: String(id),
    url: author ? `https://x.com/${author}/status/${id}` : `https://x.com/i/status/${id}`,
    author,
    author_name: e.author_name,
    text: e.long_text ?? e.text ?? e.v_text,
    created_at: e.created_at ?? e.v_created_at,
    likes: num(e.likes),
    reposts: num(e.reposts),
    replies: num(e.replies),
    quotes: num(e.quotes),
    bookmarks: num(e.bookmarks),
    views: num(e.views),
    liked: e.liked,
    reposted: e.reposted,
    bookmarked: e.bookmarked,
    in_reply_to: e.in_reply_to,
    quoted_id: e.quoted_id,
    repost_of: e.repost_of_id ? prune({ id: e.repost_of_id, author: e.repost_of_author, text: e.repost_of_text }) : undefined,
    media: e.media,
  });
}

const list = (data) => (Array.isArray(data) ? data : data ? [data] : []);
const isAd = (e) => /^promoted|-promoted-/i.test(e.entryId ?? "");

function cursors(entries) {
  const c = {};
  for (const e of entries)
    if (e.cursor && e.cursorType) c[e.cursorType.toLowerCase()] = e.cursor;
    else if (e.cursor && /cursor-bottom/.test(e.entryId ?? "")) c.bottom = e.cursor;
  return c;
}

/** Timeline entries -> { posts, next_cursor }. */
export function timeline(data) {
  const entries = list(data);
  const posts = entries.filter((e) => !isAd(e)).map(post).filter(Boolean);
  const c = cursors(entries);
  return prune({ posts, next_cursor: c.bottom });
}

function users(data) {
  const entries = list(data);
  const people = entries
    .filter((e) => e.id && !isAd(e))
    .map((e) =>
      prune({
        id: String(e.id),
        screen_name: e.screen_name,
        name: e.name,
        url: e.screen_name ? `https://x.com/${e.screen_name}` : undefined,
        bio: e.bio2 ?? e.bio,
        followers: num(e.followers),
        following: num(e.following),
        verified: e.verified,
        you_follow: e.you_follow,
        follows_you: e.follows_you,
      }),
    );
  return prune({ users: people, next_cursor: cursors(entries).bottom });
}

/** A TweetDetail answer: the focal post, the posts above it, and replies flattened from modules. */
function thread(data, focal) {
  const entries = list(data);
  const top = entries.filter((e) => !isAd(e)).map(post).filter(Boolean);
  const replies = [];
  for (const e of entries) {
    const ids = list(e.thread_ids);
    ids.forEach((id, i) =>
      replies.push(
        prune({
          id: String(id),
          author: list(e.thread_authors)[i],
          url: `https://x.com/${list(e.thread_authors)[i] ?? "i"}/status/${id}`,
          text: list(e.thread_texts)[i],
          created_at: list(e.thread_created)[i],
          likes: num(list(e.thread_likes)[i]),
          in_reply_to: list(e.thread_reply_to)[i],
        }),
      ),
    );
  }
  const focalPost = top.find((p) => p.id === focal);
  return prune({
    post: focalPost,
    above: top.filter((p) => p.id !== focal && !replies.some((r) => r.id === p.id)),
    replies: [...top.filter((p) => p.id !== focal && p.in_reply_to === focal), ...replies].filter(
      (r, i, a) => a.findIndex((x) => x.id === r.id) === i,
    ),
    next_cursor: cursors(entries).bottom,
  });
}

// ---- the operations Crossbar offers -----------------------------------------------------------

export async function login({ window = false, profile, cookies } = {}) {
  installSpec();
  const args = ["login", SITE];
  if (window) args.push("--window");
  if (profile) args.push("--profile", profile);
  if (cookies) args.push("--cookies", cookies);
  const r = await aa(args, { inherit: true });
  if (r.ok && r.loggedIn) {
    const me = await whoami().catch(() => undefined);
    return { ok: true, loggedIn: true, via: r.source ?? (window ? "window" : "browser"), profile: r.profile, account: me?.data };
  }
  return {
    ok: false,
    loggedIn: false,
    reason: r.reason ?? r.warning ?? r.error ?? "no X sign-in found",
    next: window
      ? "sign in fully in the window (2FA too), then close it"
      : "sign in to x.com in Chrome, Edge, Brave or another Chromium browser and run crossbar login again, or use crossbar login --window",
    ...(r.profiles ? { profiles: r.profiles } : {}),
  };
}

export async function logout() {
  const r = await aa(["logout", SITE]);
  return { ok: r.ok !== false, loggedIn: false, note: "Crossbar's copy of your X session is cleared. Your browser stays signed in; sign out there too if you want." };
}

export async function whoami() {
  const r = await run("me");
  if (!r.ok) return answer(r);
  const s = r.data ?? {};
  const u = s.screen_name ? await run("getUser", { screen_name: s.screen_name }) : undefined;
  const d = u?.ok ? u.data : {};
  return answer(r, prune({
    id: d.rest_id,
    screen_name: s.screen_name,
    name: d["core.name"] ?? d.core?.name,
    url: s.screen_name ? `https://x.com/${s.screen_name}` : undefined,
    followers: d["relationship_counts.followers"] ?? d.relationship_counts?.followers,
    following: d["relationship_counts.following"] ?? d.relationship_counts?.following,
    posts: d["tweet_counts.tweets"] ?? d.tweet_counts?.tweets,
    protected: s.protected,
    language: s.language,
  }));
}

export async function home({ feed = "for_you", count, cursor } = {}) {
  const r = await run(feed === "following" ? "latestTimeline" : "homeTimeline", { count, cursor });
  return r.ok ? answer(r, timeline(r.data)) : answer(r);
}

export async function search({ query, mode = "latest", count, cursor }) {
  if (mode === "people") {
    const r = await run("searchPeople", { query, count, cursor });
    return r.ok ? answer(r, users(r.data)) : answer(r);
  }
  const product = { top: "Top", latest: "Latest", media: "Media" }[mode] ?? "Latest";
  const r = await run("searchPosts", { query, product, count, cursor });
  return r.ok ? answer(r, timeline(r.data)) : answer(r);
}

export async function getPost({ post: p, cursor }) {
  const id = postId(p);
  const r = await run("getThread", { tweetId: id, cursor });
  if (r.ok) return answer(r, thread(r.data, id));
  if (r.class === "auth") {
    const pub = await run("getTweet", { tweetId: id }); // signed out: the post alone
    if (pub.ok) return answer(pub, pub.data, { note: "signed out: the post without replies (crossbar login for the thread)" });
  }
  return answer(r);
}

export async function profile({ user }) {
  const handle = handleOf(user);
  const r = /^\d+$/.test(handle) ? { ok: false, class: "input", reason: "give a handle for a profile" } : await run("getUser", { screen_name: handle });
  if (!r.ok) return answer(r);
  const d = r.data ?? {};
  const g = (k) => d[k] ?? k.split(".").reduce((o, p) => o?.[p], d);
  return answer(r, prune({
    id: g("rest_id"),
    screen_name: g("core.screen_name"),
    name: g("core.name"),
    url: `https://x.com/${g("core.screen_name") ?? handle}`,
    bio: g("profile_bio.description"),
    location: g("location.location"),
    followers: g("relationship_counts.followers"),
    following: g("relationship_counts.following"),
    posts: g("tweet_counts.tweets"),
    joined: g("core.created_at_ms") ? new Date(Number(g("core.created_at_ms"))).toISOString().slice(0, 10) : undefined,
    verified: g("verification.is_blue_verified"),
    protected: g("privacy.protected"),
    avatar: g("avatar.image_url")?.replace("_normal", "_400x400"),
    banner: g("banner.image_url"),
  }));
}

export async function userPosts({ user, replies = false, count, cursor }) {
  const r = await run(replies ? "userReplies" : "userTweets", { userId: await userId(user), count, cursor });
  return r.ok ? answer(r, timeline(r.data)) : answer(r);
}

export async function likes({ user, count, cursor } = {}) {
  const id = user ? await userId(user) : (await whoami()).data?.id;
  if (!id) return { ok: false, class: "auth", reason: "not signed in", next: "crossbar login" };
  const r = await run("likedPosts", { userId: id, count, cursor });
  return r.ok ? answer(r, timeline(r.data)) : answer(r);
}

export async function bookmarks({ count, cursor } = {}) {
  const r = await run("bookmarks", { count, cursor });
  return r.ok ? answer(r, timeline(r.data)) : answer(r);
}

export async function people({ user, which, count, cursor }) {
  const id = user ? await userId(user) : (await whoami()).data?.id;
  if (!id) return { ok: false, class: "auth", reason: "not signed in", next: "crossbar login" };
  const r = await run(which === "following" ? "following" : "followers", { userId: id, count, cursor });
  return r.ok ? answer(r, users(r.data)) : answer(r);
}

export async function notifications({ count } = {}) {
  const r = await run("notifications", { count });
  if (!r.ok) return answer(r);
  const items = Object.entries(r.data ?? {})
    .map(([id, n]) => prune({ id, text: n?.message?.text, time: n?.timestampMs ? new Date(Number(n.timestampMs)).toISOString() : undefined, icon: n?.icon?.id }))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return answer(r, { notifications: items });
}

export async function mentions({ count } = {}) {
  const r = await run("mentions", { count });
  if (!r.ok) return answer(r);
  const items = Object.values(r.data ?? {})
    .map((t) => prune({ id: t.id_str, url: `https://x.com/i/status/${t.id_str}`, text: t.full_text ?? t.text, created_at: t.created_at, user_id: t.user_id_str, in_reply_to: t.in_reply_to_status_id_str }))
    .sort((a, b) => (BigInt(b.id ?? 0) > BigInt(a.id ?? 0) ? 1 : -1));
  return answer(r, { posts: items });
}

export async function dmInbox() {
  const r = await run("dmInbox");
  if (!r.ok) return answer(r);
  const msgs = list(r.data).filter((m) => m.text !== undefined || m.message_id);
  const byConv = {};
  for (const m of msgs) (byConv[m.conversation_id] ??= []).push(prune({ ...m, time: m.time ? new Date(Number(m.time)).toISOString() : undefined }));
  return answer(r, { conversations: Object.entries(byConv).map(([conversation_id, messages]) => ({ conversation_id, latest: messages[0], count: messages.length })) });
}

export async function dmConversation({ conversation_id }) {
  const r = await run("dmConversation", { conversationId: conversation_id });
  if (!r.ok) return answer(r);
  return answer(r, { messages: list(r.data).filter((m) => m.message_id).map((m) => prune({ ...m, time: m.time ? new Date(Number(m.time)).toISOString() : undefined })) });
}

// ---- writes -----------------------------------------------------------------------------------

const LIMIT = 280;
const tooLong = (text) => (String(text).length > LIMIT ? `${String(text).length} characters: over ${LIMIT} needs X Premium, or X refuses it` : undefined);

const said = (r, what) => ({
  ...answer(r),
  ...(r.ok ? { done: what } : {}),
  ...(r.ok && r.write && r.write !== "applied" ? { note: "X accepted it; check x.com if you need certainty. Don't send it again." } : {}),
});

export async function createPost({ text, again }) {
  if (!String(text ?? "").trim()) throw new InputError("text is empty");
  const r = await run("createPost", { text }, { write: true, again });
  const out = said(r, "posted");
  if (r.ok && r.data?.id) out.url = `https://x.com/i/status/${r.data.id}`;
  const warn = tooLong(text);
  return warn ? { ...out, warning: warn } : out;
}

export async function reply({ post: p, text, again }) {
  const r = await run("reply", { tweetId: postId(p), text }, { write: true, again });
  const out = said(r, "replied");
  if (r.ok && r.data?.id) out.url = `https://x.com/i/status/${r.data.id}`;
  return out;
}

export async function quote({ post: p, text, again }) {
  const r = await run("quotePost", { tweetId: postId(p), text }, { write: true, again });
  const out = said(r, "quoted");
  if (r.ok && r.data?.id) out.url = `https://x.com/i/status/${r.data.id}`;
  return out;
}

export async function deletePost({ post: p }) {
  return said(await run("deletePost", { tweetId: postId(p) }, { write: true }), "deleted");
}

/** like/unlike, repost/undoRepost, bookmark/removeBookmark. */
export async function toggle({ post: p, action, undo = false }) {
  const ops = { like: ["like", "unlike"], repost: ["repost", "undoRepost"], bookmark: ["bookmark", "removeBookmark"] }[action];
  if (!ops) throw new InputError(`unknown action ${action}`);
  const op = ops[undo ? 1 : 0];
  return said(await run(op, { tweetId: postId(p) }, { write: true, again: true }), op);
}

/** follow/unfollow, mute/unmute, block/unblock. */
export async function relate({ user, action, undo = false }) {
  const ops = { follow: ["follow", "unfollow"], mute: ["mute", "unmute"], block: ["block", "unblock"] }[action];
  if (!ops) throw new InputError(`unknown action ${action}`);
  const op = ops[undo ? 1 : 0];
  return said(await run(op, { userId: await userId(user) }, { write: true, again: true }), op);
}

export async function sendDM({ conversation_id, user, text, again }) {
  let conv = conversation_id;
  if (!conv) {
    if (!user) throw new InputError("give conversation_id or user");
    const [me, them] = [(await whoami()).data?.id, await userId(user)];
    if (!me) return { ok: false, class: "auth", reason: "not signed in", next: "crossbar login" };
    conv = [me, them].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).join("-");
  }
  return said(await run("sendDM", { conversationId: conv, text }, { write: true, again }), "sent");
}
