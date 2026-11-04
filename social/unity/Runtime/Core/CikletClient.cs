using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    /// <summary>
    /// Kullanıcı jetonuyla Ciklet REST'i (`https://ciklet.xyz/api/v1`): profil, arkadaşlar,
    /// etkinlik, lobiler, oyun istatistikleri. Jeton <see cref="CikletAuth"/>'tan alınır ve
    /// gerekirse yenilenir; 401'de bir kez yenileyip tekrar dener.
    /// </summary>
    public sealed class CikletClient
    {
        private readonly CikletAuth _auth;
        private readonly Func<CancellationToken, Task<string>> _tokenProvider;
        private readonly IHttpTransport _transport;
        private readonly CikletOptions _options;
        private string _headlessToken;

        public CikletClient(CikletAuth auth, IHttpTransport transport)
        {
            _auth = auth ?? throw new ArgumentNullException(nameof(auth));
            _tokenProvider = auth.GetAccessTokenAsync;
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _options = auth.Options;
        }

        /// <summary>Jetonu kendiniz yönetiyorsanız (ör. sunucunuzdan alıyorsanız).</summary>
        public CikletClient(Func<CancellationToken, Task<string>> accessTokenProvider, IHttpTransport transport, CikletOptions options = null)
        {
            _tokenProvider = accessTokenProvider ?? throw new ArgumentNullException(nameof(accessTokenProvider));
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _options = options ?? new CikletOptions();
        }

        // ── Profil ve arkadaşlar ──

        /// <summary>`GET /users/@me` (`identify`).</summary>
        public async Task<CikletUser> GetCurrentUserAsync(CancellationToken ct = default) =>
            CikletUser.FromJson(await RequestObjectAsync("GET", "/users/@me", null, ct).ConfigureAwait(false));

        /// <summary>`GET /users/@me/relationships` (`relationships.read`): arkadaşlar, istekler, engellenenler.</summary>
        public async Task<List<CikletRelationship>> GetRelationshipsAsync(CancellationToken ct = default)
        {
            var data = await RequestAsync("GET", "/users/@me/relationships", null, ct).ConfigureAwait(false);
            return ListOf(data, CikletRelationship.FromJson);
        }

        /// <summary>Yalnızca arkadaşlar (`Type == Friend`).</summary>
        public async Task<List<CikletRelationship>> GetFriendsAsync(CancellationToken ct = default) =>
            (await GetRelationshipsAsync(ct).ConfigureAwait(false)).Where(r => r.Type == RelationshipType.Friend).ToList();

        // ── Etkinlik (Rich Presence) ──

        /// <summary>
        /// Kullanıcının profiline etkinlik yazar (`activities.write`, headless session).
        /// Oturum 3 dk tazelenmezse canlı sayılmaz — en geç 2 dakikada bir çağırın.
        /// </summary>
        public async Task UpdateActivityAsync(CikletActivity activity, CancellationToken ct = default)
        {
            if (activity == null) throw new ArgumentNullException(nameof(activity));
            var body = new Dictionary<string, object> { ["activities"] = new object[] { activity } };
            if (_headlessToken != null) body["token"] = _headlessToken;
            Dictionary<string, object> data;
            try
            {
                data = await RequestObjectAsync("POST", "/users/@me/headless-sessions", body, ct).ConfigureAwait(false);
            }
            catch (CikletException e) when (e.Status == 404 && _headlessToken != null)
            {
                // Oturum bitmiş (süre doldu) — yenisini aç.
                _headlessToken = null;
                body.Remove("token");
                data = await RequestObjectAsync("POST", "/users/@me/headless-sessions", body, ct).ConfigureAwait(false);
            }
            _headlessToken = CikletJson.Str(data, "token") ?? _headlessToken;
        }

        /// <summary>Etkinliği kaldırır.</summary>
        public async Task ClearActivityAsync(CancellationToken ct = default)
        {
            if (_headlessToken == null) return;
            var token = _headlessToken;
            _headlessToken = null;
            try
            {
                await RequestAsync("POST", "/users/@me/headless-sessions/delete", new Dictionary<string, object> { ["token"] = token }, ct).ConfigureAwait(false);
            }
            catch (CikletException e) when (e.Status == 404)
            {
                // zaten bitmiş
            }
        }

        // ── Lobiler (`lobbies.write`) ──

        /// <summary>Sırla oluştur ya da katıl (`PUT /lobbies`). Aynı sırrı kullanan oyuncular aynı lobiye düşer.</summary>
        public async Task<CikletLobby> CreateOrJoinLobbyAsync(
            string secret,
            IDictionary<string, string> lobbyMetadata = null,
            IDictionary<string, string> memberMetadata = null,
            int? idleTimeoutSeconds = null,
            CancellationToken ct = default)
        {
            if (string.IsNullOrEmpty(secret)) throw new ArgumentException("secret gerekli.", nameof(secret));
            var body = new Dictionary<string, object> { ["secret"] = secret };
            if (lobbyMetadata != null) body["lobby_metadata"] = lobbyMetadata;
            if (memberMetadata != null) body["member_metadata"] = memberMetadata;
            if (idleTimeoutSeconds != null) body["idle_timeout_seconds"] = idleTimeoutSeconds.Value;
            return CikletLobby.FromJson(await RequestObjectAsync("PUT", "/lobbies", body, ct).ConfigureAwait(false));
        }

        public async Task<CikletLobby> GetLobbyAsync(string lobbyId, CancellationToken ct = default) =>
            CikletLobby.FromJson(await RequestObjectAsync("GET", "/lobbies/" + CikletHttp.Segment(lobbyId), null, ct).ConfigureAwait(false));

        /// <summary>Lobiden ayrıl (`DELETE /lobbies/{id}/members/@me`).</summary>
        public Task LeaveLobbyAsync(string lobbyId, CancellationToken ct = default) =>
            RequestAsync("DELETE", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/members/@me", null, ct);

        public async Task<List<LobbyMessage>> GetLobbyMessagesAsync(string lobbyId, int? limit = null, string before = null, CancellationToken ct = default)
        {
            var query = new List<KeyValuePair<string, string>>();
            if (limit != null) query.Add(new KeyValuePair<string, string>("limit", limit.Value.ToString(CultureInfo.InvariantCulture)));
            if (before != null) query.Add(new KeyValuePair<string, string>("before", before));
            var suffix = query.Count > 0 ? "?" + CikletHttp.FormEncode(query) : "";
            var data = await RequestAsync("GET", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/messages" + suffix, null, ct).ConfigureAwait(false);
            return ListOf(data, LobbyMessage.FromJson);
        }

        public async Task<LobbyMessage> SendLobbyMessageAsync(string lobbyId, string content, IDictionary<string, string> metadata = null, CancellationToken ct = default)
        {
            var body = new Dictionary<string, object> { ["content"] = content };
            if (metadata != null) body["metadata"] = metadata;
            return LobbyMessage.FromJson(await RequestObjectAsync("POST", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/messages", body, ct).ConfigureAwait(false));
        }

        /// <summary>
        /// Lobi sesli sohbeti için LiveKit bilgisi. Ses aktarımı bu pakette yok:
        /// LiveKit Unity SDK'sında <c>room.Connect(info.Url, info.Token)</c>.
        /// </summary>
        public async Task<LobbyVoiceInfo> GetLobbyVoiceAsync(string lobbyId, CancellationToken ct = default) =>
            LobbyVoiceInfo.FromJson(await RequestObjectAsync("POST", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/voice", null, ct).ConfigureAwait(false));

        /// <summary>Lobiyi bir Ciklet metin kanalına bağlar; null bağı çözer (CanLinkLobby + Kanalları Yönet).</summary>
        public async Task<CikletLobby> LinkLobbyChannelAsync(string lobbyId, string channelId, CancellationToken ct = default)
        {
            var body = new Dictionary<string, object>();
            if (channelId != null) body["channel_id"] = channelId;
            return CikletLobby.FromJson(await RequestObjectAsync("PATCH", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/channel-linking", body, ct).ConfigureAwait(false));
        }

        // ── Oyun istatistikleri (`game_stats.write`) ──

        public async Task<GameStats> GetGameStatsAsync(string applicationId = "@me", CancellationToken ct = default) =>
            GameStats.FromJson(await RequestObjectAsync("GET", GameStatsPath(applicationId), null, ct).ConfigureAwait(false));

        /// <summary>Kartın TAMAMINI değiştirir; null değer alanı siler.</summary>
        public async Task<GameStats> PutGameStatsAsync(IDictionary<string, object> stats, string applicationId = "@me", CancellationToken ct = default) =>
            GameStats.FromJson(await RequestObjectAsync("PUT", GameStatsPath(applicationId), new Dictionary<string, object> { ["stats"] = stats }, ct).ConfigureAwait(false));

        public Task DeleteGameStatsAsync(string applicationId = "@me", CancellationToken ct = default) =>
            RequestAsync("DELETE", GameStatsPath(applicationId), null, ct);

        private static string GameStatsPath(string applicationId) =>
            "/users/@me/applications/" + CikletHttp.Segment(applicationId) + "/game-stats";

        // ── Ortak ──

        private async Task<Dictionary<string, object>> RequestObjectAsync(string method, string path, object body, CancellationToken ct)
        {
            var data = await RequestAsync(method, path, body, ct).ConfigureAwait(false);
            return data as Dictionary<string, object> ??
                   throw new CikletException(CikletErrorKind.Protocol, "unexpected_response", "Yanıt nesne değil: " + path);
        }

        /// <summary>Herhangi bir `/api/v1` ucunu çağırır (SDK'da sarmalanmamış uçlar için).</summary>
        public async Task<object> RequestAsync(string method, string path, object body, CancellationToken ct = default)
        {
            var token = await _tokenProvider(ct).ConfigureAwait(false);
            var response = await SendAsync(method, path, body, token, ct).ConfigureAwait(false);
            if (response.Status == 401 && _auth != null)
            {
                // Jeton sunucuda düşmüş olabilir (iptal, saat kayması): bir kez yenile.
                var refreshed = await _auth.RefreshAsync(ct).ConfigureAwait(false);
                response = await SendAsync(method, path, body, refreshed.AccessToken, ct).ConfigureAwait(false);
            }
            return CikletHttp.ParseOrThrow(response);
        }

        private Task<HttpResponseData> SendAsync(string method, string path, object body, string token, CancellationToken ct)
        {
            var request = new HttpRequestSpec
            {
                Method = method,
                Url = _options.Api(path),
                Timeout = _options.RequestTimeout,
            };
            request.Headers["Authorization"] = "Bearer " + token;
            request.Headers["Accept"] = "application/json";
            request.Headers["User-Agent"] = _options.UserAgent;
            if (body != null)
            {
                request.Body = CikletHttp.Json(body);
                request.ContentType = "application/json";
            }
            return _transport.SendAsync(request, ct);
        }

        internal static List<T> ListOf<T>(object data, Func<Dictionary<string, object>, T> map) =>
            (data as List<object> ?? new List<object>())
                .OfType<Dictionary<string, object>>()
                .Select(map)
                .Where(x => x != null)
                .ToList();
    }
}
