#!/usr/bin/env node
// Builds spec/x.json: api-anything's public X ops plus the signed-in ops Crossbar adds.
// Run: node scripts/build-spec.mjs
//
// The queryIds below are the last ones known to work. X rotates them. Each op marks its queryId
// as `volatile`, anchored to its operationName, so api-anything finds the new id in x.com's own
// scripts on the first 404 and heals it without a browser. A stale `features` set ("cannot be
// null") also counts as drift: api-anything then re-learns the request from x.com in your browser.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = JSON.parse(readFileSync(join(root, "spec/x.public.json"), "utf8"));

const BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

const QUERY_IDS = {
  HomeTimeline: "c-CzHF1LboFilMpsx4ZCrQ",
  HomeLatestTimeline: "BKB7oi212Fi7kQtCBGE4zA",
  SearchTimeline: "VhUd6vHVmLBcw0uX-6jMLA",
  TweetDetail: "_8aYOgEDz35BrBcBal1-_w",
  UserTweets: "Y9WM4Id6UcGFE8Z-hbnixw",
  UserTweetsAndReplies: "pz0IHaV_t7T4HJavqqqcIA",
  Likes: "fuBEtiFu3uQFuPDTsv4bfg",
  Bookmarks: "UyNF_BgJ5d5MbtuVukyl7A",
  Followers: "IOh4aS6UdGWGJUYTqliQ7Q",
  Following: "zx6e-TLzRkeDO_a7p4b3JQ",
  CreateTweet: "IID9x6WsdMnTlXnzXGq8ng",
  DeleteTweet: "VaenaVgh5q5ih7kvyVjgtg",
  FavoriteTweet: "lI07N6Otwv1PhnEgXILM7A",
  UnfavoriteTweet: "ZYKSe-w7KEslx3JhSIk5LA",
  CreateRetweet: "ojPdsZsimiJrUGLR1sjUtA",
  DeleteRetweet: "iQtK4dl5hBmXewYZuEOKVw",
  CreateBookmark: "aoDbu3RHznuiSkQ9aNM67Q",
  DeleteBookmark: "Wlmlj2-xzyS1GN3a6cj-mQ",
};

const FEATURES = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const FIELD_TOGGLES = { withArticlePlainText: false, withArticleRichContentState: false, withAuxiliaryUserLabels: false };

const SEC = {
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": UA,
};

const authHeaders = (contentType = "application/json") => ({
  accept: "*/*",
  ...SEC,
  authorization: BEARER,
  "content-type": contentType,
  origin: "https://x.com",
  referer: "https://x.com/home",
  priority: "u=1, i",
  "x-twitter-active-user": "yes",
  "x-twitter-auth-type": "OAuth2Session",
  "x-twitter-client-language": "en",
  "x-csrf-token": "{ct0}",
});

const CSRF = { ref: "cookie:ct0", at: ["header:x-csrf-token"] };
const LOGIN_NOTE = "Needs you signed in: crossbar login.";

// ---- result recipes -------------------------------------------------------------------------

const tweetPick = (P) => [
  "entryId",
  `id=${P}.rest_id`,
  `text=${P}.legacy.full_text`,
  `long_text=${P}.note_tweet.note_tweet_results.result.text`,
  `created_at=${P}.legacy.created_at`,
  `author=${P}.core.user_results.result.core.screen_name`,
  `author_name=${P}.core.user_results.result.core.name`,
  `author_id=${P}.core.user_results.result.rest_id`,
  `likes=${P}.legacy.favorite_count`,
  `reposts=${P}.legacy.retweet_count`,
  `replies=${P}.legacy.reply_count`,
  `quotes=${P}.legacy.quote_count`,
  `bookmarks=${P}.legacy.bookmark_count`,
  `views=${P}.views.count`,
  `liked=${P}.legacy.favorited`,
  `reposted=${P}.legacy.retweeted`,
  `bookmarked=${P}.legacy.bookmarked`,
  `in_reply_to=${P}.legacy.in_reply_to_status_id_str`,
  `quoted_id=${P}.legacy.quoted_status_id_str`,
  `repost_of_id=${P}.legacy.retweeted_status_result.result.rest_id`,
  `repost_of_text=${P}.legacy.retweeted_status_result.result.legacy.full_text`,
  `repost_of_author=${P}.legacy.retweeted_status_result.result.core.user_results.result.core.screen_name`,
  `media=${P}.legacy.extended_entities.media[*].media_url_https`,
  // the same post when X wraps it in TweetWithVisibilityResults
  `v_id=${P}.tweet.rest_id`,
  `v_text=${P}.tweet.legacy.full_text`,
  `v_author=${P}.tweet.core.user_results.result.core.screen_name`,
  `v_created_at=${P}.tweet.legacy.created_at`,
  "cursor=content.value",
  "cursorType=content.cursorType",
];
const TWEET = "content.itemContent.tweet_results.result";
const TIMELINE_PICK = tweetPick(TWEET);
// A thread page also holds conversation modules: their posts as parallel lists (Crossbar zips them).
const MOD = "content.items[*].item.itemContent.tweet_results.result";
const DETAIL_PICK = [
  ...TIMELINE_PICK,
  `thread_ids=${MOD}.rest_id`,
  `thread_texts=${MOD}.legacy.full_text`,
  `thread_authors=${MOD}.core.user_results.result.core.screen_name`,
  `thread_created=${MOD}.legacy.created_at`,
  `thread_likes=${MOD}.legacy.favorite_count`,
  `thread_reply_to=${MOD}.legacy.in_reply_to_status_id_str`,
  "cursor=content.value",
];
const U = "content.itemContent.user_results.result";
const USER_PICK = [
  "entryId",
  `id=${U}.rest_id`,
  `screen_name=${U}.core.screen_name`,
  `name=${U}.core.name`,
  `bio=${U}.legacy.description`,
  `bio2=${U}.profile_bio.description`,
  `followers=${U}.legacy.followers_count`,
  `following=${U}.legacy.friends_count`,
  `verified=${U}.is_blue_verified`,
  `you_follow=${U}.relationship_perspectives.following`,
  `follows_you=${U}.relationship_perspectives.followed_by`,
  "cursor=content.value",
  "cursorType=content.cursorType",
];

// ---- builders -------------------------------------------------------------------------------

const gqlPath = (name) => `/i/api/graphql/*/${name}`;
const gqlVolatile = (name, at) => ({ at, shape: { charset: "base64url", length: 22 }, anchor: name });

/** A signed-in GraphQL read sent as GET, variables and features in the query string. */
function gqlRead({ op, name, description, variables, slots, params, trigger, extract, pick }) {
  const q = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FEATURES),
    fieldToggles: JSON.stringify(FIELD_TOGGLES),
  });
  return {
    name: op,
    description: `${description} ${LOGIN_NOTE}`,
    request: {
      method: "GET",
      url: `https://x.com/i/api/graphql/${QUERY_IDS[name]}/${name}?${q}`,
      headers: authHeaders(),
    },
    slots: [CSRF, ...slots.map(([param, key]) => ({ param, at: ["query:variables", `json:/${key}`] }))],
    volatile: [gqlVolatile(name, ["path:3"])],
    trigger,
    match: { method: "GET", host: "x.com", path: gqlPath(name) },
    response: { format: "json", contentType: "application/json", extract, pick },
    params,
    readOnly: true,
    public: ["authorization"],
    minTier: 1,
    learnedLoggedIn: true,
  };
}

/** A signed-in GraphQL mutation: POST with a JSON body that also names its queryId. */
function gqlWrite({ op, name, description, variables, slots, params, trigger, extract, pick, features = true }) {
  const body = { variables, ...(features ? { features: FEATURES } : {}), queryId: QUERY_IDS[name] };
  return {
    name: op,
    description: `${description} ${LOGIN_NOTE}`,
    request: {
      method: "POST",
      url: `https://x.com/i/api/graphql/${QUERY_IDS[name]}/${name}`,
      headers: authHeaders(),
      body: JSON.stringify(body),
    },
    slots: [
      CSRF,
      ...slots.map(([param, pointer, template]) => ({
        param,
        at: ["body", `json:/variables/${pointer}`],
        ...(template ? { template } : {}),
      })),
    ],
    volatile: [gqlVolatile(name, ["path:3"]), gqlVolatile(name, ["body", "json:/queryId"])],
    trigger: { ...trigger, companions: [] },
    match: { method: "POST", host: "x.com", path: gqlPath(name) },
    response: { format: "json", contentType: "application/json", ...(extract ? { extract } : {}), ...(pick ? { pick } : {}) },
    params,
    readOnly: false,
    public: ["authorization"],
    minTier: 1,
    learnedLoggedIn: true,
  };
}

/** A signed-in v1.1 REST call. */
function rest({ op, description, method, path, query, form, json, slots, params, trigger, extract, pick, readOnly }) {
  const url = `https://x.com/i/api${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const contentType = form ? "application/x-www-form-urlencoded" : "application/json";
  const o = {
    name: op,
    description: `${description} ${LOGIN_NOTE}`,
    request: {
      method,
      url,
      headers: authHeaders(contentType),
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      ...(json ? { body: JSON.stringify(json) } : {}),
    },
    slots: [CSRF, ...slots],
    volatile: [],
    trigger: readOnly ? trigger : { ...trigger, companions: [] },
    match: { method, host: "x.com", path: `/i/api${path.replace(/\/[0-9-]+\.json$/, "/*")}` },
    response: { format: "json", contentType: "application/json", ...(extract ? { extract } : {}), ...(pick ? { pick } : {}) },
    params,
    readOnly,
    public: ["authorization"],
    minTier: 1,
    learnedLoggedIn: true,
  };
  return o;
}

// ---- params ---------------------------------------------------------------------------------

const P = {
  tweetId: { name: "tweetId", type: "string", required: true, pattern: "[0-9]{1,25}", hint: "the number at the end of a post's URL", description: "post ID: the number in x.com/<user>/status/<id>", example: "1354143047324299264" },
  userId: { name: "userId", type: "string", required: true, pattern: "[0-9]{1,25}", hint: "a numeric user id (getUser's rest_id)", description: "numeric user id; getUser screen_name=<handle> gives it as rest_id", example: "11348282" },
  text: { name: "text", type: "string", required: true, description: "the post's text (up to 280 characters; more needs X Premium)", example: "Hello from Crossbar" },
  count: { name: "count", type: "number", required: false, default: 20, min: 1, max: 100, description: "how many items to ask X for (X may return a few more or fewer)" },
  cursor: { name: "cursor", type: "string", required: false, description: "the cursor (cursorType Bottom) from the previous page's answer, for the next page" },
};

// ---- operations -----------------------------------------------------------------------------

const TL_VARS = { count: 20, cursor: null, includePromotedContent: false, latestControlAvailable: true, requestContext: "launch", withCommunity: true };
const HOME_INSTR = "data.home.home_timeline_urt.instructions[*].entries";
const USER_INSTR = "data.user.result.timeline.timeline.instructions[*].entries";

const ops = [
  rest({
    op: "me",
    description: "Who is signed in: your screen_name and account settings (language, time zone, protected).",
    method: "GET",
    path: "/1.1/account/settings.json",
    query: { include_ext_sharing_audiospaces_listening_data_with_followers: "true", include_mention_filter: "true", include_nsfw_user_flag: "true", include_nsfw_admin_flag: "true", include_ranked_timeline: "true", include_alt_text_compose: "true", ext: "ssoConnections", include_country_code: "true", include_ext_dm_nsfw_media_filter: "true" },
    slots: [],
    params: [],
    trigger: { url: "https://x.com/settings/account" },
    pick: ["screen_name", "language", "protected", "time_zone.name", "country_code", "discoverable_by_email"],
    readOnly: true,
  }),
  gqlRead({
    op: "homeTimeline",
    name: "HomeTimeline",
    description: "Your For You timeline: posts with text, author, counts and whether you liked/reposted/bookmarked them. Paged by cursor.",
    variables: TL_VARS,
    slots: [["count", "count"], ["cursor", "cursor"]],
    params: [P.count, P.cursor],
    trigger: { url: "https://x.com/home" },
    extract: HOME_INSTR,
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "latestTimeline",
    name: "HomeLatestTimeline",
    description: "Your Following timeline, newest first (only accounts you follow). Paged by cursor.",
    variables: { ...TL_VARS, seenTweetIds: [] },
    slots: [["count", "count"], ["cursor", "cursor"]],
    params: [P.count, P.cursor],
    trigger: { url: "https://x.com/home", steps: [{ action: "click", selector: 'a[role="tab"]:has-text("Following")' }, { action: "wait", ms: 2500 }] },
    extract: HOME_INSTR,
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "searchPosts",
    name: "SearchTimeline",
    description: "Search posts on X with X's search syntax (from:user, since:2026-01-01, filter:media, lang:en, \"exact phrase\"). product Top, Latest or Media.",
    variables: { rawQuery: "crossbar", count: 20, cursor: null, querySource: "typed_query", product: "Top" },
    slots: [["query", "rawQuery"], ["count", "count"], ["cursor", "cursor"], ["product", "product"]],
    params: [
      { name: "query", type: "string", required: true, description: "search words, with X's operators if wanted", example: "sqlite" },
      { name: "product", type: "string", required: false, default: "Latest", enum: ["Top", "Latest", "Media"], description: "Top (popular), Latest (newest first) or Media" },
      P.count,
      P.cursor,
    ],
    trigger: { url: "https://x.com/search?q={query}&src=typed_query&f=live" },
    extract: "data.search_by_raw_query.search_timeline.timeline.instructions[*].entries",
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "searchPeople",
    name: "SearchTimeline",
    description: "Search accounts on X by name, handle or bio words.",
    variables: { rawQuery: "crossbar", count: 20, cursor: null, querySource: "typed_query", product: "People" },
    slots: [["query", "rawQuery"], ["count", "count"], ["cursor", "cursor"]],
    params: [{ name: "query", type: "string", required: true, description: "name, handle or words", example: "nasa" }, P.count, P.cursor],
    trigger: { url: "https://x.com/search?q={query}&src=typed_query&f=user" },
    extract: "data.search_by_raw_query.search_timeline.timeline.instructions[*].entries",
    pick: USER_PICK,
  }),
  gqlRead({
    op: "getThread",
    name: "TweetDetail",
    description: "A post with its thread and replies (signed in, so replies are included). thread_* lists hold the replies in each conversation module.",
    variables: { focalTweetId: "1354143047324299264", with_rux_injections: false, rankingMode: "Relevance", includePromotedContent: false, withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true, cursor: null },
    slots: [["tweetId", "focalTweetId"], ["cursor", "cursor"]],
    params: [P.tweetId, P.cursor],
    trigger: { url: "https://x.com/i/status/{tweetId}" },
    extract: "data.threaded_conversation_with_injections_v2.instructions[*].entries",
    pick: DETAIL_PICK,
  }),
  gqlRead({
    op: "userTweets",
    name: "UserTweets",
    description: "An account's posts by numeric user id, newest first (pinned post first). Paged by cursor.",
    variables: { userId: "11348282", count: 20, cursor: null, includePromotedContent: false, withQuickPromoteEligibilityTweetFields: true, withVoice: true },
    slots: [["userId", "userId"], ["count", "count"], ["cursor", "cursor"]],
    params: [P.userId, P.count, P.cursor],
    trigger: { url: "https://x.com/i/user/{userId}" },
    extract: USER_INSTR,
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "userReplies",
    name: "UserTweetsAndReplies",
    description: "An account's posts and replies by numeric user id. Paged by cursor.",
    variables: { userId: "11348282", count: 20, cursor: null, includePromotedContent: false, withCommunity: true, withVoice: true },
    slots: [["userId", "userId"], ["count", "count"], ["cursor", "cursor"]],
    params: [P.userId, P.count, P.cursor],
    trigger: { url: "https://x.com/i/user/{userId}", steps: [{ action: "click", selector: 'a[role="tab"][href$="/with_replies"]' }, { action: "wait", ms: 2500 }] },
    extract: USER_INSTR,
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "likedPosts",
    name: "Likes",
    description: "Posts an account liked (X shows likes only for your own account). Paged by cursor.",
    variables: { userId: "11348282", count: 20, cursor: null, includePromotedContent: false, withClientEventToken: false, withBirdwatchNotes: false, withVoice: true },
    slots: [["userId", "userId"], ["count", "count"], ["cursor", "cursor"]],
    params: [P.userId, P.count, P.cursor],
    trigger: { url: "https://x.com/i/user/{userId}", steps: [{ action: "click", selector: 'a[role="tab"][href$="/likes"]' }, { action: "wait", ms: 2500 }] },
    extract: USER_INSTR,
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "bookmarks",
    name: "Bookmarks",
    description: "Your bookmarked posts, newest bookmark first. Paged by cursor.",
    variables: { count: 20, cursor: null, includePromotedContent: false },
    slots: [["count", "count"], ["cursor", "cursor"]],
    params: [P.count, P.cursor],
    trigger: { url: "https://x.com/i/bookmarks" },
    extract: "data.bookmark_timeline_v2.timeline.instructions[*].entries",
    pick: TIMELINE_PICK,
  }),
  gqlRead({
    op: "followers",
    name: "Followers",
    description: "Accounts that follow a user (numeric user id). Paged by cursor.",
    variables: { userId: "11348282", count: 20, cursor: null, includePromotedContent: false },
    slots: [["userId", "userId"], ["count", "count"], ["cursor", "cursor"]],
    params: [P.userId, P.count, P.cursor],
    trigger: { url: "https://x.com/i/user/{userId}", steps: [{ action: "click", selector: 'a[href$="/followers"]' }, { action: "wait", ms: 2500 }] },
    extract: USER_INSTR,
    pick: USER_PICK,
  }),
  gqlRead({
    op: "following",
    name: "Following",
    description: "Accounts a user follows (numeric user id). Paged by cursor.",
    variables: { userId: "11348282", count: 20, cursor: null, includePromotedContent: false },
    slots: [["userId", "userId"], ["count", "count"], ["cursor", "cursor"]],
    params: [P.userId, P.count, P.cursor],
    trigger: { url: "https://x.com/i/user/{userId}", steps: [{ action: "click", selector: 'a[href$="/following"]' }, { action: "wait", ms: 2500 }] },
    extract: USER_INSTR,
    pick: USER_PICK,
  }),
  rest({
    op: "notifications",
    description: "Your notifications (likes, reposts, follows, mentions): each one's message text and time.",
    method: "GET",
    path: "/2/notifications/all.json",
    query: { include_profile_interstitial_type: "1", include_blocking: "1", include_blocked_by: "1", include_followed_by: "1", include_want_retweets: "1", include_mute_edge: "1", include_can_dm: "1", include_can_media_tag: "1", include_ext_is_blue_verified: "1", skip_status: "1", cards_platform: "Web-12", include_cards: "1", include_ext_alt_text: "true", include_quote_count: "true", include_reply_count: "1", tweet_mode: "extended", include_entities: "true", include_user_entities: "true", include_ext_media_color: "true", include_ext_media_availability: "true", send_error_codes: "true", simple_quoted_tweet: "true", count: "20", ext: "mediaStats,highlightedLabel,voiceInfo" },
    slots: [{ param: "count", at: ["query:count"] }],
    params: [P.count],
    trigger: { url: "https://x.com/notifications" },
    extract: "globalObjects.notifications",
    readOnly: true,
  }),
  rest({
    op: "mentions",
    description: "Posts that mention you (the Mentions tab of notifications).",
    method: "GET",
    path: "/2/notifications/mentions.json",
    query: { include_profile_interstitial_type: "1", include_blocking: "1", include_blocked_by: "1", include_followed_by: "1", include_can_dm: "1", skip_status: "1", cards_platform: "Web-12", include_cards: "1", include_quote_count: "true", include_reply_count: "1", tweet_mode: "extended", include_entities: "true", send_error_codes: "true", simple_quoted_tweet: "true", count: "20" },
    slots: [{ param: "count", at: ["query:count"] }],
    params: [P.count],
    trigger: { url: "https://x.com/notifications/mentions" },
    extract: "globalObjects.tweets",
    readOnly: true,
  }),
  rest({
    op: "dmInbox",
    description: "Your direct-message inbox: the latest messages with conversation_id, sender id, text and time.",
    method: "GET",
    path: "/1.1/dm/inbox_initial_state.json",
    query: { nsfw_filtering_enabled: "false", filter_low_quality: "true", include_quality: "all", include_profile_interstitial_type: "1", include_blocking: "1", include_blocked_by: "1", include_followed_by: "1", include_can_dm: "1", skip_status: "1", dm_secret_conversations_enabled: "false", cards_platform: "Web-12", include_cards: "1", include_ext_alt_text: "true", include_quote_count: "true", include_reply_count: "1", tweet_mode: "extended", include_ext_collab_control: "true", dm_users: "true", include_groups: "true", include_inbox_timelines: "true", include_ext_media_color: "true", supports_reactions: "true", supports_edit: "true", include_ext_edit_control: "true" },
    slots: [],
    params: [],
    trigger: { url: "https://x.com/messages" },
    extract: "inbox_initial_state.entries",
    pick: ["conversation_id=message.conversation_id", "message_id=message.id", "sender_id=message.message_data.sender_id", "recipient_id=message.message_data.recipient_id", "text=message.message_data.text", "time=message.message_data.time"],
    readOnly: true,
  }),
  rest({
    op: "dmConversation",
    description: "Messages in one DM conversation (conversation_id from dmInbox), newest first.",
    method: "GET",
    path: "/1.1/dm/conversation/11348282-783214.json",
    query: { context: "FETCH_DM_CONVERSATION", include_profile_interstitial_type: "1", include_blocking: "1", include_blocked_by: "1", include_followed_by: "1", include_can_dm: "1", skip_status: "1", dm_secret_conversations_enabled: "false", cards_platform: "Web-12", include_cards: "1", tweet_mode: "extended", dm_users: "false", include_groups: "true", include_conversation_info: "true", supports_reactions: "true", supports_edit: "true" },
    slots: [{ param: "conversationId", at: ["path:5"], template: "{conversationId}.json" }],
    params: [{ name: "conversationId", type: "string", required: true, pattern: "[0-9]+(-[0-9]+)?", hint: "like 123-456 for a 1:1 chat, or a group's number", description: "conversation_id from dmInbox", example: "11348282-783214" }],
    trigger: { url: "https://x.com/messages/{conversationId}" },
    extract: "conversation_timeline.entries",
    pick: ["message_id=message.id", "sender_id=message.message_data.sender_id", "text=message.message_data.text", "time=message.message_data.time"],
    readOnly: true,
  }),

  // ---- writes ----
  gqlWrite({
    op: "createPost",
    name: "CreateTweet",
    description: "Post to X from your account. Returns the new post's id.",
    variables: { tweet_text: "Hello from Crossbar", dark_request: false, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [], disallowed_reply_options: null },
    slots: [["text", "tweet_text"]],
    params: [P.text],
    trigger: { url: "https://x.com/compose/post", steps: [{ action: "fill", selector: '[data-testid="tweetTextarea_0"]', value: "{text}" }, { action: "click", selector: '[data-testid="tweetButton"]' }] },
    extract: "data.create_tweet.tweet_results.result",
    pick: ["id=rest_id", "text=legacy.full_text", "created_at=legacy.created_at"],
  }),
  gqlWrite({
    op: "reply",
    name: "CreateTweet",
    description: "Reply to a post from your account. Returns the reply's id.",
    variables: { tweet_text: "Nice post", reply: { in_reply_to_tweet_id: "1354143047324299264", exclude_reply_user_ids: [] }, dark_request: false, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [], disallowed_reply_options: null },
    slots: [["text", "tweet_text"], ["tweetId", "reply/in_reply_to_tweet_id"]],
    params: [P.text, P.tweetId],
    trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "fill", selector: '[data-testid="tweetTextarea_0"]', value: "{text}" }, { action: "click", selector: '[data-testid="tweetButtonInline"]' }] },
    extract: "data.create_tweet.tweet_results.result",
    pick: ["id=rest_id", "text=legacy.full_text", "in_reply_to=legacy.in_reply_to_status_id_str"],
  }),
  gqlWrite({
    op: "quotePost",
    name: "CreateTweet",
    description: "Quote a post with your own text. Returns the new post's id.",
    variables: { tweet_text: "Worth reading", attachment_url: "https://x.com/i/status/1354143047324299264", dark_request: false, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [], disallowed_reply_options: null },
    slots: [["text", "tweet_text"], ["tweetId", "attachment_url", "https://x.com/i/status/{tweetId}"]],
    params: [P.text, P.tweetId],
    trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: 'article [data-testid="retweet"]' }, { action: "click", selector: 'a[role="menuitem"][href*="compose"]' }, { action: "fill", selector: '[data-testid="tweetTextarea_0"]', value: "{text}" }, { action: "click", selector: '[data-testid="tweetButton"]' }] },
    extract: "data.create_tweet.tweet_results.result",
    pick: ["id=rest_id", "text=legacy.full_text", "quoted_id=legacy.quoted_status_id_str"],
  }),
  gqlWrite({
    op: "deletePost",
    name: "DeleteTweet",
    description: "Delete one of your own posts. Permanent.",
    variables: { tweet_id: "1354143047324299264", dark_request: false },
    slots: [["tweetId", "tweet_id"]],
    params: [P.tweetId],
    features: false,
    trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: 'article [data-testid="caret"]' }, { action: "click", selector: '[role="menuitem"]:has-text("Delete")' }, { action: "click", selector: '[data-testid="confirmationSheetConfirm"]' }] },
  }),
  ...[
    ["like", "FavoriteTweet", "Like a post.", "like"],
    ["unlike", "UnfavoriteTweet", "Remove your like from a post.", "unlike"],
  ].map(([op, name, description, testid]) =>
    gqlWrite({
      op, name, description,
      variables: { tweet_id: "1354143047324299264" },
      slots: [["tweetId", "tweet_id"]],
      params: [P.tweetId],
      features: false,
      trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: `article [data-testid="${testid}"]` }] },
    }),
  ),
  gqlWrite({
    op: "repost",
    name: "CreateRetweet",
    description: "Repost (retweet) a post.",
    variables: { tweet_id: "1354143047324299264", dark_request: false },
    slots: [["tweetId", "tweet_id"]],
    params: [P.tweetId],
    features: false,
    trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: 'article [data-testid="retweet"]' }, { action: "click", selector: '[data-testid="retweetConfirm"]' }] },
  }),
  gqlWrite({
    op: "undoRepost",
    name: "DeleteRetweet",
    description: "Undo your repost of a post (give the original post's id).",
    variables: { source_tweet_id: "1354143047324299264", dark_request: false },
    slots: [["tweetId", "source_tweet_id"]],
    params: [P.tweetId],
    features: false,
    trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: 'article [data-testid="unretweet"]' }, { action: "click", selector: '[data-testid="unretweetConfirm"]' }] },
  }),
  ...[
    ["bookmark", "CreateBookmark", "Bookmark a post (private to you).", "bookmark"],
    ["removeBookmark", "DeleteBookmark", "Remove a post from your bookmarks.", "removeBookmark"],
  ].map(([op, name, description, testid]) =>
    gqlWrite({
      op, name, description,
      variables: { tweet_id: "1354143047324299264" },
      slots: [["tweetId", "tweet_id"]],
      params: [P.tweetId],
      features: false,
      trigger: { url: "https://x.com/i/status/{tweetId}", steps: [{ action: "click", selector: `article [data-testid="${testid}"]` }] },
    }),
  ),
  ...[
    ["follow", "/1.1/friendships/create.json", "Follow an account (numeric user id).", '[data-testid$="-follow"]'],
    ["unfollow", "/1.1/friendships/destroy.json", "Unfollow an account (numeric user id).", '[data-testid$="-unfollow"]'],
    ["mute", "/1.1/mutes/users/create.json", "Mute an account: its posts leave your timelines; it isn't told.", null],
    ["unmute", "/1.1/mutes/users/destroy.json", "Unmute an account.", null],
    ["block", "/1.1/blocks/create.json", "Block an account: it can't see your posts or contact you.", null],
    ["unblock", "/1.1/blocks/destroy.json", "Unblock an account.", null],
  ].map(([op, path, description, button]) =>
    rest({
      op, description, path,
      method: "POST",
      form: { include_profile_interstitial_type: "1", include_blocking: "1", include_blocked_by: "1", include_followed_by: "1", include_want_retweets: "1", include_mute_edge: "1", include_can_dm: "1", include_can_media_tag: "1", include_ext_is_blue_verified: "1", include_ext_verified_type: "1", include_ext_profile_image_shape: "1", skip_status: "1", user_id: "11348282" },
      slots: [{ param: "userId", at: ["form:user_id"] }],
      params: [P.userId],
      trigger: button
        ? { url: "https://x.com/i/user/{userId}", steps: [{ action: "click", selector: button }, ...(op === "unfollow" ? [{ action: "click", selector: '[data-testid="confirmationSheetConfirm"]' }] : [])] }
        : { url: "https://x.com/i/user/{userId}" },
      pick: ["id=id_str", "screen_name", "name", "following", "muting", "blocking"],
      readOnly: false,
    }),
  ),
  rest({
    op: "sendDM",
    description: "Send a direct message in an existing conversation (conversation_id from dmInbox; a 1:1 chat is <smallerUserId>-<largerUserId>).",
    method: "POST",
    path: "/1.1/dm/new2.json",
    query: { ext: "mediaColor,altText,mediaStats,highlightedLabel,voiceInfo,birdwatchPivot,superFollowMetadata,unmentionInfo,editControl,article", include_ext_alt_text: "true", include_reply_count: "1", tweet_mode: "extended", include_groups: "true", include_inbox_timelines: "true", include_conversation_info: "true", supports_reactions: "true", supports_edit: "true" },
    json: { conversation_id: "11348282-783214", recipient_ids: false, request_id: "00000000-0000-4000-8000-000000000000", text: "Hi from Crossbar", cards_platform: "Web-12", include_cards: 1, include_quote_count: true, dm_users: false },
    slots: [
      { param: "conversationId", at: ["body", "json:/conversation_id"] },
      { param: "text", at: ["body", "json:/text"] },
      { gen: "uuid", at: ["body", "json:/request_id"] },
    ],
    params: [
      { name: "conversationId", type: "string", required: true, pattern: "[0-9]+(-[0-9]+)?", hint: "like 123-456 for a 1:1 chat", description: "conversation_id from dmInbox", example: "11348282-783214" },
      { name: "text", type: "string", required: true, description: "the message", example: "Hi" },
    ],
    trigger: { url: "https://x.com/messages/{conversationId}", steps: [{ action: "fill", selector: '[data-testid="dmComposerTextInput"]', value: "{text}" }, { action: "click", selector: '[data-testid="dmComposerSendButton"]' }] },
    extract: "entries[0].message",
    pick: ["message_id=id", "conversation_id", "text=message_data.text", "time=message_data.time"],
    readOnly: false,
  }),
];

// getUser's rest_id feeds every op that takes a userId.
const pubOps = pub.operations.map((o) =>
  o.name === "getUser"
    ? { ...o, links: ["userTweets", "userReplies", "likedPosts", "followers", "following", "follow", "unfollow", "mute", "unmute", "block", "unblock"].map((op) => ({ from: "rest_id", to: { op, arg: "userId" } })) }
    : o,
);

const site = {
  name: "x",
  displayName: "X (Twitter)",
  baseUrl: "https://x.com",
  description:
    "X (Twitter) for your own account via Crossbar: home and following timelines, search, threads, profiles, bookmarks, likes, followers, notifications and DMs; and post, reply, quote, delete, like, repost, bookmark, follow, mute, block and DM. Public profiles and posts work signed out.",
  loginCookies: ["auth_token", "twid"],
  operations: [...pubOps, ...ops],
};

writeFileSync(join(root, "spec/x.json"), `${JSON.stringify(site, null, 2)}\n`);
console.log(`spec/x.json: ${site.operations.length} operations (${site.operations.filter((o) => !o.readOnly).length} writes)`);
