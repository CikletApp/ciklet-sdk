/**
 * Ciklet gerçek zamanlı (Socket.IO) sözleşmesi.
 *
 * Kaynak gerçeği ciklet-web'deki Socket.IO sunucusudur
 * (`src/pages/api/socket/io.ts` + `src/lib/constants.ts`); buradaki her ad
 * oradaki `socket.on(...)` / `.emit(...)` çağrılarıyla birebir doğrulanır.
 * İstemciler string sabit yazmak yerine buradaki sabitleri/yardımcıları
 * kullanmalıdır.
 */

import type { PresenceStatus, Reaction } from "./entities";

/** Socket.IO el sıkışma yolu (ciklet-web custom server). */
export const SOCKET_PATH = "/api/socket/io";

// ── İstemci → sunucu ────────────────────────────────────────────────

export const ClientEvents = {
  /** `{ chatId }` veya `{ chatIds: [] }` — üyelik sunucuda doğrulanır. */
  CHAT_SUBSCRIBE: "chat:subscribe",
  CHAT_UNSUBSCRIBE: "chat:unsubscribe",
  /** Canlılık sinyali; sunucu `heartbeat_ack` ile yanıtlar. */
  HEARTBEAT: "heartbeat",
  /** `{ isIdle }` — kullanıcı etkileşimi kesildi/döndü. */
  PRESENCE_IDLE: "presence:idle",
  /** `{ status }` — kullanıcının ELLE seçtiği durum. */
  PRESENCE_SET_STATUS: "presence:set_status",
  /** Arkadaş/sunucu listesi değişince abonelikleri yeniden kurar. */
  PRESENCE_SYNC: "presence:sync",
  RICH_PRESENCE_UPDATE: "rich_presence:update",
  /** `{ type: 'direct' | 'channel', id, isTyping }` */
  TYPING: "typing",
  /** `{ channelId?, directId?, messageId }` — okundu bilgisi. */
  MESSAGE_ACK: "MESSAGE_ACK",
  FRIEND_REQUEST: "friend_request",
  FRIEND_REQUEST_UPDATED: "friend_request_updated",
  GET_ACTIVE_VOICE_CHANNELS: "get_active_voice_channels",
  JOIN_VOICE_CHANNEL: "join_voice_channel",
  LEAVE_VOICE_CHANNEL: "leave_voice_channel",
  INCOMING_CALL: "incoming_call",
  CALL_ACCEPTED: "call_accepted",
  CALL_DENIED: "call_denied",
  CALL_CANCELLED: "call_cancelled",
  SYNC_CALL_STATE: "sync_call_state",
  ACTIVITY_UPDATE: "activity_update",
  ACTIVITY_SYNC: "activity_sync",
  ACTIVITY_ENDED: "activity_ended",
} as const;

// ── Sunucu → istemci ────────────────────────────────────────────────

export const ServerEvents = {
  READY: "ready",
  HEARTBEAT_ACK: "heartbeat_ack",
  /** `{ statuses: [{userId,status}], activities: Record<id,activity> }`. */
  PRESENCE_BATCH: "presence:batch",
  /** `{ userId, status }` — tek kullanıcı presence değişimi. */
  PRESENCE_UPDATE: "presence:update",
  /** `{ status }` — kendi görünür durumun (INVISIBLE dahil). */
  PRESENCE_SELF: "presence:self",
  /** `{ userId, activity }` */
  RICH_PRESENCE_UPDATE: "rich_presence:update",
  TYPING: "typing",
  READ_STATE_UPDATED: "READ_STATE_UPDATED",
  NEW_MESSAGE: "new_message",
  FRIEND_REQUEST: "friend_request",
  FRIEND_REQUEST_UPDATED: "friend_request_updated",
  VOICE_CHANNEL_UPDATE: "voice_channel_update",
  ACTIVE_VOICE_CHANNELS: "active_voice_channels",
  INCOMING_CALL: "incoming_call",
  CALL_ACCEPTED: "call_accepted",
  CALL_DENIED: "call_denied",
  CALL_CANCELLED: "call_cancelled",
  CALL_REJECTED: "call_rejected",
  CALL_HANDLED_ELSEWHERE: "call_handled_elsewhere",
  PENDING_CALL_INVITES: "pending_call_invites",
  ACTIVITY_UPDATE: "activity_update",
  ACTIVITY_SYNC: "activity_sync",
  ACTIVITY_ENDED: "activity_ended",
} as const;

/**
 * @deprecated Yön bilgisi yanlıştı (`PRESENCE_SELF` istemci→sunucu diye
 * belgelenmişti; gerçekte sunucu yayınlar, istemci `presence:set_status`
 * gönderir). `ClientEvents` / `ServerEvents` kullanın.
 */
export const SocketEvents = {
  CHAT_SUBSCRIBE: ClientEvents.CHAT_SUBSCRIBE,
  PRESENCE_BATCH: ServerEvents.PRESENCE_BATCH,
  PRESENCE_IDLE: ClientEvents.PRESENCE_IDLE,
  PRESENCE_SELF: ServerEvents.PRESENCE_SELF,
  PRESENCE_SYNC: ClientEvents.PRESENCE_SYNC,
  PRESENCE_UPDATE: ServerEvents.PRESENCE_UPDATE,
  RICH_PRESENCE_UPDATE: ServerEvents.RICH_PRESENCE_UPDATE,
} as const;

// ── Sohbete özel dinamik olay adları ────────────────────────────────

/**
 * Bir sohbete (kanal veya DM) gelen YENİ mesaj olayı.
 * ciklet-web karşılığı: `SOCKET_EVENTS.chatMessages`.
 */
export const chatMessagesEvent = (chatId: string) =>
  `chat:${chatId}:messages` as const;

/**
 * Var olan bir mesajın güncellenmesi (düzenleme, silme, reaksiyon).
 * ciklet-web karşılığı: `SOCKET_EVENTS.chatUpdate`.
 */
export const chatUpdateEvent = (chatId: string) =>
  `chat:${chatId}:messages:update` as const;

/** Mesaja tepki ekleme/kaldırma deltası. */
export const chatReactionEvent = (chatId: string) =>
  `chat:${chatId}:reaction` as const;

/**
 * @deprecated İki nedenle yanlıştı:
 *  1. Sunucudaki ODA adı `chatroom:<id>` (bkz. `SOCKET_ROOMS.chat`),
 *     bu fonksiyonun ürettiği `chat:<id>` değil.
 *  2. İstemciler odaya isimle KATILMAZ; `chat:subscribe` yayınlar ve
 *     dinlemesi gereken OLAY `chat:<id>:messages`'tır.
 * Bu adı dinleyen istemciler hiçbir zaman mesaj almaz.
 * Yerine `chatMessagesEvent()` / `chatUpdateEvent()` kullanın.
 */
export const chatRoom = (chatId: string) => `chat:${chatId}` as const;

/** Kalıcı olmayan (yazıyor... gibi) sohbet olayları odası. */
export const ephemeralChatRoom = (chatId: string) =>
  `ephemeral_chat:${chatId}` as const;

// ── Payload tipleri ─────────────────────────────────────────────────

/**
 * `presence:update` yükü.
 *
 * ⚠️ Alan adları sunucudan geldiği gibidir: `userId` / `status`.
 * (Önceki sürüm `profileId` / `presenceStatus` diyordu — hiçbir istemci
 * presence çözemiyordu.)
 */
export interface PresenceUpdatePayload {
  userId: string;
  status: PresenceStatus;
}

/** `presence:self` — yalnızca kendi durumun. */
export interface PresenceSelfPayload {
  status: PresenceStatus;
}

/** Zengin durum ("… oynuyor") — uygulama tarafından serbest biçimli. */
export interface RichPresenceActivity {
  type: "PLAYING" | "LISTENING" | "STREAMING" | "WATCHING" | "WORKING" | "CREATING" | "COMPETING";
  name: string;
  details?: string;
  state?: string;
  processName: string;
  startedAt: number;
  largeImageUrl?: string;
  smallImageUrl?: string;
  appIconUrl?: string;
  timestamps?: { start: number; end: number };
}

/**
 * `presence:batch` yükü. `statuses`, sunucudaki Map'in
 * `Array.from(map, ([userId,status]) => ({userId,status}))` çıktısıdır;
 * `activities` ise kullanıcı kimliğine göre anahtarlı nesnedir.
 */
export interface PresenceBatchPayload {
  statuses: PresenceUpdatePayload[];
  activities: Record<string, RichPresenceActivity>;
}

/** Eski sunucular sarmalayıcı olmadan yalnız status dizisi yayınlayabilir. */
export type PresenceBatchMessage = PresenceBatchPayload | PresenceUpdatePayload[];

export function normalizePresenceBatch(message: PresenceBatchMessage): PresenceBatchPayload {
  if (Array.isArray(message)) return { statuses: message, activities: {} };
  return {
    statuses: Array.isArray(message?.statuses) ? message.statuses : [],
    activities: message?.activities ?? {},
  };
}

export interface RichPresenceUpdatePayload {
  userId: string;
  activity: RichPresenceActivity | null;
}

export interface ReactionDelta {
  messageId: string;
  action: "add" | "remove";
  /** HTTP/socket delta yalnız seçilen alanları taşır; chat id cache'ten tamamlanır. */
  reaction: Pick<Reaction, "id" | "emoji" | "profileId"> &
    Partial<Pick<Reaction, "messageId" | "directMessageId" | "createdAt">>;
}
