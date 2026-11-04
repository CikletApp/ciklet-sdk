using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    /// <summary>RFC 7636 PKCE yardımcıları (yalnızca S256).</summary>
    public static class Pkce
    {
        /// <summary>32 bayt kriptografik rastgele → 43 karakter base64url verifier.</summary>
        public static string CreateVerifier() => Base64Url(RandomBytes(32));

        public static string CreateState() => Base64Url(RandomBytes(16));

        public static string ComputeChallenge(string verifier)
        {
            using (var sha = SHA256.Create())
                return Base64Url(sha.ComputeHash(Encoding.ASCII.GetBytes(verifier)));
        }

        public static string Base64Url(byte[] bytes) =>
            Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        private static byte[] RandomBytes(int count)
        {
            var bytes = new byte[count];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            return bytes;
        }
    }

    /// <summary>Tek bir yetkilendirme denemesinin parametreleri.</summary>
    public sealed class AuthorizationRequest
    {
        public string ClientId;
        public string RedirectUri;
        public IReadOnlyList<string> Scopes;
        public string State = Pkce.CreateState();
        public string CodeVerifier = Pkce.CreateVerifier();

        /// <summary>`https://ciklet.xyz/oauth/authorize?...` adresi (sistem tarayıcısında açılır).</summary>
        public string BuildUrl(string baseUrl = "https://ciklet.xyz")
        {
            var query = new List<KeyValuePair<string, string>>
            {
                new KeyValuePair<string, string>("client_id", ClientId),
                new KeyValuePair<string, string>("redirect_uri", RedirectUri),
                new KeyValuePair<string, string>("response_type", "code"),
                new KeyValuePair<string, string>("scope", Scopes == null ? null : string.Join(" ", Scopes)),
                new KeyValuePair<string, string>("code_challenge", Pkce.ComputeChallenge(CodeVerifier)),
                new KeyValuePair<string, string>("code_challenge_method", "S256"),
                new KeyValuePair<string, string>("state", State),
            };
            return baseUrl.TrimEnd('/') + "/oauth/authorize?" + CikletHttp.FormEncode(query);
        }
    }

    /// <summary>Erişim + yenileme jetonu. Yenileme jetonu ROTASYONLUDUR: her yenilemede yenisi gelir, hemen saklayın.</summary>
    public sealed class CikletTokens
    {
        public string AccessToken;
        public string RefreshToken;
        public DateTimeOffset ExpiresAt;
        public string[] Scopes = new string[0];

        public bool ExpiresWithin(TimeSpan window, DateTimeOffset now) => now + window >= ExpiresAt;

        public bool HasScope(string scope) => Scopes.Contains(scope);

        public static CikletTokens FromTokenResponse(Dictionary<string, object> d, DateTimeOffset now)
        {
            var access = CikletJson.Str(d, "access_token");
            if (string.IsNullOrEmpty(access)) throw new CikletException(CikletErrorKind.Protocol, "invalid_token_response", "Jeton yanıtında access_token yok.");
            return new CikletTokens
            {
                AccessToken = access,
                RefreshToken = CikletJson.Str(d, "refresh_token"),
                ExpiresAt = now.AddSeconds(CikletJson.Long(d, "expires_in", 3600)),
                Scopes = (CikletJson.Str(d, "scope") ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries),
            };
        }

        public string ToJson() => CikletJson.Serialize(new Dictionary<string, object>
        {
            ["access_token"] = AccessToken,
            ["refresh_token"] = RefreshToken,
            ["expires_at"] = ExpiresAt.ToUnixTimeSeconds(),
            ["scope"] = string.Join(" ", Scopes),
        });

        public static CikletTokens FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            try
            {
                var d = CikletJson.AsObject(CikletJson.Parse(json));
                if (d == null || string.IsNullOrEmpty(CikletJson.Str(d, "access_token"))) return null;
                return new CikletTokens
                {
                    AccessToken = CikletJson.Str(d, "access_token"),
                    RefreshToken = CikletJson.Str(d, "refresh_token"),
                    ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(CikletJson.Long(d, "expires_at")),
                    Scopes = (CikletJson.Str(d, "scope") ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries),
                };
            }
            catch (FormatException)
            {
                return null;
            }
        }
    }

    /// <summary>Jeton saklama. Üretimde işletim sisteminin güvenli deposunu (Windows DPAPI / Keychain) tercih edin.</summary>
    public interface ITokenStore
    {
        CikletTokens Load();
        void Save(CikletTokens tokens);
        void Clear();
    }

    public sealed class InMemoryTokenStore : ITokenStore
    {
        private CikletTokens _tokens;
        public CikletTokens Load() => _tokens;
        public void Save(CikletTokens tokens) => _tokens = tokens;
        public void Clear() => _tokens = null;
    }

    /// <summary>
    /// Kullanıcı girişi: OAuth2 yetkilendirme kodu + PKCE, masaüstü için loopback
    /// geri dönüşü (RFC 8252). Uygulamanız Ciklet Geliştirici Portalı'nda PUBLIC
    /// istemci olmalı ve redirect URI olarak `http://127.0.0.1/callback` kayıtlı
    /// olmalı (port serbest). İstemci gizli anahtarı (client_secret) oyuna KONMAZ.
    /// </summary>
    public sealed class CikletAuth
    {
        private static readonly TimeSpan RefreshWindow = TimeSpan.FromSeconds(60);

        private readonly string _clientId;
        private readonly CikletOptions _options;
        private readonly IHttpTransport _transport;
        private readonly ITokenStore _store;
        private readonly SemaphoreSlim _refreshLock = new SemaphoreSlim(1, 1);
        private CikletTokens _tokens;

        /// <summary>Test için saat.</summary>
        public Func<DateTimeOffset> Clock { get; set; } = () => DateTimeOffset.UtcNow;

        /// <summary>Jetonlar değişince (giriş, yenileme, çıkış=null). Arka plan iş parçacığında gelebilir.</summary>
        public event Action<CikletTokens> TokensChanged;

        public CikletAuth(string clientId, IHttpTransport transport, ITokenStore store = null, CikletOptions options = null)
        {
            if (string.IsNullOrEmpty(clientId)) throw new ArgumentException("clientId gerekli.", nameof(clientId));
            _clientId = clientId;
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _store = store ?? new InMemoryTokenStore();
            _options = options ?? new CikletOptions();
            _tokens = _store.Load();
        }

        public string ClientId => _clientId;
        public CikletOptions Options => _options;
        public CikletTokens Tokens => _tokens;
        public bool IsSignedIn => _tokens != null && !string.IsNullOrEmpty(_tokens.AccessToken);

        /// <summary>
        /// Sistem tarayıcısında Ciklet onay ekranını açar, `127.0.0.1` üzerinde boş bir portu
        /// dinler, kodu alıp jetona çevirir. <paramref name="openBrowser"/> Unity'de
        /// <c>Application.OpenURL</c>. Kullanıcı reddederse <see cref="CikletErrorKind.Auth"/>
        /// (`access_denied`), süre dolarsa <see cref="CikletErrorKind.Timeout"/>.
        /// </summary>
        public async Task<CikletTokens> LoginWithLoopbackAsync(
            IEnumerable<string> scopes,
            Action<string> openBrowser,
            CancellationToken cancellationToken = default,
            TimeSpan? timeout = null,
            int port = 0,
            string callbackPath = "/callback")
        {
            if (openBrowser == null) throw new ArgumentNullException(nameof(openBrowser));
            using (var server = LoopbackCallbackServer.Start(callbackPath, port))
            using (var timeoutCts = new CancellationTokenSource(timeout ?? TimeSpan.FromMinutes(5)))
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token))
            {
                var request = new AuthorizationRequest
                {
                    ClientId = _clientId,
                    RedirectUri = server.RedirectUri,
                    Scopes = scopes?.ToList(),
                };
                openBrowser(request.BuildUrl(_options.BaseUrl));

                LoopbackCallback callback;
                try
                {
                    callback = await server.WaitForCallbackAsync(request.State, linked.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && timeoutCts.IsCancellationRequested)
                {
                    throw new CikletException(CikletErrorKind.Timeout, "login_timeout", "Giriş süresi doldu.");
                }

                if (callback.Error != null)
                    throw new CikletException(CikletErrorKind.Auth, callback.Error, callback.ErrorDescription ?? "Giriş reddedildi.");
                return await ExchangeCodeAsync(callback.Code, request.CodeVerifier, request.RedirectUri, cancellationToken).ConfigureAwait(false);
            }
        }

        /// <summary>Kodu jetona çevirir (kendi geri dönüş yolunuzu kullanıyorsanız).</summary>
        public async Task<CikletTokens> ExchangeCodeAsync(string code, string codeVerifier, string redirectUri, CancellationToken cancellationToken = default)
        {
            var tokens = await TokenRequestAsync(new[]
            {
                new KeyValuePair<string, string>("grant_type", "authorization_code"),
                new KeyValuePair<string, string>("code", code),
                new KeyValuePair<string, string>("code_verifier", codeVerifier),
                new KeyValuePair<string, string>("redirect_uri", redirectUri),
                new KeyValuePair<string, string>("client_id", _clientId),
            }, cancellationToken).ConfigureAwait(false);
            SetTokens(tokens);
            return tokens;
        }

        /// <summary>
        /// Geçerli erişim jetonu; süresi 60 sn içinde dolacaksa önce yeniler. Aynı anda gelen
        /// çağrılar tek bir yenilemeyi bekler (rotasyonlu yenileme jetonu iki kez kullanılırsa
        /// sunucu tüm aileyi iptal eder).
        /// </summary>
        public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
        {
            var current = _tokens;
            if (current == null) throw new CikletException(CikletErrorKind.Auth, "not_signed_in", "Önce giriş yapın.");
            if (!current.ExpiresWithin(RefreshWindow, Clock())) return current.AccessToken;
            var refreshed = await RefreshAsync(current, cancellationToken).ConfigureAwait(false);
            return refreshed.AccessToken;
        }

        /// <summary>Jetonu şimdi yeniler (ör. 401 aldıktan sonra).</summary>
        public Task<CikletTokens> RefreshAsync(CancellationToken cancellationToken = default) => RefreshAsync(_tokens, cancellationToken);

        private async Task<CikletTokens> RefreshAsync(CikletTokens seen, CancellationToken cancellationToken)
        {
            await _refreshLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                // Beklerken başka bir çağrı yenilediyse onu kullan.
                if (_tokens != null && seen != null && !ReferenceEquals(_tokens, seen) && !_tokens.ExpiresWithin(RefreshWindow, Clock()))
                    return _tokens;
                var current = _tokens;
                if (current == null || string.IsNullOrEmpty(current.RefreshToken))
                    throw new CikletException(CikletErrorKind.Auth, "not_signed_in", "Yenileme jetonu yok; yeniden giriş gerekli.");
                CikletTokens tokens;
                try
                {
                    tokens = await TokenRequestAsync(new[]
                    {
                        new KeyValuePair<string, string>("grant_type", "refresh_token"),
                        new KeyValuePair<string, string>("refresh_token", current.RefreshToken),
                        new KeyValuePair<string, string>("client_id", _clientId),
                    }, cancellationToken).ConfigureAwait(false);
                }
                catch (CikletException e) when (e.Code == "invalid_grant")
                {
                    // Kullanıcı yetkiyi geri aldı ya da jeton ailesi düştü.
                    SetTokens(null);
                    throw new CikletException(CikletErrorKind.Auth, "invalid_grant", "Oturum sona erdi; yeniden giriş gerekli.", e.Status, inner: e);
                }
                SetTokens(tokens);
                return tokens;
            }
            finally
            {
                _refreshLock.Release();
            }
        }

        /// <summary>Jetonu sunucuda iptal eder ve yerelden siler. Ağ hatası yerel silmeyi engellemez.</summary>
        public async Task SignOutAsync(CancellationToken cancellationToken = default)
        {
            var current = _tokens;
            SetTokens(null);
            if (current?.RefreshToken == null && current?.AccessToken == null) return;
            try
            {
                await PostFormAsync("/api/oauth/revoke", new[]
                {
                    new KeyValuePair<string, string>("token", current.RefreshToken ?? current.AccessToken),
                    new KeyValuePair<string, string>("client_id", _clientId),
                }, cancellationToken).ConfigureAwait(false);
            }
            catch (CikletException)
            {
                // İptal en iyi çaba; yerel oturum zaten kapandı.
            }
        }

        private void SetTokens(CikletTokens tokens)
        {
            _tokens = tokens;
            if (tokens == null) _store.Clear();
            else _store.Save(tokens);
            TokensChanged?.Invoke(tokens);
        }

        private async Task<CikletTokens> TokenRequestAsync(IEnumerable<KeyValuePair<string, string>> fields, CancellationToken cancellationToken)
        {
            var data = await PostFormAsync("/api/oauth/token", fields, cancellationToken).ConfigureAwait(false);
            var obj = data as Dictionary<string, object>;
            if (obj == null) throw new CikletException(CikletErrorKind.Protocol, "invalid_token_response", "Jeton yanıtı nesne değil.");
            return CikletTokens.FromTokenResponse(obj, Clock());
        }

        private async Task<object> PostFormAsync(string path, IEnumerable<KeyValuePair<string, string>> fields, CancellationToken cancellationToken)
        {
            var request = new HttpRequestSpec
            {
                Method = "POST",
                Url = _options.Root(path),
                Body = Encoding.UTF8.GetBytes(CikletHttp.FormEncode(fields)),
                ContentType = "application/x-www-form-urlencoded",
                Timeout = _options.RequestTimeout,
            };
            request.Headers["Accept"] = "application/json";
            request.Headers["User-Agent"] = _options.UserAgent;
            var response = await _transport.SendAsync(request, cancellationToken).ConfigureAwait(false);
            try
            {
                return CikletHttp.ParseOrThrow(response);
            }
            catch (CikletException e) when (e.Status == 400 || e.Status == 401)
            {
                // OAuth hataları (invalid_grant, invalid_client…) yeniden giriş ister.
                throw new CikletException(CikletErrorKind.Auth, e.Code, e.Message, e.Status, inner: e);
            }
        }
    }
}
