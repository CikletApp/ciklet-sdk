/**
 * Ciklet kimlik akışı sözleşmeleri — kayıt, doğrulama, şifre sıfırlama ve
 * yasal onay.
 *
 * Kaynak gerçeği ciklet-web'deki rotalardır:
 *   POST   /api/register                 → src/app/api/register/route.ts
 *   POST   /api/auth/verify-email        → src/app/api/auth/verify-email/route.ts
 *   PUT    /api/auth/verify-email        → aynı dosya (kodu yeniden gönderir)
 *   POST   /api/auth/forgot-password     → src/app/api/auth/forgot-password/route.ts
 *   POST   /api/auth/reset-password      → src/app/api/auth/reset-password/route.ts
 *   POST   /api/eula                     → src/app/api/eula/route.ts
 *
 * Bu uçların HİÇBİRİ mobile özel değildir: web istemcisi de aynılarını
 * çağırır. Mobil ve masaüstü istemciler kendi paralel akışlarını
 * yazmak yerine buradaki tiplere yaslanır — böylece web'de bir alan
 * değiştiğinde derleme, çalışma zamanında sessiz bozulma yerine hata verir.
 */

// ── Kayıt (POST /api/register) ──────────────────────────────────────

export interface RegisterRequest {
  /** 2-32 karakter, yalnızca `[a-zA-Z0-9_.]` (sunucu aynı deseni uygular). */
  username: string;
  /** 6-200 karakter. */
  password: string;
  /** Zorunlu: şifre sıfırlama hesabı kullanıcı adı + e-posta ile bulur. */
  email: string;
  /** Görünen ad; sunucu 50 karaktere kırpar. Boş bırakılabilir. */
  name?: string | null;
  /** ISO 8601. Sunucu gelecekteki ve 150 yıldan eski tarihleri reddeder. */
  dateOfBirth?: string | null;
  marketingConsent?: boolean;
}

/**
 * Kayıt hesabı DOĞRULANMAMIŞ olarak açar. `requiresVerification` her zaman
 * `true` döner; istemci doğrudan doğrulama ekranına geçmelidir — giriş bu
 * adım tamamlanmadan reddedilir.
 */
export interface RegisterResponse {
  ok: true;
  requiresVerification: true;
  username: string;
  email: string;
}

/**
 * `/api/register` hataları düz METİN gövdeyle döner (JSON değil).
 * İstemciler kullanıcıya gösterilecek metni bu sabitlerle eşleştirir.
 */
export const RegisterError = {
  USERNAME_TAKEN: "Username already exists",
  EMAIL_TAKEN: "Email already in use",
  INVALID_EMAIL: "Invalid email",
  INVALID_USERNAME: "Invalid username",
  INVALID_DATE_OF_BIRTH: "Invalid date of birth",
  MISSING_CREDENTIALS: "Missing username or password",
  PASSWORD_LENGTH: "Password must be 6-200 characters",
  TOO_MANY: "Too many registrations",
} as const;
export type RegisterError = (typeof RegisterError)[keyof typeof RegisterError];

// ── E-posta doğrulama (/api/auth/verify-email) ──────────────────────

export interface VerifyEmailRequest {
  username: string;
  /** 6 haneli sayısal kod. */
  code: string;
}

export interface VerifyEmailResponse {
  ok: true;
}

/** Kodu yeniden gönder (PUT). Hesabın varlığını sızdırmamak için her zaman aynı yanıt. */
export interface ResendVerificationRequest {
  username: string;
}

export interface ResendVerificationResponse {
  ok: true;
  cooldownSecs: number;
}

/**
 * Doğrulama hatası gerekçesi. `already_verified` bir HATA değil,
 * YÖNLENDİRME sebebidir: istemci kullanıcıyı giriş ekranına almalıdır.
 */
export const VerifyEmailReason = {
  INVALID: "invalid",
  EXPIRED: "expired",
  NO_PENDING: "no_pending",
  ALREADY_VERIFIED: "already_verified",
} as const;
export type VerifyEmailReason =
  (typeof VerifyEmailReason)[keyof typeof VerifyEmailReason];

export interface VerifyEmailErrorResponse {
  error: string;
  reason: VerifyEmailReason;
}

// ── Şifre sıfırlama ─────────────────────────────────────────────────

/**
 * POST /api/auth/forgot-password — kodu gönderir.
 *
 * ⚠️ Hesap VAR OLMASA DA 200 döner ve gövde aynıdır. Bu bilinçlidir:
 * uç, kayıtlı kullanıcı adlarını taramak için kullanılamaz. İstemci
 * "kod gönderildi" ekranına her durumda geçmelidir.
 */
export interface ForgotPasswordRequest {
  username: string;
  email: string;
}

export interface ForgotPasswordResponse {
  ok: true;
  message: string;
  cooldownSecs: number;
}

/**
 * POST /api/auth/reset-password — kodu doğrular ve yeni şifreyi TEK adımda
 * yazar. Sunucu bilerek iki adıma bölünmemiştir: arada kodun harcandığı ama
 * şifrenin değişmediği bir durum kalmasın diye.
 *
 * Başarılı sıfırlama hesabın TÜM oturumlarını düşürür (passwordChangedAt
 * damgalanır) — istemci kullanıcıyı giriş ekranına almalıdır.
 */
export interface ResetPasswordRequest {
  username: string;
  email: string;
  /** 8 karakterlik harf+rakam kod; büyük/küçük harf farkı gözetilmez. */
  code: string;
  newPassword: string;
}

export interface ResetPasswordResponse {
  ok: true;
  message: string;
}

// ── Tek kullanımlık kodlar ──────────────────────────────────────────

/**
 * İki kod biçimi, iki tehdit modeli (ciklet-web src/lib/otp.ts ile birebir):
 *
 *  • KAYIT DOĞRULAMA → 6 hane, yalnızca rakam. Kod hesabı olmayan birine
 *    gider; tek işlevi "bu adres senin mi" sorusunu yanıtlamak.
 *  • ŞİFRE SIFIRLAMA → 8 karakter, harf+rakam. Bu kodu ele geçiren hesabı
 *    devralır; 10^6 ihtimal bu akış için fazla dardır.
 */
export const NUMERIC_CODE_LENGTH = 6;
export const ALPHANUMERIC_CODE_LENGTH = 8;

/**
 * Görsel olarak karışan gliflerin hiçbir yazımı alfabede yok:
 * `0/O/o`, `1/I/i`, `L/l` elenmiştir — kullanıcı kodu e-postadan okuyup elle
 * yazıyor ve "sıfır mı O mu" sorusu doğrudan başarısız denemeye dönüşür.
 * Geriye 23 harf + 8 rakam = 31 sembol kalır.
 */
export const ALPHANUMERIC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Giriş kutusunun süzeceği karakterler — alfabeyle birebir aynı küme. */
export const ALPHANUMERIC_INPUT_FILTER = /[^A-HJKMNP-Z2-9]/g;

/**
 * Kodu sunucunun beklediği tek biçime indirger: boşluk/tire atılır, harfler
 * büyütülür. Kullanıcı e-postadan kopyalarken araya boşluk karışır ve
 * gösterimdeki harf büyüklüğünü taklit etmek zorunda bırakılmamalıdır.
 */
export function canonicalizeCode(value: string): string {
  return value.replace(/[\s-]+/g, "").toUpperCase();
}

// ── Yasal onay (POST /api/eula) ─────────────────────────────────────

/**
 * Son Kullanıcı Sözleşmesi onayı.
 *
 * Web'de akış şudur: giriş → `/redirect` → `profile.eulaAccepted` false ise
 * sözleşme ekranı, kabul edilince `/friends`. Diğer istemciler de AYNI kapıyı
 * uygulamak zorundadır; aksi halde sözleşmeyi mobilden atlamak mümkün olur.
 */
export interface AcceptEulaResponse {
  success: true;
}

/** Sözleşmenin sürümü ve tarihi — istemcilerde başlıkta gösterilir. */
export const EULA_VERSION = "1.0.0";
export const EULA_EFFECTIVE_DATE = "12 Mart 2026";
