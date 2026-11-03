# Crossbar

**Your own X (Twitter) account as an MCP server and a CLI, on Linux, macOS and Windows.**

Your agents (Claude Code, Claude Desktop, Cursor, VS Code, Codex, Gemini CLI) get tools to read
your timeline, search, read threads, and post, reply, like, repost, bookmark, follow, mute, block
and DM, all as you. The same commands work from your terminal.

No X developer account, no API key, no monthly API bill. Crossbar is built on
[api-anything](https://github.com/goodnight000/api-anything). It sends the same requests
x.com's own web app sends, with the session from the browser you're already signed in with,
from your own machine.

```text
you> what's new from people I follow? reply to the best one with "great thread"
claude> [x_home_timeline feed=following] ... [x_reply post=1985... text="great thread"]
        ✓ replied  https://x.com/i/status/1985...
```

## Install

Needs **Node 22.13+** and, for signing in and the browser fallback, a Chromium-based browser
(Chrome, Edge, Brave, Arc, Vivaldi or Chromium).

**macOS / Linux**

```bash
./install.sh
```

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Or by hand, on any OS:

```bash
npm install -g .
```

```bash
crossbar setup
```

```bash
crossbar login
```

`crossbar setup` puts the X spec in `~/.api-anything/sites/x.json` and connects the MCP server to
every client it finds. It uses `claude mcp add`, `codex mcp add`, `gemini mcp add` and
`code --add-mcp`, and edits Claude Desktop's and Cursor's JSON configs. It backs up each config
file to `*.bak-crossbar` before the first edit, and `--dry-run` shows what it would change.
After setup, restart your agent.

## Sign in and out

| | |
|---|---|
| `crossbar login` | imports your x.com session from your everyday browser, so there's no password and no 2FA again. Sign in to x.com there first. |
| `crossbar login --profile "Chrome/Profile 1"` | picks the browser profile when several are signed in |
| `crossbar login --window` | opens a browser window to sign in by hand (2FA, captchas) |
| `crossbar login --cookies cookies.txt` | imports a cookies.txt or Cookie-Editor JSON export (headless servers) |
| `crossbar logout` | forgets Crossbar's copy of the session. Your browser stays signed in. |
| `crossbar whoami` | shows the account you're signed in as |

The session is kept in `~/.api-anything/` on your machine (0600). It's the **same** session as your
browser's: signing out of X in the browser signs Crossbar out too. Then run `crossbar login` again.

## MCP tools

| Read | Write (acts as you) |
|---|---|
| `x_whoami` | `x_post` |
| `x_home_timeline` (for_you / following) | `x_reply` |
| `x_search` (latest / top / media / people, X's operators) | `x_quote` |
| `x_get_post` (post + thread + replies) | `x_delete_post` ⚠ |
| `x_user_profile` | `x_like` (`undo` unlikes) |
| `x_user_posts` (`include_replies`) | `x_repost` (`undo`) |
| `x_likes`, `x_bookmarks` | `x_bookmark` (`undo`) |
| `x_followers`, `x_following` | `x_follow` (`undo` unfollows) |
| `x_notifications`, `x_mentions` | `x_mute`, `x_block` ⚠ (`undo`) |
| `x_dm_inbox`, `x_dm_conversation` | `x_send_dm` (to `@user` or a conversation) |
| `x_login`, `x_logout` | |

Posts accept an id or a URL. Users accept `@handle`, a profile URL or a numeric id. Lists are
paged: pass `next_cursor` back as `cursor`. Write tools are marked as writes (and ⚠ destructive)
in MCP, so your client asks before running them. To give an agent reads only:

```bash
crossbar setup --read-only
```

To add it to a client by hand:

```bash
crossbar mcp --print-config
```

## CLI

```bash
crossbar home --following
crossbar search "from:nasa moon" --mode latest
crossbar read https://x.com/jack/status/20
crossbar profile @nasa
crossbar posts @nasa --replies
crossbar post "Hello from Crossbar"
crossbar reply 1985000000000000000 "Agreed"
crossbar like <post> --undo
crossbar follow @nasa
crossbar dm @friend "hey"
crossbar dms
crossbar notifications
```

Run `crossbar --help` to list every command. Add `--json` to print the raw answer.

## How it works, and what happens when X changes

Crossbar's `spec/x.json` describes 36 X operations in api-anything's format: X's GraphQL and
v1.1 endpoints, with `cookie:ct0` → `x-csrf-token` and your cookies filled in per call. The spec
holds no credentials. Each call goes through api-anything's tier ladder:

1. **Plain HTTPS** from Node (fast, about 0.2–1 s).
2. If X blocks that: `fetch` from inside a real browser page.
3. If X needs its own per-request signature (`x-client-transaction-id`): Crossbar runs the action
   in x.com itself in your browser profile. For a post, it opens the composer, types your text and
   clicks Post. It's slower but works whatever X requires.

When X rotates a GraphQL `queryId` (it does every few weeks), the first call gets a 404. api-anything
then finds the new id in x.com's scripts, replays the call, and saves the fix, all without a browser.
When X changes the `features` it requires, api-anything re-learns the request from x.com in your
browser. Use `crossbar status` to see each operation's health. If a heal goes wrong:

```bash
npx api-anything revert x <op>
```

```bash
crossbar install --force
```

The first command undoes the last heal of one operation. The second puts Crossbar's spec back.

The `queryId`s and features in the spec were the last ones known to work. They were written by hand
and haven't been run against live x.com yet, so expect the first calls of some ops to heal
themselves. If one keeps failing, re-learn it from your signed-in browser with api-anything's own
learner, e.g. for posting:

```bash
npx api-anything add x createPost --write --trigger https://x.com/compose/post --example text="test one" --example2 text="test two" --steps '[{"action":"fill","selector":"[data-testid=\"tweetTextarea_0\"]","value":"{text}"},{"action":"click","selector":"[data-testid=\"tweetButton\"]"}]'
```

`--write` stops the request in the browser, so learning never posts anything.

## Not covered (yet)

- Images and video in posts (X's chunked media upload), polls, scheduled posts, Spaces
- Editing a post, pinning, lists, communities, profile editing
- Starting a DM with someone who has no conversation with you yet (X's web app makes one first)

## Be a good citizen

This is your own account, driven at human pace. api-anything waits about 1 s between calls to a
site and backs off on rate limits. X's terms restrict automation: don't use it for spam, bulk
following, or anything you wouldn't do by hand. Your account is your responsibility.

## Develop

```bash
npm test
```

`npm test` runs 50 offline tests against api-anything (no network). After editing the spec
generator, run `npm run build:spec`.

MIT licensed.
