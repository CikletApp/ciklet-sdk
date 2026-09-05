/**
 * Push bildirimi sözleşmesi (Expo Push Service).
 *
 * Kaynak gerçeği ciklet-web'dir:
 *   src/pages/api/push/register.ts  — cihaz kaydı ve tercihler
 *   src/lib/push.ts                 — gönderim, kanal ve öncelik seçimi
 *
 * Soket yalnızca uygulama süreci yaşarken vardır. Uygulama TAMAMEN
 * KAPALIYKEN gelen mesaj ve aramanın telefonda görünmesinin tek yolu bu
 * kayıttır; bu yüzden token kaydı bir "ekstra" değil, çağrı akışının
 * zorunlu parçasıdır.
 */

// ── Cihaz kaydı ─────────────────────────────────────────────────────

export type PushPlatform = "ios" | "android";

/**
 * POST /api/push/register.
 *
 * Tercihler cihaz BAŞINA saklanır: aynı hesabın telefonunda arama bildirimi
 * açık, tabletinde kapalı olabilir. Sunucu gönderimden önce bu bayrakları
 * süzer — istemcinin gelen bildirimi bastırması yetmez, çünkü uygulama
 * kapalıyken bastıracak kod çalışmaz.
 */
export interface PushRegisterRequest {
  /** `ExponentPushToken[...]` biçiminde; sunucu deseni doğrular. */
  token: string;
  platform: PushPlatform;
  messagesEnabled?: boolean;
  callsEnabled?: boolean;
  friendRequestsEnabled?: boolean;
  soundEnabled?: boolean;
}

export interface PushRegisterResponse {
  id: string;
  platform: PushPlatform;
  updatedAt: string;
}

/** DELETE /api/push/register — çıkışta çağrılır; 204 döner. */
export interface PushUnregisterRequest {
  token: string;
}

// ── Gelen bildirimin yükü ───────────────────────────────────────────

/**
 * Bildirim türü. `sendPushToProfile` bunu hem kanal hem öncelik seçmek için
 * kullanır: `call` → yüksek öncelik ve zil kanalı, 45 sn TTL.
 */
export const PushKind = {
  MESSAGE: "message",
  CALL: "call",
  FRIEND: "friend",
} as const;
export type PushKind = (typeof PushKind)[keyof typeof PushKind];

/**
 * Android bildirim kanalları. İstemci bu adlarla kanalları önceden
 * oluşturmalıdır; sunucu gönderirken aynı adları kullanır ve Android
 * bilinmeyen kanala düşen bildirimi varsayılan (sessiz) kanalda gösterir.
 */
export const PUSH_CHANNEL_MESSAGES = "ciklet-messages";
export const PUSH_CHANNEL_CALLS = "ciklet-calls";

/**
 * `notification.request.content.data` içeriği.
 *
 * Expo tüm veri alanlarını dize olarak taşır; sayıya/boole'a çevirmeye
 * çalışan istemci kod yazmamalıdır.
 */
export interface PushDataBase {
  type: PushKind;
  /**
   * Derin bağlantı yolu. İstemci bunu doğrudan yönlendiriciye vermeden ÖNCE
   * kendi rota tablosunda karşılığı olduğunu doğrulamalıdır — web ve mobil
   * rota şemaları aynı değildir.
   */
  url?: string;
}

export interface PushMessageData extends PushDataBase {
  type: "message";
  /** Sohbetin kimliği — istemci ekranı bundan açar. */
  directId: string;
}

export interface PushCallData extends PushDataBase {
  type: "call";
  /** Sunucudaki davet kimliği; `call_accepted` / `call_denied` ile geri gönderilir. */
  callId: string;
  callerId: string;
  /** LiveKit oda adı olarak kullanılan DM kimliği. Boş dize = bilinmiyor. */
  directId: string;
}

export interface PushFriendData extends PushDataBase {
  type: "friend";
}

export type PushData = PushMessageData | PushCallData | PushFriendData;

/**
 * Gelen `data` nesnesini güvenle daraltır.
 *
 * Bildirim yükü ağdan gelir ve eski bir sunucu sürümünden çıkmış olabilir;
 * `data.type` yoksa ya da tanınmıyorsa istemci bildirimi yine göstermeli,
 * yalnızca türe özel davranışı (zil ekranı gibi) atlamalıdır.
 */
export function parsePushData(data: unknown): PushData | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const type = record.type;
  const url = typeof record.url === "string" ? record.url : undefined;

  if (type === PushKind.MESSAGE) {
    const directId = typeof record.directId === "string" ? record.directId : "";
    return directId ? { type: "message", directId, url } : null;
  }

  if (type === PushKind.CALL) {
    const callId = typeof record.callId === "string" ? record.callId : "";
    const callerId = typeof record.callerId === "string" ? record.callerId : "";
    if (!callId || !callerId) return null;
    return {
      type: "call",
      callId,
      callerId,
      directId: typeof record.directId === "string" ? record.directId : "",
      url,
    };
  }

  if (type === PushKind.FRIEND) return { type: "friend", url };

  return null;
}
