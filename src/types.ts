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

export interface ActivityMetadata {
  activityName?: string;
  activityColor?: string;
  description?: string;
  activityIcon?: string;
}

export interface SetActivityInput {
  activity?: {
    type?: number;
    state?: string;
    details?: string;
  } | null;
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

export interface CurrentUserUpdatePayload {
  user: User;
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
}
