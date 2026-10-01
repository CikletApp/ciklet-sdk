// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — CikletSDK
//
// Main SDK class. 3rd party developers instantiate this inside their
// iframe app.
//
// Usage:
//   import { CikletSDK } from '@ciklet/embedded-activities-sdk';
//   const sdk = new CikletSDK(CLIENT_ID);
//   await sdk.ready();
//   const { code } = await sdk.commands.authorize({ client_id: CLIENT_ID, scope: ['identify'] });
//   // exchange code for token on your backend...
//   await sdk.commands.authenticate({ access_token });
// ─────────────────────────────────────────────────────────────────

import {
  type RPCMessage,
  type ReadyPayload,
  type AuthorizeInput,
  type AuthorizeResponse,
  type AuthenticateInput,
  type AuthenticateResponse,
  type GetChannelInput,
  type GetChannelResponse,
  type GetInstanceConnectedParticipantsResponse,
  type SetActivityInput,
  type FetchExternalInput,
  type FetchExternalResponse,
  type OpenExternalLinkInput,
  type SetConfigInput,
  type SetConfigResponse,
  type CaptureLogInput,
  type GetPlatformBehaviorsResponse,
  type UserSettingsGetLocaleResponse,
  type EventPayloadMap,
  RPCCommands,
  RPCEvents,
  RPCCloseCodes,
  Platform,
} from "./types.js";
import { generateNonce, encodeMessage, isValidRPCMessage } from "./utils/rpc.js";

/* ── Types ─────────────────────────────────────── */

type EventHandler<T = unknown> = (data: T) => void;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** Default timeout for a single RPC command round-trip. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

export interface CikletSDKOptions {
  /**
   * Origin of the Ciklet client that embeds this activity, e.g.
   * `"https://ciklet.xyz"`. When given, RPC messages are sent ONLY to this
   * origin and messages from any other origin are ignored.
   *
   * When omitted, the origin is derived from `document.referrer` (Ciklet
   * loads the iframe with `referrerPolicy="strict-origin"`, so the referrer
   * is always the host origin). If the referrer is unavailable as well, the
   * SDK falls back to `"*"` and logs a warning. Set this option explicitly
   * in production to avoid that fallback.
   */
  hostOrigin?: string;
  /** Per-command timeout in milliseconds. Defaults to 15 000. */
  commandTimeoutMs?: number;
}

/* ── SDK Class ─────────────────────────────────── */

export class CikletSDK {
  readonly clientId: string;
  readonly instanceId: string;
  readonly channelId: string | null;
  readonly frameId: string;
  readonly platform: Platform;
  /** Origin the SDK talks to. `"*"` only when it could not be determined. */
  readonly hostOrigin: string;

  private _ready = false;
  private _closed = false;
  private _readyPayload: ReadyPayload | null = null;
  private _pendingRequests = new Map<string, PendingRequest>();
  private _eventListeners = new Map<string, Set<EventHandler>>();
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;
  private _source: WindowProxy;
  private _commandTimeoutMs: number;

  /**
   * Construct a new CikletSDK instance.
   * Call this from inside your activity's iframe.
   *
   * @param clientId - Your application's client ID (from Ciklet Developer Portal)
   * @param options  - Optional host origin / timeout overrides
   */
  constructor(clientId: string, options: CikletSDKOptions = {}) {
    if (typeof window === "undefined") {
      throw new Error("[CikletSDK] must be constructed in a browser (iframe) context");
    }
    if (!clientId || typeof clientId !== "string") {
      throw new Error("[CikletSDK] clientId is required");
    }

    this.clientId = clientId;
    this._source = window.parent;
    this._commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    // The postMessage target must never be "*" in production: authorization
    // codes and access tokens must only reach the Ciklet client that embeds
    // us. An explicit option wins; otherwise the referrer is the host origin.
    this.hostOrigin = resolveHostOrigin(options.hostOrigin);
    if (this.hostOrigin === "*") {
      console.warn(
        "[CikletSDK] Host origin could not be determined (no referrer). " +
          "Pass `hostOrigin` to the constructor to lock RPC messages to the Ciklet client.",
      );
    }

    // Parse URL query params (injected by the Ciklet host)
    const params = new URLSearchParams(window.location.search);
    this.instanceId = params.get("instance_id") ?? "";
    this.channelId = params.get("channel_id") ?? null;
    this.frameId = params.get("frame_id") ?? "";
    this.platform = parsePlatform(params.get("platform"));

    // Set up ready promise
    this._readyPromise = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });

    // Listen for messages from host
    window.addEventListener("message", this._handleMessage);

    // Send HANDSHAKE to host (announce we exist)
    this._post(encodeMessage("DISPATCH", { v: 1, client_id: this.clientId }, undefined, RPCEvents.READY));
  }

  /* ── ready() ───────────────────────────────────── */

  /**
   * Resolves when the READY event has been received from the Ciklet host.
   * Must be awaited before any command is sent.
   *
   * The host only answers the handshake after the user has granted consent
   * to the activity, so this may take as long as the consent dialog stays
   * open. It never rejects; use your own timeout if you need one.
   *
   * @example
   * await sdk.ready();
   */
  async ready(): Promise<void> {
    if (this._ready) return;
    return this._readyPromise;
  }

  /** `true` once the host has answered the READY handshake. */
  get isReady(): boolean {
    return this._ready;
  }

  /** Payload of the READY event (`null` until `ready()` resolves). */
  get readyPayload(): ReadyPayload | null {
    return this._readyPayload;
  }

  /* ── commands ──────────────────────────────────── */

  /** SDK command namespace */
  readonly commands = {
    /**
     * Request authorization from the user.
     * Opens the OAuth permission modal (if not already granted) and returns
     * an authorization code. Exchange it on YOUR backend at
     * `POST /api/oauth/token` with your client_secret.
     */
    authorize: (input: AuthorizeInput): Promise<AuthorizeResponse> => {
      return this._sendCommand<AuthorizeResponse>(RPCCommands.AUTHORIZE, input);
    },

    /**
     * Authenticate with the Ciklet client using an access token.
     * The token is obtained by exchanging the authorization code on your backend.
     */
    authenticate: (input: AuthenticateInput): Promise<AuthenticateResponse> => {
      return this._sendCommand<AuthenticateResponse>(RPCCommands.AUTHENTICATE, input);
    },

    /**
     * Get information about the channel the activity is running in.
     */
    getChannel: (input?: GetChannelInput): Promise<GetChannelResponse> => {
      return this._sendCommand<GetChannelResponse>(
        RPCCommands.GET_CHANNEL,
        input ?? { channel_id: this.channelId ?? undefined },
      );
    },

    /**
     * Get the list of participants connected to this activity instance.
     */
    getInstanceConnectedParticipants: (): Promise<GetInstanceConnectedParticipantsResponse> => {
      return this._sendCommand<GetInstanceConnectedParticipantsResponse>(
        RPCCommands.GET_INSTANCE_CONNECTED_PARTICIPANTS,
      );
    },

    /**
     * Set the activity (rich presence) for the current user.
     */
    setActivity: (input: SetActivityInput): Promise<void> => {
      return this._sendCommand<void>(RPCCommands.SET_ACTIVITY, input);
    },

    /**
     * Open an external link in the user's browser. Only http(s) URLs are
     * accepted by the host.
     */
    openExternalLink: (input: OpenExternalLinkInput): Promise<void> => {
      return this._sendCommand<void>(RPCCommands.OPEN_EXTERNAL_LINK, input);
    },

    /**
     * Fetch a public page through the Ciklet client's native layer, so the
     * request leaves from the user's own IP rather than your backend's.
     *
     * Only hosts on the Ciklet client's allowlist for your activity are
     * reachable; the request carries no cookies or credentials, is GET-only,
     * and is size/time capped. See {@link FetchExternalInput} for the full
     * contract.
     *
     * NOT available on every host — the plain web client has no native layer
     * and rejects this command. Always keep a server-side fallback:
     *
     * ```typescript
     * let html: string | null = null;
     * try {
     *   const result = await sdk.commands.fetchExternal({ url });
     *   if (result.status === 200) html = result.body;
     * } catch {
     *   // host has no native layer — fall back to your own backend
     * }
     * ```
     */
    fetchExternal: (input: FetchExternalInput): Promise<FetchExternalResponse> => {
      return this._sendCommand<FetchExternalResponse>(RPCCommands.FETCH_EXTERNAL, input);
    },

    /**
     * Get platform-specific behaviors.
     */
    getPlatformBehaviors: (): Promise<GetPlatformBehaviorsResponse> => {
      return this._sendCommand<GetPlatformBehaviorsResponse>(RPCCommands.GET_PLATFORM_BEHAVIORS);
    },

    /**
     * Set configuration for the activity.
     */
    setConfig: (input: SetConfigInput): Promise<SetConfigResponse> => {
      return this._sendCommand<SetConfigResponse>(RPCCommands.SET_CONFIG, input);
    },

    /**
     * Forward a log message to the Ciklet client for debugging.
     * The host only prints it in development builds.
     */
    captureLog: (input: CaptureLogInput): Promise<void> => {
      return this._sendCommand<void>(RPCCommands.CAPTURE_LOG, input);
    },

    /**
     * Get the user's locale setting.
     */
    userSettingsGetLocale: (): Promise<UserSettingsGetLocaleResponse> => {
      return this._sendCommand<UserSettingsGetLocaleResponse>(RPCCommands.USER_SETTINGS_GET_LOCALE);
    },
  };

  /* ── subscribe / unsubscribe ───────────────────── */

  /**
   * Subscribe to an SDK event.
   *
   * @example
   * sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (data) => {
   *   console.log('Participants:', data.participants);
   * });
   */
  subscribe<E extends keyof EventPayloadMap>(
    event: E,
    handler: EventHandler<EventPayloadMap[E]>,
  ): void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event)!.add(handler as EventHandler);

    // READY may already have arrived: deliver it immediately instead of
    // leaving the subscriber waiting for an event that never fires again.
    if (event === RPCEvents.READY && this._ready && this._readyPayload) {
      this._invoke(handler as EventHandler, this._readyPayload, event);
      return;
    }

    // Tell host we want this event
    this._post(encodeMessage("SUBSCRIBE", { evt: event }, generateNonce()));
  }

  /**
   * Unsubscribe from an SDK event. Without a handler, every handler of that
   * event is removed.
   */
  unsubscribe<E extends keyof EventPayloadMap>(
    event: E,
    handler?: EventHandler<EventPayloadMap[E]>,
  ): void {
    const listeners = this._eventListeners.get(event);
    if (!listeners) return;

    if (handler) {
      listeners.delete(handler as EventHandler);
    } else {
      listeners.clear();
    }

    if (listeners.size === 0) {
      this._eventListeners.delete(event);
      this._post(encodeMessage("UNSUBSCRIBE", { evt: event }, generateNonce()));
    }
  }

  /* ── close() ───────────────────────────────────── */

  /**
   * Close the activity. Pending commands are rejected and the SDK stops
   * listening; the instance cannot be reused afterwards.
   */
  close(code: RPCCloseCodes = RPCCloseCodes.CLOSE_NORMAL, message?: string): void {
    if (this._closed) return;
    this._post(encodeMessage("CLOSE", { code, message }, generateNonce()));
    this._cleanup();
  }

  /* ── Internal: Send Command ────────────────────── */

  private _sendCommand<T>(cmd: string, args?: unknown, timeoutMs = this._commandTimeoutMs): Promise<T> {
    if (this._closed) {
      return Promise.reject(new Error("[CikletSDK] SDK is closed"));
    }

    const nonce = generateNonce();
    const msg = encodeMessage(cmd, args, nonce);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(nonce);
        const hint = this._ready ? "" : " (did you await sdk.ready() first?)";
        reject(new Error(`RPC command timed out: ${cmd} (${timeoutMs}ms)${hint}`));
      }, timeoutMs);

      this._pendingRequests.set(nonce, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this._post(msg);
    });
  }

  private _post(msg: RPCMessage): void {
    this._source.postMessage(msg, this.hostOrigin);
  }

  private _invoke(handler: EventHandler, data: unknown, eventName: string): void {
    try {
      handler(data);
    } catch (err) {
      console.error(`[CikletSDK] Event handler error for ${eventName}:`, err);
    }
  }

  /* ── Internal: Handle Message ──────────────────── */

  private _handleMessage = (event: MessageEvent): void => {
    // Only handle messages from the Ciklet host. The source check is the
    // strong one: only the embedding window can be `window.parent`.
    if (this.hostOrigin !== "*" && event.origin !== this.hostOrigin) return;
    if (event.source !== this._source) return;

    const data = event.data;
    if (!isValidRPCMessage(data)) return;

    const msg = data;

    // ── DISPATCH events (from host) ──────────────
    if (msg.cmd === "DISPATCH") {
      const eventName = msg.evt;
      if (!eventName) return;

      // Handle READY event specially
      if (eventName === RPCEvents.READY && !this._ready) {
        this._ready = true;
        this._readyPayload = (msg.data as ReadyPayload) ?? null;
        this._resolveReady();
        // Fall through: READY subscribers registered before the handshake
        // completed still get notified.
      }

      // Dispatch to subscribers
      const listeners = this._eventListeners.get(eventName);
      if (listeners) {
        for (const handler of listeners) {
          this._invoke(handler, msg.data, eventName);
        }
      }
      return;
    }

    // ── Command responses (nonce-correlated) ─────
    if (msg.nonce) {
      const pending = this._pendingRequests.get(msg.nonce);
      if (!pending) return;

      clearTimeout(pending.timer);
      this._pendingRequests.delete(msg.nonce);

      // Check for error in response
      const responseData = msg.data as Record<string, unknown> | undefined;
      if (responseData && typeof responseData === "object" && "error" in responseData) {
        const err = responseData.error as { code?: number; message?: string } | null;
        pending.reject(new RPCError(err?.code ?? 0, err?.message ?? "Unknown RPC error", msg.cmd));
      } else {
        pending.resolve(msg.data);
      }
    }
  };

  /* ── Internal: Cleanup ─────────────────────────── */

  private _cleanup(): void {
    this._closed = true;
    window.removeEventListener("message", this._handleMessage);
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("SDK closed"));
    }
    this._pendingRequests.clear();
    this._eventListeners.clear();
  }
}

/**
 * Error returned by the host for a rejected command.
 *
 * `code` is an {@link RPCErrorCodes} value. Compare against that enum rather
 * than against bare numbers — the command error codes and the connection
 * close codes ({@link RPCCloseCodes}) reuse some of the same numbers with
 * different meanings.
 */
export class RPCError extends Error {
  readonly code: number;
  readonly command: string;

  constructor(code: number, message: string, command: string) {
    super(`RPC Error ${code}: ${message}`);
    this.name = "RPCError";
    this.code = code;
    this.command = command;
  }
}

/* ── Helpers ───────────────────────────────────── */

function resolveHostOrigin(explicit: string | undefined): string {
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      throw new Error(`[CikletSDK] hostOrigin is not a valid URL: ${explicit}`);
    }
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    /* fall through */
  }
  return "*";
}

function parsePlatform(raw: string | null): Platform {
  switch (raw) {
    case Platform.DESKTOP:
    case Platform.MOBILE:
    case Platform.WEB:
      return raw;
    default:
      return Platform.WEB;
  }
}
