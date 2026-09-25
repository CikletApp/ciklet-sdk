/**
 * Ciklet HTTP API sözleşmeleri — istemcilerin (mobil/desktop/bot) ciklet-web
 * API'siyle konuşurken kullandığı istek/yanıt tipleri.
 */

import type { OwnProfile } from "./entities.js";

/** Üretim API kökü. İstemciler geliştirmede kendi base URL'ini geçebilir. */
export const DEFAULT_API_BASE_URL = "https://ciklet.xyz";

// ── Mobil auth (POST /api/mobile/auth) ──────────────────────────────

export interface MobileAuthRequest {
  username: string;
  password: string;
  /** Telemetri için: "android" | "ios" | "desktop" ... */
  clientType?: string;
  clientVersion?: string;
}

export interface MobileAuthResponse {
  /**
   * NextAuth oturum token'ı (JWE). İstemci bunu güvenli depoda saklar ve her
   * isteğe `Cookie: <cookieName>=<token>` başlığıyla ekler — böylece mevcut
   * tüm API rotaları ve ağ geçidi (WebSocket) el sıkışması değişiklik
   * gerektirmeden çalışır.
   */
  token: string;
  /** Ortama göre çerez adı (prod: __Secure-next-auth.session-token). */
  cookieName: string;
  /** Token'ın geçerlilik sonu (ISO). Yaklaşınca /refresh çağrılır. */
  expiresAt: string;
  profile: OwnProfile;
}

/** POST /api/mobile/auth/refresh — geçerli token ile çağrılır, yenisini döner. */
export interface MobileAuthRefreshResponse {
  token: string;
  cookieName: string;
  expiresAt: string;
}

export interface ApiErrorResponse {
  error: string;
}

// ── Mesaj sayfalama (GET /api/messages, /api/direct-messages) ───────

/**
 * Sonsuz kaydırma sözleşmesi: `cursor` verilmezse en yeni sayfa döner;
 * `nextCursor` null ise geçmişin sonuna ulaşılmıştır.
 */
export interface MessagesPage<TMessage> {
  items: TMessage[];
  nextCursor: string | null;
}

// ── LiveKit token (GET /api/livekit?room=...&username=...) ──────────

export interface LiveKitTokenResponse {
  token: string;
}
