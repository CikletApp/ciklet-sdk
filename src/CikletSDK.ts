// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — CikletSDK
//
// Main SDK class — mirrors DiscordSDK from @ciklet/embedded-app-sdk.
// 3rd party developers instantiate this inside their iframe app.
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
} from "./types";
import { generateNonce, encodeMessage, isValidRPCMessage } from "./utils/rpc";

/* ── Types ─────────────────────────────────────── */

type EventHandler<T = unknown> = (data: T) => void;
type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/* ── SDK Class ─────────────────────────────────── */

export class CikletSDK {
  readonly clientId: string;
  readonly instanceId: string;
  readonly channelId: string | null;
  readonly frameId: string;
  readonly platform: Platform;

  private _ready = false;
  private _readyPayload: ReadyPayload | null = null;
  private _pendingRequests = new Map<string, PendingRequest>();
  private _eventListeners = new Map<string, Set<EventHandler>>();
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;
  private _source: WindowProxy;
  private _hostOrigin: string;

  /**
   * Construct a new CikletSDK instance.
   * Call this from inside your activity's iframe.
   *
   * @param clientId — Your application's client ID (from Ciklet Developer Portal)
   */
  constructor(clientId: string) {
    this.clientId = clientId;
    this._source = window.parent;

    // Host origin — postMessage hedefi ASLA "*" olmamalı: auth code ve
    // token'lar yalnızca bizi gömen Ciklet istemcisine gitmeli. Ciklet,
    // iframe'i strict-origin referrer policy ile yüklediği için referrer
    // her zaman host origin'idir (Discord SDK'nın yaklaşımıyla aynı).
    this._hostOrigin = (() => {
      try {
        if (document.referrer) return new URL(document.referrer).origin;
      } catch {
        /* fall through */
      }
      return "*";
    })();

    // Parse URL query params (injected by Ciklet host, same as Ciklet)
    const params = new URLSearchParams(window.location.search);
    this.instanceId = params.get("instance_id") ?? "";
    this.channelId = params.get("channel_id") ?? null;
    this.frameId = params.get("frame_id") ?? "";
    this.platform = (params.get("platform") as Platform) ?? Platform.WEB;

    // Set up ready promise
    this._readyPromise = new Promise<void>((resolve) => {
      this._resolveReady = resolve;
    });

    // Listen for messages from host
    window.addEventListener("message", this._handleMessage);

    // Send HANDSHAKE to host (announce we exist)
    this._source.postMessage(
      encodeMessage("DISPATCH", { v: 1, client_id: this.clientId }, undefined, RPCEvents.READY),
      this._hostOrigin,
    );
  }

  /* ── ready() ───────────────────────────────────── */

  /**
   * Resolves when the READY event has been received from the Ciklet host.
   * Must be called before any commands.
   *
   * @example
   * await sdk.ready();
   */
  async ready(): Promise<void> {
    if (this._ready) return;
    return this._readyPromise;
  }

  /* ── commands ──────────────────────────────────── */

  /** SDK command namespace — mirrors `discordSdk.commands.*` */
  readonly commands = {
    /**
     * Request authorization from the user.
     * Opens the OAuth permission modal and returns an authorization code.
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
      return this._sendCommand<GetChannelResponse>(RPCCommands.GET_CHANNEL, input ?? { channel_id: this.channelId });
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
     * Open an external link in the user's browser.
     */
    openExternalLink: (input: OpenExternalLinkInput): Promise<void> => {
      return this._sendCommand<void>(RPCCommands.OPEN_EXTERNAL_LINK, input);
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

    // Tell host we want this event
    this._source.postMessage(
      encodeMessage("SUBSCRIBE", { evt: event }, generateNonce()),
      this._hostOrigin,
    );
  }

  /**
   * Unsubscribe from an SDK event.
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
      this._source.postMessage(
        encodeMessage("UNSUBSCRIBE", { evt: event }, generateNonce()),
        this._hostOrigin,
      );
    }
  }

  /* ── close() ───────────────────────────────────── */

  /**
   * Close the activity.
   */
  close(code: RPCCloseCodes = RPCCloseCodes.CLOSE_NORMAL, message?: string): void {
    this._source.postMessage(
      encodeMessage("CLOSE", { code, message }, generateNonce()),
      this._hostOrigin,
    );
    this._cleanup();
  }

  /* ── Internal: Send Command ────────────────────── */

  private _sendCommand<T>(cmd: string, args?: unknown, timeoutMs = 15000): Promise<T> {
    const nonce = generateNonce();
    const msg = encodeMessage(cmd, args, nonce);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(nonce);
        reject(new Error(`RPC command timed out: ${cmd} (${timeoutMs}ms)`));
      }, timeoutMs);

      this._pendingRequests.set(nonce, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this._source.postMessage(msg, this._hostOrigin);
    });
  }

  /* ── Internal: Handle Message ──────────────────── */

  private _handleMessage = (event: MessageEvent): void => {
    // Yalnızca Ciklet host'undan gelen mesajları işle.
    if (this._hostOrigin !== "*" && event.origin !== this._hostOrigin) return;
    if (event.source !== this._source) return;

    const data = event.data;
    if (!isValidRPCMessage(data)) return;

    const msg = data as RPCMessage;

    // ── DISPATCH events (from host) ──────────────
    if (msg.cmd === "DISPATCH") {
      const eventName = msg.evt;
      if (!eventName) return;

      // Handle READY event specially
      if (eventName === RPCEvents.READY && !this._ready) {
        this._ready = true;
        this._readyPayload = (msg.data as ReadyPayload) ?? null;
        this._resolveReady();
        return;
      }

      // Dispatch to subscribers
      const listeners = this._eventListeners.get(eventName);
      if (listeners) {
        for (const handler of listeners) {
          try {
            handler(msg.data);
          } catch (err) {
            console.error(`[CikletSDK] Event handler error for ${eventName}:`, err);
          }
        }
      }
      return;
    }

    // ── Command responses (nonce-correlated) ─────
    if (msg.nonce) {
      const pending = this._pendingRequests.get(msg.nonce);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingRequests.delete(msg.nonce);

        // Check for error in response
        const responseData = msg.data as Record<string, unknown> | undefined;
        if (responseData && typeof responseData === "object" && "error" in responseData) {
          const err = responseData.error as { code: number; message: string };
          pending.reject(new Error(`RPC Error ${err.code}: ${err.message}`));
        } else {
          pending.resolve(msg.data);
        }
      }
    }
  };

  /* ── Internal: Cleanup ─────────────────────────── */

  private _cleanup(): void {
    window.removeEventListener("message", this._handleMessage);
    for (const [, pending] of this._pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("SDK closed"));
    }
    this._pendingRequests.clear();
    this._eventListeners.clear();
  }
}
