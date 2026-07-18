/**
 * Ciklet gerçek zamanlı (Socket.IO) sözleşmesi.
 *
 * Kaynak gerçeği ciklet-web'deki Socket.IO sunucusudur; event adları oradaki
 * kullanımla birebir aynıdır. İstemciler string sabit yazmak yerine buradaki
 * sabitleri/yardımcıları kullanmalıdır.
 */

import type { PresenceStatus } from "./entities";

/** Socket.IO el sıkışma yolu (ciklet-web custom server). */
export const SOCKET_PATH = "/api/socket/io";

// ── Sabit event adları ──────────────────────────────────────────────

export const SocketEvents = {
  /** İstemci → sunucu: bir sohbetin canlı akışına abone ol. */
  CHAT_SUBSCRIBE: "chat:subscribe",
  /** Sunucu → istemci: toplu presence durumu. */
  PRESENCE_BATCH: "presence:batch",
  /** İstemci → sunucu: kullanıcı boşta (idle) bildirimi. */
  PRESENCE_IDLE: "presence:idle",
  /** İstemci → sunucu: kendi presence durumunu değiştir. */
  PRESENCE_SELF: "presence:self",
  /** Sunucu → istemci: presence senkronizasyonu. */
  PRESENCE_SYNC: "presence:sync",
  /** Sunucu → istemci: tek kullanıcı presence değişimi. */
  PRESENCE_UPDATE: "presence:update",
  /** Zengin durum (oynanıyor/dinleniyor...) güncellemesi. */
  RICH_PRESENCE_UPDATE: "rich_presence:update",
} as const;

// ── Dinamik kanal adları ────────────────────────────────────────────

/** Bir sohbetin (kanal veya DM) mesaj akışı odası. */
export const chatRoom = (chatId: string) => `chat:${chatId}` as const;

/** Kalıcı olmayan (yazıyor... gibi) sohbet olayları odası. */
export const ephemeralChatRoom = (chatId: string) =>
  `ephemeral_chat:${chatId}` as const;

// ── Payload tipleri ─────────────────────────────────────────────────

export interface PresenceUpdatePayload {
  profileId: string;
  presenceStatus: PresenceStatus;
}

export type PresenceBatchPayload = PresenceUpdatePayload[];
