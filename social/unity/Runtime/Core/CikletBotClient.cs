using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    /// <summary>Bot jetonuyla lobi üyesi tanımı / toplu güncelleme satırı.</summary>
    public sealed class LobbyMemberInput : IJsonWritable
    {
        public string Id;
        public IDictionary<string, string> Metadata;
        public LobbyMemberFlags? Flags;
        /// <summary>Yalnızca toplu güncellemede: üyeyi çıkar.</summary>
        public bool RemoveMember;

        public object ToJsonValue()
        {
            var d = new Dictionary<string, object> { ["id"] = Id };
            if (Metadata != null) d["metadata"] = Metadata;
            if (Flags != null) d["flags"] = (int)Flags.Value;
            if (RemoveMember) d["remove_member"] = true;
            return d;
        }
    }

    /// <summary>
    /// OYUN SUNUCUSU İÇİN — bot jetonuyla (`Authorization: Bot cikbot_…`) lobi yönetimi ve
    /// oyuncu adına oyun istatistiği.
    ///
    /// UYARI: Bot jetonu GİZLİDİR. Oyun istemcisine (Unity/Unreal derlemesine, ayar
    /// dosyasına, PlayerPrefs'e) ASLA koymayın: istemci derlemesinden çıkarılabilir ve
    /// botunuzun tüm yetkilerini verir. Bu sınıfı yalnızca adanmış sunucuda (Unity
    /// headless / dedicated server, kendi backend'iniz) ve jetonu ortam değişkeninden
    /// okuyarak kullanın.
    /// </summary>
    public sealed class CikletBotClient
    {
        private readonly string _botToken;
        private readonly IHttpTransport _transport;
        private readonly CikletOptions _options;

        public CikletBotClient(string botToken, IHttpTransport transport, CikletOptions options = null)
        {
            if (string.IsNullOrEmpty(botToken)) throw new ArgumentException("Bot jetonu gerekli.", nameof(botToken));
            _botToken = botToken.StartsWith("Bot ", StringComparison.Ordinal) ? botToken.Substring(4) : botToken;
            _transport = transport ?? throw new ArgumentNullException(nameof(transport));
            _options = options ?? new CikletOptions();
        }

        // ── Lobiler ──

        public async Task<CikletLobby> CreateLobbyAsync(
            IDictionary<string, string> metadata = null,
            IEnumerable<LobbyMemberInput> members = null,
            int? idleTimeoutSeconds = null,
            CancellationToken ct = default)
        {
            var body = new Dictionary<string, object>();
            if (metadata != null) body["metadata"] = metadata;
            if (members != null) body["members"] = members.ToList();
            if (idleTimeoutSeconds != null) body["idle_timeout_seconds"] = idleTimeoutSeconds.Value;
            return CikletLobby.FromJson(await ObjectAsync("POST", "/lobbies", body, ct).ConfigureAwait(false));
        }

        public async Task<CikletLobby> GetLobbyAsync(string lobbyId, CancellationToken ct = default) =>
            CikletLobby.FromJson(await ObjectAsync("GET", "/lobbies/" + CikletHttp.Segment(lobbyId), null, ct).ConfigureAwait(false));

        /// <summary>`members` verilirse üye listesinin TAMAMI değişir.</summary>
        public async Task<CikletLobby> UpdateLobbyAsync(
            string lobbyId,
            IDictionary<string, string> metadata = null,
            IEnumerable<LobbyMemberInput> members = null,
            int? idleTimeoutSeconds = null,
            CancellationToken ct = default)
        {
            var body = new Dictionary<string, object>();
            if (metadata != null) body["metadata"] = metadata;
            if (members != null) body["members"] = members.ToList();
            if (idleTimeoutSeconds != null) body["idle_timeout_seconds"] = idleTimeoutSeconds.Value;
            return CikletLobby.FromJson(await ObjectAsync("PATCH", "/lobbies/" + CikletHttp.Segment(lobbyId), body, ct).ConfigureAwait(false));
        }

        public Task DeleteLobbyAsync(string lobbyId, CancellationToken ct = default) =>
            RequestAsync("DELETE", "/lobbies/" + CikletHttp.Segment(lobbyId), null, ct);

        public async Task<LobbyMember> AddOrUpdateLobbyMemberAsync(string lobbyId, string userId, IDictionary<string, string> metadata = null, LobbyMemberFlags? flags = null, CancellationToken ct = default)
        {
            var body = new Dictionary<string, object>();
            if (metadata != null) body["metadata"] = metadata;
            if (flags != null) body["flags"] = (int)flags.Value;
            var data = await RequestAsync("PUT", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/members/" + CikletHttp.Segment(userId), body, ct).ConfigureAwait(false);
            return LobbyMember.FromJson(data as Dictionary<string, object>);
        }

        public Task RemoveLobbyMemberAsync(string lobbyId, string userId, CancellationToken ct = default) =>
            RequestAsync("DELETE", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/members/" + CikletHttp.Segment(userId), null, ct);

        /// <summary>En çok 25 satır; `RemoveMember = true` çıkarır.</summary>
        public async Task<List<LobbyMember>> BulkUpdateLobbyMembersAsync(string lobbyId, IEnumerable<LobbyMemberInput> rows, CancellationToken ct = default)
        {
            var list = rows?.ToList() ?? throw new ArgumentNullException(nameof(rows));
            if (list.Count == 0 || list.Count > 25) throw new ArgumentException("1-25 satır olmalı.", nameof(rows));
            var data = await RequestAsync("POST", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/members/bulk", list, ct).ConfigureAwait(false);
            return CikletClient.ListOf(data, LobbyMember.FromJson);
        }

        public async Task<List<LobbyMessage>> GetLobbyMessagesAsync(string lobbyId, int? limit = null, string before = null, CancellationToken ct = default)
        {
            var query = new List<KeyValuePair<string, string>>();
            if (limit != null) query.Add(new KeyValuePair<string, string>("limit", limit.Value.ToString(CultureInfo.InvariantCulture)));
            if (before != null) query.Add(new KeyValuePair<string, string>("before", before));
            var suffix = query.Count > 0 ? "?" + CikletHttp.FormEncode(query) : "";
            var data = await RequestAsync("GET", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/messages" + suffix, null, ct).ConfigureAwait(false);
            return CikletClient.ListOf(data, LobbyMessage.FromJson);
        }

        /// <summary>Lobiye bot adına mesaj.</summary>
        public async Task<LobbyMessage> SendLobbyMessageAsync(string lobbyId, string content, IDictionary<string, string> metadata = null, CancellationToken ct = default)
        {
            var body = new Dictionary<string, object> { ["content"] = content };
            if (metadata != null) body["metadata"] = metadata;
            return LobbyMessage.FromJson(await ObjectAsync("POST", "/lobbies/" + CikletHttp.Segment(lobbyId) + "/messages", body, ct).ConfigureAwait(false));
        }

        // ── Oyun istatistikleri ──

        public async Task<List<GameStatField>> GetGameStatsSchemaAsync(CancellationToken ct = default) =>
            CikletClient.ListOf(await RequestAsync("GET", "/bot/applications/@me/game-stats/schema", null, ct).ConfigureAwait(false), GameStatField.FromJson);

        /// <summary>Şemanın tamamını değiştirir (en çok 10 alan).</summary>
        public async Task<List<GameStatField>> PutGameStatsSchemaAsync(IEnumerable<GameStatField> fields, CancellationToken ct = default) =>
            CikletClient.ListOf(await RequestAsync("PUT", "/bot/applications/@me/game-stats/schema", fields.ToList(), ct).ConfigureAwait(false), GameStatField.FromJson);

        /// <summary>Oyuncu adına (oyuncu `game_stats.write` onaylamış olmalı; yoksa 404 unknown_user).</summary>
        public async Task<GameStats> PutUserGameStatsAsync(string userId, IDictionary<string, object> stats, CancellationToken ct = default) =>
            GameStats.FromJson(await ObjectAsync("PUT", UserStatsPath(userId), new Dictionary<string, object> { ["stats"] = stats }, ct).ConfigureAwait(false));

        public async Task<GameStats> GetUserGameStatsAsync(string userId, CancellationToken ct = default) =>
            GameStats.FromJson(await ObjectAsync("GET", UserStatsPath(userId), null, ct).ConfigureAwait(false));

        public Task DeleteUserGameStatsAsync(string userId, CancellationToken ct = default) =>
            RequestAsync("DELETE", UserStatsPath(userId), null, ct);

        private static string UserStatsPath(string userId) =>
            "/bot/applications/@me/users/" + CikletHttp.Segment(userId) + "/game-stats";

        // ── Ortak ──

        private async Task<Dictionary<string, object>> ObjectAsync(string method, string path, object body, CancellationToken ct)
        {
            var data = await RequestAsync(method, path, body, ct).ConfigureAwait(false);
            return data as Dictionary<string, object> ??
                   throw new CikletException(CikletErrorKind.Protocol, "unexpected_response", "Yanıt nesne değil: " + path);
        }

        public async Task<object> RequestAsync(string method, string path, object body, CancellationToken ct = default)
        {
            var request = new HttpRequestSpec { Method = method, Url = _options.Api(path), Timeout = _options.RequestTimeout };
            request.Headers["Authorization"] = "Bot " + _botToken;
            request.Headers["Accept"] = "application/json";
            request.Headers["User-Agent"] = _options.UserAgent;
            if (body != null)
            {
                request.Body = CikletHttp.Json(body);
                request.ContentType = "application/json";
            }
            var response = await _transport.SendAsync(request, ct).ConfigureAwait(false);
            return CikletHttp.ParseOrThrow(response);
        }
    }
}
