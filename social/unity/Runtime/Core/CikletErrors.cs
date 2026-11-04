using System;

namespace Ciklet.Social
{
    /// <summary>Hatanın kaynağı. İptal ayrı bir tür değildir: <see cref="OperationCanceledException"/> fırlar.</summary>
    public enum CikletErrorKind
    {
        /// <summary>Sunucu 4xx/5xx döndü (<see cref="CikletException.Status"/>, <see cref="CikletException.Code"/>).</summary>
        Http,
        /// <summary>Bağlantı kurulamadı, DNS, TLS…</summary>
        Network,
        /// <summary>İstek zaman aşımına uğradı.</summary>
        Timeout,
        /// <summary>Yanıt beklenen biçimde değil (JSON ayrıştırılamadı).</summary>
        Protocol,
        /// <summary>Giriş yok / jeton yenilenemedi / state eşleşmedi / kullanıcı reddetti — yeniden giriş gerekir.</summary>
        Auth,
    }

    public class CikletException : Exception
    {
        public CikletErrorKind Kind { get; }
        /// <summary>HTTP durum kodu; HTTP dışı hatalarda 0.</summary>
        public int Status { get; }
        /// <summary>Sunucunun hata kodu (`unknown_lobby`, `invalid_grant`, `insufficient_scope`…) ya da SDK kodu.</summary>
        public string Code { get; }
        /// <summary>429'da sunucunun önerdiği bekleme (saniye).</summary>
        public double? RetryAfterSeconds { get; }

        public CikletException(CikletErrorKind kind, string code, string message, int status = 0, double? retryAfterSeconds = null, Exception inner = null)
            : base(message, inner)
        {
            Kind = kind;
            Code = code ?? "error";
            Status = status;
            RetryAfterSeconds = retryAfterSeconds;
        }

        /// <summary>Aynı istek bir süre sonra tekrar denenebilir mi (ağ, zaman aşımı, 429, 5xx)?</summary>
        public bool IsRetryable =>
            Kind == CikletErrorKind.Network || Kind == CikletErrorKind.Timeout ||
            (Kind == CikletErrorKind.Http && (Status == 429 || Status >= 500));

        public override string ToString() => $"CikletException({Kind}, {Status}, {Code}): {Message}";
    }
}
