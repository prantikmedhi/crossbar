// Crossbar's MCP server: your X account as tools for Claude, Cursor, Codex, VS Code and any MCP client.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as x from "./x.mjs";

const VERSION = "0.1.0";

const post = z.string().describe("post id, or its URL (https://x.com/<user>/status/<id>)");
const user = z.string().describe("@handle, handle, profile URL, or numeric user id");
const count = z.number().int().min(1).max(100).optional().describe("how many (default 20)");
const cursor = z.string().optional().describe("next_cursor from the previous answer, for the next page");
const again = z.boolean().optional().describe("send even though the same text was sent in the last 10 minutes; only after checking x.com that it is not there");

const READ = { readOnlyHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const DESTROY = { readOnlyHint: false, destructiveHint: true, openWorldHint: true };

function text(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 1) }], ...(value?.ok === false ? { isError: true } : {}) };
}

async function guarded(fn) {
  try {
    return text(await fn());
  } catch (e) {
    return text({ ok: false, class: e instanceof x.InputError ? "input" : "error", reason: e?.message ?? String(e) });
  }
}

export function createCrossbarServer({ readOnly = false } = {}) {
  const server = new McpServer(
    { name: "crossbar", version: VERSION },
    {
      instructions:
        "Crossbar is the user's own X (Twitter) account. Start with x_whoami; if it answers class auth, call x_login. " +
        "Writes (x_post, x_reply, x_like, x_follow, x_send_dm, ...) act as the user on x.com: post exactly the text the user approved, never invent it. " +
        "A write's `write` field says what happened: only `applied` is proven; after `accepted` or `may_have_applied` do not send it again. " +
        "Lists are paged: pass next_cursor back as cursor.",
    },
  );
  const tool = (name, title, description, shape, annotations, fn) =>
    server.registerTool(name, { title, description, inputSchema: shape, annotations: { title, ...annotations } }, (args) => guarded(() => fn(args)));

  // ---- account ----
  tool("x_login", "Sign in to X",
    "Sign in to the user's X account. Default: import the session from the browser they already use (Chrome, Edge, Brave, Arc, Vivaldi, Chromium), so no password or 2FA. method 'window' opens a browser window to sign in by hand.",
    { method: z.enum(["browser", "window"]).optional(), profile: z.string().optional().describe('browser profile when several are signed in, e.g. "Chrome/Profile 1"') },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    ({ method, profile }) => x.login({ window: method === "window", profile }));
  tool("x_logout", "Sign out of X",
    "Forget Crossbar's copy of the X session. The user's own browser stays signed in.",
    {}, { readOnlyHint: false, destructiveHint: true, openWorldHint: false }, () => x.logout());
  tool("x_whoami", "Who is signed in", "The signed-in X account: handle, name, id, follower counts.", {}, READ, () => x.whoami());

  // ---- reading ----
  tool("x_home_timeline", "Home timeline", "The user's home timeline. feed for_you (X's picks) or following (accounts they follow, newest first).",
    { feed: z.enum(["for_you", "following"]).optional(), count, cursor }, READ, (a) => x.home(a));
  tool("x_search", "Search X", "Search posts (mode top, latest, media) or people. Posts take X's operators: from:user to:user since:2026-01-01 until: filter:media lang:en \"exact phrase\" -word min_faves:100.",
    { query: z.string(), mode: z.enum(["latest", "top", "media", "people"]).optional(), count, cursor }, READ, (a) => x.search(a));
  tool("x_get_post", "Read a post", "One post with the thread above it and its replies.", { post, cursor }, READ, (a) => x.getPost(a));
  tool("x_user_profile", "User profile", "An account's profile: name, bio, location, followers, following, post count, join date.", { user }, READ, (a) => x.profile(a));
  tool("x_user_posts", "User's posts", "An account's posts, newest first; include_replies adds their replies.",
    { user, include_replies: z.boolean().optional(), count, cursor }, READ, ({ include_replies, ...a }) => x.userPosts({ ...a, replies: include_replies }));
  tool("x_likes", "Liked posts", "Posts the signed-in user liked (X shows likes only for your own account).", { count, cursor }, READ, (a) => x.likes(a));
  tool("x_bookmarks", "Bookmarks", "The signed-in user's bookmarked posts.", { count, cursor }, READ, (a) => x.bookmarks(a));
  tool("x_followers", "Followers", "Who follows an account (default: the signed-in user).", { user: user.optional(), count, cursor }, READ, (a) => x.people({ ...a, which: "followers" }));
  tool("x_following", "Following", "Who an account follows (default: the signed-in user).", { user: user.optional(), count, cursor }, READ, (a) => x.people({ ...a, which: "following" }));
  tool("x_notifications", "Notifications", "Recent notifications: likes, reposts, follows, replies.", { count }, READ, (a) => x.notifications(a));
  tool("x_mentions", "Mentions", "Recent posts that mention the signed-in user.", { count }, READ, (a) => x.mentions(a));
  tool("x_dm_inbox", "DM inbox", "Direct-message conversations with their latest message and conversation_id.", {}, READ, () => x.dmInbox());
  tool("x_dm_conversation", "DM conversation", "Messages in one DM conversation.", { conversation_id: z.string() }, READ, (a) => x.dmConversation(a));

  if (readOnly) return server;

  // ---- writing ----
  tool("x_post", "Post to X", "Publish a post from the user's account. Use the exact text the user approved.",
    { text: z.string().min(1).describe("the post (280 characters, more with X Premium)"), again }, WRITE, (a) => x.createPost(a));
  tool("x_reply", "Reply", "Reply to a post from the user's account.", { post, text: z.string().min(1), again }, WRITE, (a) => x.reply(a));
  tool("x_quote", "Quote post", "Quote a post with the user's own text.", { post, text: z.string().min(1), again }, WRITE, (a) => x.quote(a));
  tool("x_delete_post", "Delete post", "Permanently delete one of the user's own posts. Confirm with the user first.", { post }, DESTROY, (a) => x.deletePost(a));
  tool("x_like", "Like", "Like a post, or remove the like with undo.", { post, undo: z.boolean().optional() }, WRITE, (a) => x.toggle({ ...a, action: "like" }));
  tool("x_repost", "Repost", "Repost (retweet) a post, or undo it.", { post, undo: z.boolean().optional() }, WRITE, (a) => x.toggle({ ...a, action: "repost" }));
  tool("x_bookmark", "Bookmark", "Bookmark a post, or remove the bookmark with undo.", { post, undo: z.boolean().optional() }, WRITE, (a) => x.toggle({ ...a, action: "bookmark" }));
  tool("x_follow", "Follow", "Follow an account, or unfollow with undo.", { user, undo: z.boolean().optional() }, WRITE, (a) => x.relate({ ...a, action: "follow" }));
  tool("x_mute", "Mute", "Mute an account (it isn't told), or unmute with undo.", { user, undo: z.boolean().optional() }, WRITE, (a) => x.relate({ ...a, action: "mute" }));
  tool("x_block", "Block", "Block an account, or unblock with undo. Confirm with the user first.", { user, undo: z.boolean().optional() }, DESTROY, (a) => x.relate({ ...a, action: "block" }));
  tool("x_send_dm", "Send DM", "Send a direct message: to a user (@handle) or into a conversation_id from x_dm_inbox.",
    { text: z.string().min(1), user: user.optional(), conversation_id: z.string().optional(), again }, WRITE, (a) => x.sendDM(a));

  return server;
}

export async function serve(opts) {
  x.installSpec();
  const server = createCrossbarServer(opts);
  await server.connect(new StdioServerTransport());
}
