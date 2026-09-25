/**
 * Ciklet gerçek zamanlı (ağ geçidi / WebSocket) sözleşmesi — ADR-0012.
 *
 * Kaynak gerçeği ciklet-web'deki Rust ağ geçididir:
 *   - istemci → ağ geçidi: `gateway/src/main.rs` (dispatch) ve
 *     `gateway/src/events.rs` (yük yapıları, `deny_unknown_fields`)
 *   - Node → odalar: `src/lib/realtime/events.ts`
 *
 * Taşıma DÜZ bir WebSocket'tir (Socket.IO değil); her kare tek satırlık bir
 * JSON nesnesidir. İstemcinin gönderdiği kareler `event_type` (snake_case),
 * ağ geçidinin yayınladıkları `eventType` (camelCase) taşır. Ağ geçidi
 * tanımadığı alanı taşıyan yükü REDDEDER (`invalid_payload`); bir alan
 * eklemeden önce Rust tarafındaki yapıya bakın.
 */

import type { PresenceStatus, Reaction } from "./entities.js";

/** Ağ geçidi WebSocket yolu — nginx bunu gateway:4000/ws'e geçirir (ör. `wss://ciklet.xyz/gateway/ws`). */
export const GATEWAY_PATH = "/gateway/ws";

/** Üretim ağ geçidi adresi. İstemciler geliştirmede kendi adresini geçebilir. */
export const DEFAULT_GATEWAY_URL = "wss://ciklet.xyz/gateway/ws";

/**
 * `heartbeat` gönderme aralığı. Ağ geçidi bu süre içinde HİÇBİR kare
 * almazsa (`GATEWAY_IDLE_TIMEOUT_MS`) bağlantıyı kapatır.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const GATEWAY_IDLE_TIMEOUT_MS = 60_000;

/** Tek bir WebSocket karesinin üst sınırı (ağ geçidi varsayılanı). */
export const GATEWAY_MAX_FRAME_BYTES = 64 * 1024;

// ── İstemci → ağ geçidi (`event_type`) ──────────────────────────────

export const ClientEvents = {
  /** `{ chat_id, client_nonce? }` — üyelik sunucuda doğrulanır. */
  CHAT_SUBSCRIBE: "chat.subscribe",
  CHAT_UNSUBSCRIBE: "chat.unsubscribe",
  /** `{ chat_id, content?, file_url?, reply_to_id?, client_nonce? }` */
  MESSAGE_CREATE: "message.create",
  /** Alansız; `heartbeat.ack` döner. 30 sn'de bir gönderilmeli. */
  HEARTBEAT: "heartbeat",
  /** `{ is_idle }` — kullanıcı etkileşimi kesildi/döndü. */
  PRESENCE_IDLE: "presence.idle",
  /** `{ status }` — kullanıcının ELLE seçtiği durum. */
  PRESENCE_SET_STATUS: "presence.set_status",
  /**
   * Alansız. Arkadaş/sunucu listesi değişince abonelikleri yeniden kurar.
   * Botlar `bot.guild_create` sonrası bunu göndererek yeni sunucunun bot
   * odasına yeniden bağlanmadan girer.
   */
  PRESENCE_SYNC: "presence.sync",
  /** `{ activity }` — `null` etkinlik bitti demektir. */
  RICH_PRESENCE_UPDATE: "rich_presence.update",
  /** `{ chat_id, is_typing }` */
  TYPING: "typing",
  /** `{ channel_id, call_type? }` */
  VOICE_JOIN: "voice.join",
  /** `{ channel_id }` */
  VOICE_LEAVE: "voice.leave",
  /** `{ channel_id }` — kanaldakileri iste (`voice.update` döner). */
  VOICE_MEMBERS: "voice.members",
  VOICE_ACTIVE_CHANNELS: "voice.active_channels",
  ACTIVITY_GET: "activity.get",
  ACTIVITY_JOIN: "activity.join",
  ACTIVITY_CREATE: "activity.create",
  ACTIVITY_LEAVE: "activity.leave",
  ACTIVITY_REQUEST_STATE: "activity.request_state",
  ACTIVITY_SYNC: "activity.sync",
  ACTIVITY_SET_HOST: "activity.set_host",
  ACTIVITY_ENDED: "activity.ended",
} as const;

export type ClientEvent = (typeof ClientEvents)[keyof typeof ClientEvents];

// ── Ağ geçidi → istemci (`eventType`) ───────────────────────────────

export const ServerEvents = {
  HEARTBEAT_ACK: "heartbeat.ack",
  /** `{ statuses: [{ userId, status }] }` */
  PRESENCE_BATCH: "presence.batch",
  /** `{ userId, status }` */
  PRESENCE_UPDATE: "presence.update",
  /** `{ status }` — kendi görünür durumun (INVISIBLE dahil). */
  PRESENCE_SELF: "presence.self",
  /** `{ userId, activity }` */
  RICH_PRESENCE_UPDATE: "rich_presence.update",
  /** `{ chatId, isTyping, profile }` — abone olunan sohbetlerden. */
  TYPING: "typing",
  /** `{ chatId }` — abonelik kabul edildi. */
  CHAT_SUBSCRIBED: "chat.subscribed",
  CHAT_UNSUBSCRIBED: "chat.unsubscribed",
  /**
   * Yeni mesaj. Tel üzerinde ayrı bir `eventType` DEĞİL — `messageId`
   * taşıyan zarf; ağ geçidi istemcisi onu hem sohbet aboneliğine hem bu
   * ada yayar.
   */
  MESSAGE_CREATE: "message.create",
  /** `{ chatId, message }` — düzenleme, silme, aktivite kartı, arama özeti. */
  MESSAGE_UPDATE: "message.update",
  /** `{ chatId, delta }` */
  MESSAGE_REACTION: "message.reaction",
  /** `{ message, sender, directId, isSpam }` — DM bildirimi (kullanıcı odası). */
  MESSAGE_NOTIFICATION: "message.notification",
  /** `{ readState }` */
  READ_STATE_UPDATED: "read_state.updated",
  /** `{ directId }` */
  DIRECTS_UPDATED: "directs.updated",
  /** `{ serverId, channelId, messageId, senderId }` — sunucu okunmamış rozeti. */
  CHANNEL_MESSAGE: "channel.message",
  /** `{ serverId }` — sunucudan çıkarıldın. */
  SERVERS_REMOVED: "servers.removed",
  /** `{ serverId }` — sunucu silindi. */
  SERVER_DELETED: "server.deleted",
  FRIEND_REQUEST: "friend.request",
  FRIEND_REQUEST_UPDATED: "friend.request_updated",
  /** `{ channelId, participants, startTime, info? }` */
  VOICE_UPDATE: "voice.update",
  VOICE_CHANNEL_EMPTY: "voice.channel_empty",
  /** `{ channels: [...] }` */
  VOICE_ACTIVE_CHANNELS: "voice.active_channels",
  CALL_INCOMING: "call.incoming",
  CALL_ACCEPTED: "call.accepted",
  CALL_DENIED: "call.denied",
  CALL_CANCELLED: "call.cancelled",
  CALL_HANDLED_ELSEWHERE: "call.handled_elsewhere",
  ACTIVITY_UPDATE: "activity.update",
  ACTIVITY_CURRENT_STATE: "activity.current_state",
  ACTIVITY_SYNC: "activity.sync",
  ACTIVITY_ENDED: "activity.ended",
  /** Bot: bağlantı kurulunca bir kez — `BotReadyEvent`. */
  BOT_READY: "ready",
  /** Bot: bir sunucuya (yeniden) kuruldu — `BotGuildCreateEvent`. */
  BOT_GUILD_CREATE: "bot.guild_create",
  /** Bot: kurulu olduğu sunucuda yeni mesaj — `BotMessageCreateEvent`. */
  BOT_MESSAGE_CREATE: "bot.message_create",
} as const;

export type ServerEvent = (typeof ServerEvents)[keyof typeof ServerEvents];

// ── Hata karesi ─────────────────────────────────────────────────────

/**
 * Ağ geçidinin reddettiği kare. `eventType` DEĞİL `type: "error"` taşır;
 * `retryable` true ise aynı istek daha sonra tekrar denenebilir.
 */
export interface GatewayErrorFrame {
  type: "error";
  code:
    | "invalid_payload"
    | "unknown_event"
    | "rate_limited"
    | "binary_not_supported"
    | "payload_too_large"
    | "forbidden"
    | "unavailable"
    | "too_many_subscriptions"
    | "empty_message"
    | "content_too_long"
    | "slow_mode"
    | "invalid_reply_target"
    | "unknown_reply_target"
    | "internal_error"
    | (string & {});
  retryable: boolean;
  /** İstemcinin gönderdiği `client_nonce` (varsa). */
  clientNonce?: string;
  /** Abonelik reddinde hangi sohbete ait olduğu. */
  chatId?: string;
}

export function isGatewayError(frame: unknown): frame is GatewayErrorFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame as { type?: unknown }).type === "error" &&
    typeof (frame as { code?: unknown }).code === "string"
  );
}

// ── Payload tipleri ─────────────────────────────────────────────────

/** `presence.update` yükü. */
export interface PresenceUpdatePayload {
  userId: string;
  status: PresenceStatus;
}

/** `presence.self` — yalnızca kendi durumun. */
export interface PresenceSelfPayload {
  status: PresenceStatus;
}

/** Zengin durum ("… oynuyor") — uygulama tarafından serbest biçimli. */
export interface RichPresenceActivity {
  type: "PLAYING" | "LISTENING" | "STREAMING" | "WATCHING" | "WORKING" | "CREATING" | "COMPETING";
  name: string;
  details?: string;
  state?: string;
  processName?: string;
  startedAt?: number;
  largeImageUrl?: string;
  smallImageUrl?: string;
  appIconUrl?: string;
  timestamps?: { start: number; end?: number };
}

/** `presence.batch` yükü. */
export interface PresenceBatchPayload {
  statuses: PresenceUpdatePayload[];
}

export interface RichPresenceUpdatePayload {
  userId: string;
  activity: RichPresenceActivity | null;
}

/** `typing` (ağ geçidi → istemci). */
export interface TypingPayload {
  chatId: string;
  isTyping: boolean;
  profile: { id: string; username: string; name: string | null; imageUrl: string | null };
}

export interface ReactionDelta {
  messageId: string;
  action: "add" | "remove";
  /** Delta yalnız seçilen alanları taşır; chat id cache'ten tamamlanır. */
  reaction: Pick<Reaction, "id" | "emoji" | "profileId"> &
    Partial<Pick<Reaction, "messageId" | "directMessageId" | "createdAt">>;
}

// ── Bot olayları ────────────────────────────────────────────────────

export interface BotGuild {
  id: string;
  name: string;
  /** 64 bit izin bit alanı — BigInt hassasiyeti için DİZGİ. */
  permissions: string;
}

/** `ready` — bot bağlandığında bir kez. */
export interface BotReadyEvent {
  eventType: "ready";
  bot: { id: string; username: string; name: string | null; imageUrl: string | null };
  guilds: BotGuild[];
}

/** `bot.guild_create` — bot bir sunucuya (yeniden) kuruldu. */
export interface BotGuildCreateEvent extends BotGuild {
  eventType: "bot.guild_create";
}

export interface BotMessageAuthor {
  id: string;
  username: string;
  name: string | null;
  isBot: boolean;
}

/** Yanıtlanan mesajın özeti (`bot.message_create` ve REST geçmişinde). */
export interface BotReferencedMessage {
  id: string;
  content: string;
  author: BotMessageAuthor | null;
}

/** `bot.message_create` — botun kurulu olduğu bir sunucuda yeni mesaj. */
export interface BotMessageCreateEvent {
  eventType: "bot.message_create";
  id: string;
  content: string;
  channelId: string;
  serverId: string;
  /** ISO 8601 */
  createdAt: string;
  replyToId: string | null;
  referencedMessage: BotReferencedMessage | null;
  author: BotMessageAuthor | null;
  embeds: unknown[];
}
