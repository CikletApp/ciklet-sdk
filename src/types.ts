// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — Types
// Type surface of the iframe <-> Ciklet client RPC protocol
// ─────────────────────────────────────────────────────────────────

/* ── Enums ───────────────────────────────────────── */

export enum RPCCloseCodes {
  CLOSE_NORMAL = 1000,
  CLOSE_UNSUPPORTED = 1003,
  CLOSE_ABNORMAL = 1006,
  INVALID_CLIENTID = 4000,
  INVALID_ORIGIN = 4001,
  RATELIMITED = 4002,
  TOKEN_REVOKED = 4003,
  INVALID_VERSION = 4004,
  INVALID_ENCODING = 4005,
}

/**
 * Codes carried by {@link RPCError} when the host REJECTS a command.
 *
 * This is the single source of truth: the web, desktop and mobile hosts all
 * speak these numbers, so add a case here before implementing it in a host.
 *
 * NOT the same namespace as {@link RPCCloseCodes}. Those describe why a
 * CONNECTION closed; these describe why one command failed. The overlap is
 * genuinely confusing — `4002` is `RATELIMITED` as a close code but
 * `INVALID_ARGUMENT` as an error code, and rate limiting on a command is
 * `TOO_MANY_REQUESTS` (4029). Read the type, not the number.
 */
export enum RPCErrorCodes {
  /** Host does not recognise the command at all. */
  UNKNOWN_COMMAND = 1001,
  /**
   * Host recognises the command but cannot serve it on this platform — e.g.
   * `FETCH_EXTERNAL` on the plain web client, which has no native layer.
   * Treat it as permanent for the session and stop retrying.
   */
  UNSUPPORTED_ON_CLIENT = 1002,
  /** Authorization rejected, or the supplied token is invalid. */
  UNAUTHORIZED = 4001,
  /**
   * The current user cannot do this right now — e.g. OPEN_INVITE_DIALOG while
   * the user is no longer in the activity session (left, kicked, or the
   * session ended). Re-check state before retrying.
   */
  NOT_PERMITTED = 4005,
  /** Argument failed validation — e.g. a non-http(s) URL for OPEN_EXTERNAL_LINK. */
  INVALID_ARGUMENT = 4002,
  /**
   * The target is not on this activity's allowlist. Also returned when a
   * redirect lands outside it, so a permitted first hop cannot be used to
   * reach somewhere else.
   */
  NOT_ALLOWED = 4003,
  /** The native layer tried and failed: network error, or the host's timeout. */
  FETCH_FAILED = 4004,
  /** Rate limit for this activity exceeded. Back off; do not retry immediately. */
  TOO_MANY_REQUESTS = 4029,
}

export enum RPCCommands {
  AUTHORIZE = "AUTHORIZE",
  AUTHENTICATE = "AUTHENTICATE",
  GET_CHANNEL = "GET_CHANNEL",
  GET_INSTANCE_CONNECTED_PARTICIPANTS = "GET_INSTANCE_CONNECTED_PARTICIPANTS",
  SET_ACTIVITY = "SET_ACTIVITY",
  OPEN_EXTERNAL_LINK = "OPEN_EXTERNAL_LINK",
  FETCH_EXTERNAL = "FETCH_EXTERNAL",
  OPEN_INVITE_DIALOG = "OPEN_INVITE_DIALOG",
  GET_PLATFORM_BEHAVIORS = "GET_PLATFORM_BEHAVIORS",
  SET_CONFIG = "SET_CONFIG",
  CAPTURE_LOG = "CAPTURE_LOG",
  USER_SETTINGS_GET_LOCALE = "USER_SETTINGS_GET_LOCALE",
}

export enum RPCEvents {
  READY = "READY",
  ERROR = "ERROR",
  ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE = "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE",
  ACTIVITY_LAYOUT_MODE_UPDATE = "ACTIVITY_LAYOUT_MODE_UPDATE",
  ORIENTATION_UPDATE = "ORIENTATION_UPDATE",
  CURRENT_USER_UPDATE = "CURRENT_USER_UPDATE",
  THERMAL_STATE_UPDATE = "THERMAL_STATE_UPDATE",
  /**
   * The host hid or re-showed the activity without unloading it (e.g. Ciklet
   * keeps the Globe iframe alive at 0×0 while the user is on another page).
   * `document.hidden` stays `false` in that case, so pause render loops and
   * polling when `hidden` is `true`.
   */
  VISIBILITY_UPDATE = "VISIBILITY_UPDATE",
  /**
   * Safe-area insets of the activity frame in CSS pixels (notch, home
   * indicator). The SDK applies them automatically as the CSS variables
   * `--ciklet-safe-area-inset-{top,right,bottom,left}` on `<html>` (Discord:
   * `--discord-safe-area-inset-*`), so subscribing is optional.
   */
  SAFE_AREA_INSETS_UPDATE = "SAFE_AREA_INSETS_UPDATE",
}

export enum Orientation {
  PORTRAIT = "portrait",
  LANDSCAPE = "landscape",
}

export enum LayoutMode {
  FOCUSED = "focused",
  PIP = "pip",
  GRID = "grid",
}

export enum ThermalState {
  NOMINAL = "nominal",
  FAIR = "fair",
  SERIOUS = "serious",
  CRITICAL = "critical",
}

export enum Platform {
  DESKTOP = "desktop",
  MOBILE = "mobile",
  WEB = "web",
}

/* ── Interfaces ──────────────────────────────────── */

export interface User {
  id: string;
  username: string;
  discriminator?: string;
  /** Avatar URL (may be a `data:` URI for generated avatars). */
  avatar?: string | null;
  global_name?: string | null;
}

export interface Channel {
  id: string;
  type: number;
  name?: string;
}

export interface Participant {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string | null;
  global_name?: string | null;
}

export interface AuthorizeInput {
  client_id: string;
  response_type?: "code";
  state?: string;
  prompt?: "none" | "consent";
  /** Requested scopes; must be a subset of the app's registered scopes. */
  scope?: string[];
}

export interface AuthorizeResponse {
  code: string;
}

export interface AuthenticateInput {
  access_token: string;
}

export interface AuthenticateResponse {
  access_token: string;
  user: User;
  scopes: string[];
  /** ISO 8601 expiry of the access token. */
  expires?: string;
  application: {
    /** OAuth client_id of the application. */
    id: string;
    description?: string | null;
    name: string;
    icon?: string | null;
  };
}

export interface GetChannelInput {
  channel_id?: string;
}

export interface GetChannelResponse {
  id: string;
  type: number;
  name?: string;
  topic?: string | null;
}

export interface GetInstanceConnectedParticipantsResponse {
  participants: Participant[];
}

export interface OpenExternalLinkInput {
  url: string;
}

/**
 * Fetch a public page/API through the Ciklet client's NATIVE layer instead of
 * the iframe, so the request leaves from the USER's IP address.
 *
 * Why this exists: some activities read public third-party pages that send no
 * CORS headers, so the iframe cannot read them. Routing those reads through
 * one shared backend concentrates every user's traffic onto a single server IP
 * and gets it rate-limited or blocked. The native layer (desktop shell, mobile
 * WebView) is not bound by CORS and carries the user's own address.
 *
 * ── Hard limits, enforced by the HOST, not by the activity ──────────────
 * The host decides what may be fetched; an activity cannot widen the rules:
 *  - **Allowlist.** Only hosts the Ciklet client explicitly permits for your
 *    activity. Everything else — private addresses, localhost, link-local,
 *    `.internal`, non-https — is refused. This is NOT a general-purpose proxy:
 *    without the allowlist it would let any approved activity use the user's
 *    machine to reach their LAN.
 *  - **No credentials.** No cookies, no auth headers, no stored session. The
 *    user's accounts on the target site are never involved.
 *  - **Read-only.** GET only.
 *  - **Capped.** Response size and timeout are bounded; the host rate-limits
 *    per activity.
 *
 * ── Availability ───────────────────────────────────────────────────────
 * Hosts WITHOUT a native layer (plain web client) reject this command. Treat
 * it as an optimization: always keep a server-side path and fall back when the
 * call rejects. Check `(await sdk.commands.getPlatformBehaviors())` or simply
 * catch the rejection.
 */
export interface FetchExternalInput {
  /** Absolute https URL. Must be on the host's allowlist for this activity. */
  url: string;
}

export interface FetchExternalResponse {
  /** HTTP status the native layer received. */
  status: number;
  /** Response body as text (parse it yourself). Truncated at the host's cap. */
  body: string;
  /** Final URL after redirects, if the host reports it. */
  url?: string;
}

/**
 * Result of OPEN_INVITE_DIALOG. Empty on purpose — mirrors Discord's
 * `openInviteDialog()`, which resolves as soon as the host has OPENED its
 * "Arkadaşları Davet Et" sheet. The activity is never told who was invited
 * (or whether anyone was): the recipient list is the user's private social
 * graph and stays inside the Ciklet client.
 */
export type OpenInviteDialogResponse = Record<string, never>;

export interface ActivityMetadata {
  activityName?: string;
  activityColor?: string;
  description?: string;
  activityIcon?: string;
}

/**
 * Discord activity types accepted by `setActivity`. Ciklet shows
 * PLAYING (0, default), LISTENING (2), WATCHING (3) and COMPETING (5);
 * anything else is published as PLAYING.
 */
export enum ActivityType {
  PLAYING = 0,
  STREAMING = 1,
  LISTENING = 2,
  WATCHING = 3,
  CUSTOM = 4,
  COMPETING = 5,
}

/**
 * Rich presence published by `setActivity` — same shape as Discord's
 * Embedded App SDK `Activity`. The activity name is always your
 * application's name; it cannot be overridden.
 *
 * Text fields are trimmed to 128 characters by the host. Images must be an
 * `https:` URL or the key of a rich-presence asset uploaded in the
 * Developer Portal (Rich Presence › Art Assets).
 */
export interface Activity {
  type?: ActivityType | number;
  /** Second line, e.g. "In a match". */
  details?: string | null;
  /** Third line, e.g. "Ranked"; party size is appended as "(2/4)". */
  state?: string | null;
  /** Epoch milliseconds (seconds are accepted and converted). */
  timestamps?: { start?: number | null; end?: number | null } | null;
  assets?: {
    large_image?: string | null;
    large_text?: string | null;
    small_image?: string | null;
    small_text?: string | null;
  } | null;
  /**
   * `size` is `[current, max]`. `id` is accepted for Discord compatibility
   * but never published.
   */
  party?: { id?: string | null; size?: [number, number] | null } | null;
  /** Accepted for Discord compatibility; activities are always instanced. */
  instance?: boolean;
}

export interface SetActivityInput {
  /** The presence to show; `null` clears it. Cleared automatically on close. */
  activity?: Activity | null;
  /** Ciklet extension: rename / recolour the local activity tile. */
  metadata?: ActivityMetadata | null;
}

export interface SetConfigInput {
  use_interactive_pip?: boolean;
}

export interface SetConfigResponse {
  use_interactive_pip: boolean;
}

export interface CaptureLogInput {
  level: "log" | "warn" | "debug" | "info" | "error";
  message: string;
}

export interface GetPlatformBehaviorsResponse {
  iosKeyboardResizesView?: boolean;
}

export interface UserSettingsGetLocaleResponse {
  locale: string;
}

/* ── RPC Message Envelope ────────────────────────── */

export interface RPCMessage {
  cmd: string;
  nonce: string | null;
  evt: string | null;
  data?: unknown;
  args?: unknown;
}

/* ── Ready Event Payload ─────────────────────────── */

export interface ReadyPayload {
  v: number;
  config: {
    api_endpoint: string;
    environment: string;
  };
  user?: User;
  channel_id?: string;
  instance_id?: string;
  platform?: Platform;
  frame_id?: string;
  /** Same values as the URL parameters (see {@link LaunchContext}). */
  location_id?: string;
  launch_id?: string;
  guild_id?: string | null;
  custom_id?: string | null;
  referrer_id?: string | null;
}

/**
 * How this activity instance was launched — read from the iframe URL the
 * host builds. Mirrors Discord's query parameters.
 */
export interface LaunchContext {
  instanceId: string;
  /** Where the activity runs; currently the chat (channel or DM) id. */
  locationId: string | null;
  /** Unique per launch of the iframe. */
  launchId: string | null;
  channelId: string | null;
  /** Server id for server channels, `null` in DMs. */
  guildId: string | null;
  /** `customId` of the Developer Portal custom link the user opened. */
  customId: string | null;
  /**
   * The user who shared the link / invite this launch came from — not the
   * current user. NOT proof of identity: anyone can craft a URL.
   */
  referrerId: string | null;
  frameId: string;
  platform: Platform;
}

/* ── Event Payload Types ─────────────────────────── */

export interface ActivityInstanceParticipantsUpdatePayload {
  participants: Participant[];
}

export interface ActivityLayoutModeUpdatePayload {
  layout_mode: LayoutMode;
}

export interface OrientationUpdatePayload {
  screen_orientation: Orientation;
  orientation: Orientation;
}

export interface ThermalStateUpdatePayload {
  thermal_state: ThermalState;
}

/**
 * Discord sends the user object itself (no wrapper); Ciklet does the same.
 * `user` is kept for older Ciklet hosts.
 */
export interface CurrentUserUpdatePayload extends Partial<User> {
  /** @deprecated read the fields directly from the payload. */
  user?: User;
}

export interface VisibilityUpdatePayload {
  hidden: boolean;
}

export interface SafeAreaInsetsUpdatePayload {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ErrorPayload {
  code: number;
  message: string;
}

/* ── Event Map ───────────────────────────────────── */

export interface EventPayloadMap {
  [RPCEvents.READY]: ReadyPayload;
  [RPCEvents.ERROR]: ErrorPayload;
  [RPCEvents.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE]: ActivityInstanceParticipantsUpdatePayload;
  [RPCEvents.ACTIVITY_LAYOUT_MODE_UPDATE]: ActivityLayoutModeUpdatePayload;
  [RPCEvents.ORIENTATION_UPDATE]: OrientationUpdatePayload;
  [RPCEvents.CURRENT_USER_UPDATE]: CurrentUserUpdatePayload;
  [RPCEvents.THERMAL_STATE_UPDATE]: ThermalStateUpdatePayload;
  [RPCEvents.VISIBILITY_UPDATE]: VisibilityUpdatePayload;
  [RPCEvents.SAFE_AREA_INSETS_UPDATE]: SafeAreaInsetsUpdatePayload;
}
