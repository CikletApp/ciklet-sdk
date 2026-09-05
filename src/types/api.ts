/**
 * Ciklet HTTP API sözleşmeleri — istemcilerin (mobil/desktop/bot) ciklet-web
 * API'siyle konuşurken kullandığı istek/yanıt tipleri.
 */

import type { OwnProfile } from "./entities";

/** Üretim API kökü. İstemciler geliştirmede kendi base URL'ini geçebilir. */
export const DEFAULT_API_BASE_URL = "https://ciklet.xyz";

// ── Mobil auth (POST /api/mobile/auth) ──────────────────────────────

export interface MobileAuthRequest {
  username: string;
  password: string;
  /**
   * İki adımlı doğrulama kodu. Hesapta 2FA açıkken şifre DOĞRU olsa bile
   * uç `totp_required` ile 401 döner; istemci kodu alıp aynı isteği bu
   * alanla tekrarlar. Kurtarma kodları da buraya yazılır.
   */
  totp?: string;
  /**
   * Cihaz parmak izi. Donanım banı bu değeri okur (ciklet-web lib/hwid.ts);
   * gönderilmezse ban yalnızca hesap düzeyinde uygulanabilir.
   */
  hwid?: string;
  /** Telemetri için: "android" | "ios" | "desktop" ... */
  clientType?: string;
  clientVersion?: string;
}

/**
 * Girişin makine-okunur hata kodları (`ApiErrorResponse.code`).
 *
 * Bunlar HATA METNİ değil AKIŞ YÖNLENDİRMESİDİR ve istemci her birini ayrı
 * ele almak zorundadır: `email_not_verified` doğrulama ekranına,
 * `totp_required` ikinci faktör adımına gider. Hepsini "kullanıcı adı veya
 * şifre hatalı" diye göstermek, şifresi DOĞRU olan kullanıcıyı çıkışsız
 * bırakır.
 */
export const MobileAuthErrorCode = {
  EMAIL_NOT_VERIFIED: "email_not_verified",
  TOTP_REQUIRED: "totp_required",
  TOTP_INVALID: "totp_invalid",
} as const;
export type MobileAuthErrorCode =
  (typeof MobileAuthErrorCode)[keyof typeof MobileAuthErrorCode];

export interface MobileAuthResponse {
  /**
   * NextAuth oturum token'ı (JWE). İstemci bunu güvenli depoda saklar ve her
   * isteğe `Cookie: <cookieName>=<token>` başlığıyla ekler — böylece mevcut
   * tüm API rotaları ve Socket.IO el sıkışması değişiklik gerektirmeden
   * çalışır.
   */
  token: string;
  /** Ortama göre çerez adı (prod: __Secure-next-auth.session-token). */
  cookieName: string;
  /** Token'ın geçerlilik sonu (ISO). Yaklaşınca /refresh çağrılır. */
  expiresAt: string;
  profile: AuthenticatedProfile;
}

/**
 * Giriş yanıtındaki profil.
 *
 * `OwnProfile`'a ek olarak yasal onay durumunu taşır: istemci girişten
 * SONRA sözleşme ekranını gösterip göstermeyeceğini bilmek zorundadır ve
 * bunun için ayrı bir tur atmak, kabul edilmemiş sözleşmeyle uygulamanın
 * bir an açılmasına yol açardı.
 *
 * Eski sunucular bu alanı göndermeyebilir; `undefined` "bilinmiyor"
 * demektir ve istemci `/api/current-profile` yanıtından tamamlar.
 */
export interface AuthenticatedProfile extends OwnProfile {
  eulaAccepted?: boolean;
}

/** POST /api/mobile/auth/refresh — geçerli token ile çağrılır, yenisini döner. */
export interface MobileAuthRefreshResponse {
  token: string;
  cookieName: string;
  expiresAt: string;
}

export interface ApiErrorResponse {
  error: string;
  /**
   * Makine-okunur kod. Yalnızca bazı uçlar döner; metne göre dallanmak
   * yerine mümkün olan her yerde bu okunmalıdır — hata metinleri
   * yerelleştirmeyle değişir, kodlar değişmez.
   */
  code?: string;
}

// ── Kendi profilin (GET /api/current-profile) ───────────────────────

/**
 * `/api/current-profile` yanıtı — ciklet-web `lib/client-profile.ts`
 * içindeki `ClientProfile` allowlist'iyle birebir.
 *
 * `MobileAuthResponse.profile`'dan FARKLIDIR: giriş yanıtı herkese açık alt
 * kümeyi döner, bu uç ise yalnızca sahibine gösterilen alanları da taşır
 * (e-posta, gizlilik tercihleri, yasal onay). İki tipin ayrı tutulması
 * bilinçlidir; birleştirmek e-postanın herkese açık payload'lara sızma
 * riskini geri getirirdi.
 */
export interface CurrentProfileResponse {
  id: string;
  username: string;
  name: string | null;
  imageUrl: string | null;
  email: string | null;
  /** Ham numara sunucudan hiç çıkmaz; yalnızca maskeli hâli gelir. */
  phoneMasked: string | null;
  isPhoneVerified: boolean;
  isBot: boolean;
  isOfficial: boolean;
  pronouns: string | null;
  bio: string | null;
  bannerColor: string | null;
  presenceStatus: string;
  /** Yasal onay kapısı. `false` ise istemci sözleşme ekranını göstermelidir. */
  eulaAccepted: boolean;
  dmPermission: "EVERYONE" | "FRIENDS_ONLY" | "NOBODY" | null;
  spamFilter: "ALL" | "NON_FRIENDS" | "NONE" | null;
  friendReqEveryone: boolean | null;
  friendReqFriendsOfFriends: boolean | null;
  friendReqServerMembers: boolean | null;
  passwordChangedAt: string | null;
  usernameChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
