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

const appRef = (id: string) => (id === "@me" ? "@me" : encodeURIComponent(id));

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
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CikletRestOptions) {
    this.baseUrl = (options.baseUrl ?? "https://ciklet.xyz").replace(/\/+$/, "");
    this.token = options.accessToken;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (data ?? {}) as { code?: string; error?: string; message?: string; error_description?: string };
      throw new CikletRestError(res.status, err.code ?? err.error ?? "http_error", err.message ?? err.error_description ?? `HTTP ${res.status}`);
    }
    return data as T;
  }

  readonly lobbies = {
    /** Discord "Create or Join Lobby": aynı sırla tek lobi. */
    createOrJoin: (input: { secret: string; lobby_metadata?: LobbyMetadata; member_metadata?: LobbyMetadata; idle_timeout_seconds?: number }) =>
      this.request<Lobby>("PUT", "/api/v1/lobbies", input),
    get: (lobbyId: string) => this.request<Lobby>("GET", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}`),
    leave: (lobbyId: string) => this.request<void>("DELETE", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}/members/@me`),
    messages: (lobbyId: string, options: { limit?: number; before?: string } = {}) => {
      const qs = new URLSearchParams();
      if (options.limit) qs.set("limit", String(options.limit));
      if (options.before) qs.set("before", options.before);
      const suffix = qs.toString() ? `?${qs}` : "";
      return this.request<LobbyMessage[]>("GET", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}/messages${suffix}`);
    },
    sendMessage: (lobbyId: string, content: string, metadata?: LobbyMetadata) =>
      this.request<LobbyMessage>("POST", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}/messages`, { content, ...(metadata ? { metadata } : {}) }),
    /** LiveKit jetonu: `livekit-client` ile `room.connect(url, token)`. */
    voice: (lobbyId: string) => this.request<LobbyVoiceToken>("POST", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}/voice`),
    /** Ciklet metin kanalına bağla; `null` bağı çözer. CanLinkLobby + Kanalları Yönet gerekir. */
    linkChannel: (lobbyId: string, channelId: string | null) =>
      this.request<Lobby>("PATCH", `/api/v1/lobbies/${encodeURIComponent(lobbyId)}/channel-linking`, channelId ? { channel_id: channelId } : {}),
  };

  readonly gameStats = {
    get: (applicationId: string = "@me") => this.request<GameStatsResponse>("GET", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`),
    /** Kartın tamamını değiştirir; `null` alanı siler. */
    put: (applicationId: string, stats: GameStats) =>
      this.request<GameStatsResponse>("PUT", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`, { stats }),
    delete: (applicationId: string = "@me") => this.request<void>("DELETE", `/api/v1/users/@me/applications/${appRef(applicationId)}/game-stats`),
  };
}
