// ─────────────────────────────────────────────────────────────────
// Ciklet REST yardımcıları — kullanıcı (OAuth) jetonuyla
// Lobiler (`lobbies.write`) ve profil oyun istatistikleri (`game_stats.write`).
//
// Tarayıcı, Node ve fetch'i olan her ortamda çalışır; Unity/Unreal gibi
// motorlar aynı uçları düz HTTPS + JSON ile çağırabilir (docs › OAuth2 ›
// Lobiler). Gömülü aktivitede çağrıları KENDİ backend'inizden yapın ya da
// `patchUrlMappings` ile vekilleyin.
// ─────────────────────────────────────────────────────────────────

export type LobbyMetadata = Record<string, string>;

/** Lobi üye bayrakları (Discord LobbyMemberFlags). */
export const LobbyMemberFlags = {
  CAN_LINK_LOBBY: 1,
} as const;

export interface LobbyMember {
  id: string;
  metadata: LobbyMetadata;
  flags: number;
}

export interface Lobby {
  id: string;
  application_id: string;
  metadata: LobbyMetadata;
  members: LobbyMember[];
  idle_timeout_seconds: number;
  linked_channel: { id: string; name: string; guild_id: string } | null;
}

export interface LobbyMessage {
  id: string;
  type: number;
  content: string;
  lobby_id: string;
  channel_id: string;
  application_id: string;
  author: { id: string; username: string; global_name: string | null; avatar: string | null; bot: boolean } | null;
  metadata: LobbyMetadata;
  timestamp: string;
  flags: number;
}

export interface LobbyVoiceToken {
  token: string;
  url: string;
  room_name: string;
  identity: string;
}

/** Ağ geçidi lobi olayı (`lobbies.write` jetonlu bağlantı). */
export type LobbyGatewayEvent =
  | { eventType: "lobby.create" | "lobby.update"; t: "LOBBY_CREATE" | "LOBBY_UPDATE"; d: Lobby }
  | { eventType: "lobby.delete"; t: "LOBBY_DELETE"; d: { id: string } }
  | { eventType: "lobby.member_add" | "lobby.member_update"; t: "LOBBY_MEMBER_ADD" | "LOBBY_MEMBER_UPDATE"; d: { lobby_id: string; member: LobbyMember } }
  | { eventType: "lobby.member_remove"; t: "LOBBY_MEMBER_REMOVE"; d: { lobby_id: string; member: { id: string } } }
  | { eventType: "lobby.message_create"; t: "LOBBY_MESSAGE_CREATE"; d: LobbyMessage };

/** Oyun istatistiği değerleri: sayı, metin ya da ISO 8601 tarih (şemaya göre). */
export type GameStats = Record<string, number | string | null>;

export interface GameStatsResponse {
  stats: Record<string, number | string>;
  updated_at: string | null;
}

/**
 * Kimliği URL yol parçası olarak kodlar. `encodeURIComponent` `.` ve `..`
 * parçalarına dokunmaz ve `fetch` bunları çözer (`/lobbies/..` → `/`), bu
 * yüzden boş, `.` ve `..` reddedilir.
 */
function seg(id: string): string {
  if (typeof id !== "string" || id === "" || id === "." || id === "..") {
    throw new TypeError(`Geçersiz kimlik (yol parçası): ${JSON.stringify(id)}`);
  }
  return encodeURIComponent(id);
}

const appRef = (id: string) => (id === "@me" ? "@me" : seg(id));

/** Varsayılan istek zaman aşımı (ms). */
export const DEFAULT_REST_TIMEOUT_MS = 15_000;

export class CikletRestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CikletRestError";
  }
}

export interface CikletRestOptions {
  /** Kullanıcının OAuth erişim jetonu (`cik_at_…`). */
  accessToken: string;
  /** Varsayılan `https://ciklet.xyz`. */
  baseUrl?: string;
  /**
   * Tek isteğin zaman aşımı (ms). Varsayılan 15 000; `0` kapatır. Süre
   * dolunca `CikletRestError` (`status: 0`, `code: "timeout"`) fırlatılır.
   */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Kullanıcı jetonlu REST istemcisi.
 *
 * ```ts
 * const rest = new CikletRest({ accessToken });
 * const lobby = await rest.lobbies.createOrJoin({ secret: "mac-42" });
 * await rest.lobbies.sendMessage(lobby.id, "gg");
 * await rest.gameStats.put("@me", { seviye: 12, lig: "Elmas" });
 * ```
 */
export class CikletRest {
  private readonly baseUrl: string;
  private readonly token!: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CikletRestOptions) {
    this.baseUrl = (options.baseUrl ?? "https://ciklet.xyz").replace(/\/+$/, "");
    // Sayılamaz: `console.log(rest)` / JSON.stringify erişim jetonunu yazmasın.
    Object.defineProperty(this, "token", { value: options.accessToken, enumerable: false });
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REST_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = this.timeoutMs > 0 ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let res: Response;
    let text = "";
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (res.status !== 204) text = await res.text();
    } catch (error) {
      if (controller?.signal.aborted) {
        throw new CikletRestError(0, "timeout", `İstek zaman aşımına uğradı (${this.timeoutMs} ms): ${method} ${path.split("?")[0]}`);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 204) return undefined as T;
    // Vekil hata sayfası gibi JSON olmayan gövde SyntaxError fırlatıp HTTP
    // durumunu gizlemesin.
    let data: unknown;
    try {
      data = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      if (res.ok) throw new CikletRestError(res.status, "invalid_json", "Yanıt JSON değil.");
      data = undefined;
    }
    if (!res.ok) {
      const err = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      const str = (value: unknown) => (typeof value === "string" ? value : undefined);
      throw new CikletRestError(
        res.status,
        str(err.code) ?? str(err.error) ?? "http_error",
        str(err.message) ?? str(err.error_description) ?? `HTTP ${res.status}`,
      );
    }
    return data as T;
  }

  readonly lobbies = {
    /** Discord "Create or Join Lobby": aynı sırla tek lobi. */
    createOrJoin: (input: { secret: string; lobby_metadata?: LobbyMetadata; member_metadata?: LobbyMetadata; idle_timeout_seconds?: number }) =>
      this.request<Lobby>("PUT", "/api/v1/lobbies", input),
    get: (lobbyId: string) => this.request<Lobby>("GET", `/api/v1/lobbies/${seg(lobbyId)}`),
    leave: (lobbyId: string) => this.request<void>("DELETE", `/api/v1/lobbies/${seg(lobbyId)}/members/@me`),
    messages: (lobbyId: string, options: { limit?: number; before?: string } = {}) => {
      const qs = new URLSearchParams();
      if (options.limit) qs.set("limit", String(options.limit));
      if (options.before) qs.set("before", options.before);
      const suffix = qs.toString() ? `?${qs}` : "";
      return this.request<LobbyMessage[]>("GET", `/api/v1/lobbies/${seg(lobbyId)}/messages${suffix}`);
    },
    sendMessage: (lobbyId: string, content: string, metadata?: LobbyMetadata) =>
      this.request<LobbyMessage>("POST", `/api/v1/lobbies/${seg(lobbyId)}/messages`, { content, ...(metadata ? { metadata } : {}) }),
    /** LiveKit jetonu: `livekit-client` ile `room.connect(url, token)`. */
    voice: (lobbyId: string) => this.request<LobbyVoiceToken>("POST", `/api/v1/lobbies/${seg(lobbyId)}/voice`),
    /** Ciklet metin kanalına bağla; `null` bağı çözer. CanLinkLobby + Kanalları Yönet gerekir. */
    linkChannel: (lobbyId: string, channelId: string | null) =>
      this.request<Lobby>("PATCH", `/api/v1/lobbies/${seg(lobbyId)}/channel-linking`, channelId ? { channel_id: channelId } : {}),
  };

  readonly gameStats = {
    get: (applicationId: string = "@me") => this.request<GameStatsResponse>("GET", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`),
    /** Kartın tamamını değiştirir; `null` alanı siler. */
    put: (applicationId: string, stats: GameStats) =>
      this.request<GameStatsResponse>("PUT", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`, { stats }),
    delete: (applicationId: string = "@me") => this.request<void>("DELETE", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`),
  };
}
