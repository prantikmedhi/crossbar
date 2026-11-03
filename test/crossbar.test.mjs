// End to end through api-anything and the MCP server, with X answered by a fake fetch: no network.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const home = mkdtempSync(join(tmpdir(), "crossbar-test-"));
process.env.API_ANYTHING_HOME = home;
process.env.API_ANYTHING_SHARE = "0";
const x = await import("../src/x.mjs");
const { createCrossbarServer } = await import("../src/mcp.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

// signed in: a session file the way `api-anything login` writes it
x.installSpec();
const cookie = (name, value) => ({ name, value, domain: ".x.com", path: "/", expires: -1, httpOnly: false, secure: true });
writeFileSync(join(home, "sessions-x.json"), "{}");
const { saveSession } = await import(new URL("../node_modules/api-anything/dist/session.js", import.meta.url));
saveSession("x", { cookies: [cookie("auth_token", "A".repeat(40)), cookie("ct0", "c".repeat(32)), cookie("twid", "u%3D42")], values: {} });

const tweet = (id, user, text, extra = {}) => ({
  __typename: "Tweet",
  rest_id: id,
  core: { user_results: { result: { rest_id: "9", core: { screen_name: user, name: user.toUpperCase() } } } },
  views: { count: "1234" },
  legacy: { full_text: text, created_at: "Mon Nov 02 10:00:00 +0000 2026", favorite_count: 5, retweet_count: 2, reply_count: 1, quote_count: 0, bookmark_count: 0, favorited: false, retweeted: false, bookmarked: false, ...extra },
});
const entry = (t) => ({ entryId: `tweet-${t.rest_id}`, content: { entryType: "TimelineTimelineItem", itemContent: { tweet_results: { result: t } } } });
const cursorEntry = { entryId: "cursor-bottom-1", content: { entryType: "TimelineTimelineCursor", value: "NEXT123", cursorType: "Bottom" } };
const ad = { entryId: "promoted-tweet-77", content: { itemContent: { tweet_results: { result: tweet("77", "brand", "buy now") } } } };

// a getUser answer with every key path its spec learned, so it isn't taken for drift
const { readFileSync } = await import("node:fs");
const getUserShape = JSON.parse(readFileSync(new URL("../spec/x.json", import.meta.url), "utf8")).operations.find((o) => o.name === "getUser").response.shape;
function fromShape(shape) {
  const out = {};
  for (const [path, type] of Object.entries(shape)) {
    const keys = path.split(".");
    let o = out;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys.at(-1)] ??= { object: {}, string: "s", number: 1, boolean: false, array: [] }[type] ?? null;
  }
  return out;
}

const seen = [];
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
x.testHooks.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
  seen.push({ method: init.method ?? "GET", path: u.pathname, url: u, body: init.body, headers });
  const op = u.pathname.split("/").at(-1);
  if (op === "HomeTimeline" || op === "HomeLatestTimeline")
    return json({ data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries: [entry(tweet("1", "alice", "hello world")), ad, entry(tweet("2", "bob", "second", { favorited: true })), cursorEntry] }] } } } });
  if (op === "CreateTweet") {
    const text = JSON.parse(init.body).variables.tweet_text;
    return json({ data: { create_tweet: { tweet_results: { result: { rest_id: "555", legacy: { full_text: text, created_at: "now" } } } } } });
  }
  if (op === "FavoriteTweet") return json({ data: { favorite_tweet: "Done" } });
  if (op === "UserByScreenName") {
    const body = fromShape(getUserShape);
    const r = body.data.user_result_by_screen_name.result;
    Object.assign(r, { rest_id: "783214", core: { name: "X", screen_name: "X", created_at_ms: 1171982154000 } });
    Object.assign(r.relationship_counts, { followers: 10, following: 2 });
    r.avatar.image_url = "https://pbs.twimg.com/a_normal.jpg";
    return json(body);
  }
  if (op === "create.json") return json({ id_str: "783214", screen_name: "X", name: "X", following: true });
  if (op === "TweetDetail")
    return json({ data: { threaded_conversation_with_injections_v2: { instructions: [{ type: "TimelineAddEntries", entries: [entry(tweet("10", "alice", "the post")), { entryId: "conversationthread-11", content: { items: [{ item: { itemContent: { tweet_results: { result: tweet("11", "carol", "a reply", { in_reply_to_status_id_str: "10" }) } } } }] } }] }] } } });
  return new Response("not found", { status: 404 });
};

test("home timeline: posts cleaned, ad dropped, cursor kept, signed-in headers sent", async () => {
  const r = await x.home({ count: 5 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.posts.map((p) => p.id), ["1", "2"]);
  assert.equal(r.data.posts[0].author, "alice");
  assert.equal(r.data.posts[0].url, "https://x.com/alice/status/1");
  assert.equal(r.data.posts[1].liked, true);
  assert.equal(r.data.posts[0].views, 1234);
  assert.equal(r.data.next_cursor, "NEXT123");
  const req = seen.findLast((s) => s.path.endsWith("/HomeTimeline"));
  assert.equal(req.headers["x-csrf-token"], "c".repeat(32));
  assert.match(req.headers.cookie, /auth_token=A{40}/);
  assert.equal(JSON.parse(req.url.searchParams.get("variables")).count, 5);
});

test("timeline: legacy-shaped author fills in, and no more posts than count", () => {
  const picked = ["1", "2", "3"].map((id) => ({ entryId: `tweet-${id}`, id, text: "t", author_l: "dana", author_name_l: "Dana" }));
  const r = x.timeline(picked, 2);
  assert.deepEqual(r.posts.map((p) => p.id), ["1", "2"]);
  assert.equal(r.posts[0].author, "dana");
  assert.equal(r.posts[0].author_name, "Dana");
  assert.equal(r.posts[0].url, "https://x.com/dana/status/1");
});

test("post: the exact text goes in CreateTweet and the new post's URL comes back", async () => {
  const r = await x.createPost({ text: 'Ship it — "quoted" & ✓' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.done, "posted");
  assert.equal(r.url, "https://x.com/i/status/555");
  const req = seen.findLast((s) => s.path.endsWith("/CreateTweet"));
  assert.equal(req.method, "POST");
  assert.equal(JSON.parse(req.body).variables.tweet_text, 'Ship it — "quoted" & ✓');
});

test("post: the same text twice in 10 minutes is refused unless again", async () => {
  const r = await x.createPost({ text: 'Ship it — "quoted" & ✓' });
  assert.equal(r.ok, false);
  assert.equal(r.class, "duplicate");
});

test("follow by @handle resolves the id first", async () => {
  const r = await x.relate({ user: "@X", action: "follow" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const req = seen.findLast((s) => s.path.endsWith("/friendships/create.json"));
  assert.match(String(req.body), /user_id=783214/);
});

test("like takes a post URL", async () => {
  const r = await x.toggle({ post: "https://x.com/alice/status/1999?s=20", action: "like" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.parse(seen.findLast((s) => s.path.endsWith("/FavoriteTweet")).body).variables.tweet_id, "1999");
});

test("a thread: focal post and its replies", async () => {
  const r = await x.getPost({ post: "10" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.post.text, "the post");
  assert.deepEqual(r.data.replies.map((p) => p.id), ["11"]);
});

test("profile reshapes getUser", async () => {
  const r = await x.profile({ user: "https://x.com/X" });
  assert.equal(r.data.id, "783214");
  assert.equal(r.data.followers, 10);
  assert.equal(r.data.avatar, "https://pbs.twimg.com/a_400x400.jpg");
});

test("bad input never reaches X", async () => {
  assert.throws(() => x.postId("not a post"), x.InputError);
});

test("MCP: every tool is listed, and a tool call answers", async () => {
  const server = createCrossbarServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["x_login", "x_logout", "x_whoami", "x_home_timeline", "x_search", "x_post", "x_reply", "x_quote", "x_delete_post", "x_like", "x_repost", "x_bookmark", "x_follow", "x_mute", "x_block", "x_send_dm", "x_dm_inbox", "x_notifications", "x_bookmarks"])
    assert.ok(names.includes(n), n);
  assert.equal(tools.find((t) => t.name === "x_delete_post").annotations.destructiveHint, true);
  const res = await client.callTool({ name: "x_home_timeline", arguments: { feed: "following" } });
  const body = JSON.parse(res.content[0].text);
  assert.equal(body.ok, true);
  assert.equal(body.data.posts.length, 2);
  await client.close();
});

test("MCP --read-only serves no writes", async () => {
  const server = createCrossbarServer({ readOnly: true });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(!names.includes("x_post") && names.includes("x_home_timeline"));
  await client.close();
});
