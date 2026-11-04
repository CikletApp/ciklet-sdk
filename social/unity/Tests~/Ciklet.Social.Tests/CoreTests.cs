using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Ciklet.Social.Tests
{
    /// <summary>İstekleri kaydeden, sıradaki yanıtı döndüren sahte taşıyıcı.</summary>
    internal sealed class FakeTransport : IHttpTransport
    {
        public readonly List<HttpRequestSpec> Requests = new List<HttpRequestSpec>();
        public readonly Queue<Func<HttpRequestSpec, HttpResponseData>> Responses = new Queue<Func<HttpRequestSpec, HttpResponseData>>();

        public FakeTransport Reply(int status, string body, Dictionary<string, string> headers = null)
        {
            Responses.Enqueue(_ =>
            {
                var r = new HttpResponseData { Status = status, Body = body };
                if (headers != null) foreach (var h in headers) r.Headers[h.Key] = h.Value;
                return r;
            });
            return this;
        }

        public Task<HttpResponseData> SendAsync(HttpRequestSpec request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (Requests) Requests.Add(request);
            Func<HttpRequestSpec, HttpResponseData> next;
            lock (Responses) next = Responses.Dequeue();
            return Task.FromResult(next(request));
        }

        public static string BodyOf(HttpRequestSpec r) => r.Body == null ? null : Encoding.UTF8.GetString(r.Body);
    }

    public class JsonTests
    {
        private static readonly string Ls = ((char)0x2028).ToString();

        [Fact]
        public void ParsesNestedValues()
        {
            var d = CikletJson.AsObject(CikletJson.Parse("{\"a\":1,\"b\":-2.5,\"c\":\"x\\u00e7\\n\",\"d\":[true,false,null],\"e\":{\"f\":\"g\"}}"));
            Assert.Equal(1L, d["a"]);
            Assert.Equal(-2.5, d["b"]);
            Assert.Equal("xç\n", d["c"]);
            Assert.Equal(new object[] { true, false, null }, ((List<object>)d["d"]).ToArray());
            Assert.Equal("g", CikletJson.Str(CikletJson.Obj(d, "e"), "f"));
        }

        [Theory]
        [InlineData("{")]
        [InlineData("{\"a\":}")]
        [InlineData("[1,]")]
        [InlineData("\"kapanmadı")]
        [InlineData("{} x")]
        [InlineData("tru")]
        public void RejectsInvalid(string json)
        {
            Assert.Throws<FormatException>(() => CikletJson.Parse(json));
        }

        [Fact]
        public void RejectsTooDeep()
        {
            Assert.Throws<FormatException>(() => CikletJson.Parse(new string('[', 200) + new string(']', 200)));
        }

        [Fact]
        public void SerializesRoundTrip()
        {
            var json = CikletJson.Serialize(new Dictionary<string, object>
            {
                ["s"] = "tırnak \" ters \\ satır\n" + Ls,
                ["n"] = 42,
                ["f"] = 1.5,
                ["b"] = true,
                ["z"] = null,
                ["m"] = new Dictionary<string, string> { ["k"] = "v" },
                ["l"] = new List<int> { 1, 2 },
            });
            Assert.DoesNotContain(Ls, json);
            var back = CikletJson.AsObject(CikletJson.Parse(json));
            Assert.Equal("tırnak \" ters \\ satır\n" + Ls, back["s"]);
            Assert.Equal(42L, back["n"]);
            Assert.Equal(1.5, back["f"]);
            Assert.Null(back["z"]);
            Assert.Equal("v", CikletJson.Str(CikletJson.Obj(back, "m"), "k"));
        }

        [Fact]
        public void ActivityWritesOnlySupportedFields()
        {
            var json = CikletJson.Serialize(new CikletActivity { Details = "Bölüm 3", StartTimestamp = 1762200000, LargeImage = "https://x/y.png" });
            Assert.Equal("{\"type\":0,\"details\":\"Bölüm 3\",\"timestamps\":{\"start\":1762200000},\"assets\":{\"large_image\":\"https://x/y.png\"}}", json);
        }
    }

    public class PkceTests
    {
        [Fact]
        public void ChallengeMatchesNodeReference()
        {
            // node: crypto.createHash("sha256").update("x".repeat(43)).digest("base64url")
            Assert.Equal("zAscLGbzu5_RoIHGJrob72L2-WRBpDvhUmhSN3asJqE", Pkce.ComputeChallenge(new string('x', 43)));
        }

        [Fact]
        public void VerifierIsRfc7636Shaped()
        {
            var v = Pkce.CreateVerifier();
            Assert.Equal(43, v.Length);
            Assert.Matches("^[A-Za-z0-9_-]{43}$", v);
            Assert.NotEqual(v, Pkce.CreateVerifier());
        }

        [Fact]
        public void AuthorizeUrlCarriesAllParameters()
        {
            var req = new AuthorizationRequest
            {
                ClientId = "cik_app_1",
                RedirectUri = "http://127.0.0.1:5000/callback",
                Scopes = new[] { "identify", "lobbies.write" },
                State = "st",
                CodeVerifier = new string('x', 43),
            };
            var url = req.BuildUrl("https://ciklet.xyz/");
            Assert.StartsWith("https://ciklet.xyz/oauth/authorize?", url);
            Assert.Contains("client_id=cik_app_1", url);
            Assert.Contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback", url);
            Assert.Contains("response_type=code", url);
            Assert.Contains("scope=identify%20lobbies.write", url);
            Assert.Contains("code_challenge=zAscLGbzu5_RoIHGJrob72L2-WRBpDvhUmhSN3asJqE", url);
            Assert.Contains("code_challenge_method=S256", url);
            Assert.Contains("state=st", url);
        }
    }

    public class LoopbackTests
    {
        [Theory]
        [InlineData("GET /callback?code=a HTTP/1.1\r\nHost: x\r\n\r\n", "/callback?code=a")]
        [InlineData("POST /callback HTTP/1.1\r\n\r\n", null)]
        [InlineData("GET http://evil/callback HTTP/1.1\r\n\r\n", null)]
        [InlineData("garbage", null)]
        public void ParsesRequestLine(string raw, string expected)
        {
            Assert.Equal(expected, LoopbackCallbackServer.ParseRequestTarget(raw));
        }

        [Fact]
        public void ParsesQueryFirstValueWins()
        {
            var q = LoopbackCallbackServer.ParseQuery("code=a%2Bb&state=s+1&code=evil");
            Assert.Equal("a+b", q["code"]);
            Assert.Equal("s 1", q["state"]);
        }

        [Fact]
        public async Task ReceivesCodeAndIgnoresWrongStateAndPath()
        {
            using (var server = LoopbackCallbackServer.Start("/callback"))
            using (var http = new HttpClient())
            {
                Assert.StartsWith("http://127.0.0.1:", server.RedirectUri);
                Assert.EndsWith("/callback", server.RedirectUri);
                var wait = server.WaitForCallbackAsync("good-state", new CancellationTokenSource(TimeSpan.FromSeconds(10)).Token);
                var baseUri = server.RedirectUri;

                var favicon = await http.GetAsync(baseUri.Replace("/callback", "/favicon.ico"));
                Assert.Equal(404, (int)favicon.StatusCode);
                var csrf = await http.GetAsync(baseUri + "?code=attacker&state=wrong");
                Assert.Equal(400, (int)csrf.StatusCode);
                Assert.False(wait.IsCompleted);

                var ok = await http.GetAsync(baseUri + "?code=cik_ac_1&state=good-state");
                Assert.Equal(200, (int)ok.StatusCode);
                var result = await wait;
                Assert.Equal("cik_ac_1", result.Code);
                Assert.Null(result.Error);
            }
        }

        [Fact]
        public async Task ReportsDenial()
        {
            using (var server = LoopbackCallbackServer.Start())
            using (var http = new HttpClient())
            {
                var wait = server.WaitForCallbackAsync("s", CancellationToken.None);
                await http.GetAsync(server.RedirectUri + "?error=access_denied&error_description=hay%C4%B1r&state=s");
                var result = await wait;
                Assert.Equal("access_denied", result.Error);
                Assert.Equal("hayır", result.ErrorDescription);
            }
        }

        [Fact]
        public async Task CancelStopsWaiting()
        {
            using (var server = LoopbackCallbackServer.Start())
            using (var cts = new CancellationTokenSource())
            {
                var wait = server.WaitForCallbackAsync("s", cts.Token);
                cts.Cancel();
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => wait);
            }
        }
    }

    public class AuthTests
    {
        private const string TokenJson = "{\"access_token\":\"cik_at_1\",\"token_type\":\"Bearer\",\"expires_in\":3600,\"refresh_token\":\"cik_rt_1\",\"scope\":\"identify lobbies.write\"}";
        private const string TokenJson2 = "{\"access_token\":\"cik_at_2\",\"token_type\":\"Bearer\",\"expires_in\":3600,\"refresh_token\":\"cik_rt_2\",\"scope\":\"identify lobbies.write\"}";

        [Fact]
        public async Task FullLoopbackLogin()
        {
            var transport = new FakeTransport().Reply(200, TokenJson);
            var store = new InMemoryTokenStore();
            var auth = new CikletAuth("cik_app_1", transport, store);
            using (var http = new HttpClient())
            {
                var tokens = await auth.LoginWithLoopbackAsync(new[] { "identify", "lobbies.write" }, url =>
                {
                    // "Tarayıcı": onay ekranının yapacağı yönlendirmeyi taklit et.
                    var uri = new Uri(url);
                    var q = LoopbackCallbackServer.ParseQuery(uri.Query.TrimStart('?'));
                    Assert.Equal("S256", q["code_challenge_method"]);
                    Task.Run(() => http.GetAsync(q["redirect_uri"] + "?code=cik_ac_9&state=" + Uri.EscapeDataString(q["state"])));
                }, timeout: TimeSpan.FromSeconds(10));

                Assert.Equal("cik_at_1", tokens.AccessToken);
                Assert.True(tokens.HasScope("lobbies.write"));
                Assert.Same(tokens, store.Load());
                var form = LoopbackCallbackServer.ParseQuery(FakeTransport.BodyOf(transport.Requests[0]));
                Assert.Equal("authorization_code", form["grant_type"]);
                Assert.Equal("cik_ac_9", form["code"]);
                Assert.Equal(43, form["code_verifier"].Length);
                Assert.StartsWith("http://127.0.0.1:", form["redirect_uri"]);
                Assert.Equal("https://ciklet.xyz/api/oauth/token", transport.Requests[0].Url);
                Assert.Equal("application/x-www-form-urlencoded", transport.Requests[0].ContentType);
                Assert.False(form.ContainsKey("client_secret"));
            }
        }

        [Fact]
        public async Task LoginTimesOut()
        {
            var auth = new CikletAuth("cik_app_1", new FakeTransport());
            var e = await Assert.ThrowsAsync<CikletException>(() => auth.LoginWithLoopbackAsync(null, _ => { }, timeout: TimeSpan.FromMilliseconds(200)));
            Assert.Equal(CikletErrorKind.Timeout, e.Kind);
        }

        [Fact]
        public async Task RefreshesOnceForConcurrentCallers()
        {
            var transport = new FakeTransport().Reply(200, TokenJson2);
            var store = new InMemoryTokenStore();
            var now = DateTimeOffset.UtcNow;
            store.Save(new CikletTokens { AccessToken = "cik_at_old", RefreshToken = "cik_rt_old", ExpiresAt = now.AddSeconds(10) });
            var auth = new CikletAuth("cik_app_1", transport, store) { Clock = () => now };

            var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => auth.GetAccessTokenAsync()));
            Assert.All(results, t => Assert.Equal("cik_at_2", t));
            Assert.Single(transport.Requests);
            var form = LoopbackCallbackServer.ParseQuery(FakeTransport.BodyOf(transport.Requests[0]));
            Assert.Equal("refresh_token", form["grant_type"]);
            Assert.Equal("cik_rt_old", form["refresh_token"]);
            Assert.Equal("cik_rt_2", store.Load().RefreshToken);
        }

        [Fact]
        public async Task InvalidGrantSignsOut()
        {
            var transport = new FakeTransport().Reply(400, "{\"error\":\"invalid_grant\",\"error_description\":\"revoked\"}");
            var store = new InMemoryTokenStore();
            store.Save(new CikletTokens { AccessToken = "a", RefreshToken = "r", ExpiresAt = DateTimeOffset.UtcNow.AddSeconds(-1) });
            var auth = new CikletAuth("cik_app_1", transport, store);
            var e = await Assert.ThrowsAsync<CikletException>(() => auth.GetAccessTokenAsync());
            Assert.Equal(CikletErrorKind.Auth, e.Kind);
            Assert.Equal("invalid_grant", e.Code);
            Assert.False(auth.IsSignedIn);
            Assert.Null(store.Load());
        }

        [Fact]
        public void TokensPersistRoundTrip()
        {
            var t = new CikletTokens { AccessToken = "a", RefreshToken = "r", ExpiresAt = DateTimeOffset.FromUnixTimeSeconds(1762200000), Scopes = new[] { "identify" } };
            var back = CikletTokens.FromJson(t.ToJson());
            Assert.Equal("a", back.AccessToken);
            Assert.Equal("r", back.RefreshToken);
            Assert.Equal(t.ExpiresAt, back.ExpiresAt);
            Assert.Equal(new[] { "identify" }, back.Scopes);
            Assert.Null(CikletTokens.FromJson("bozuk"));
        }
    }

    public class ClientTests
    {
        private static CikletAuth SignedIn(FakeTransport transport)
        {
            var store = new InMemoryTokenStore();
            store.Save(new CikletTokens { AccessToken = "cik_at_1", RefreshToken = "cik_rt_1", ExpiresAt = DateTimeOffset.UtcNow.AddHours(1) });
            return new CikletAuth("cik_app_1", transport, store);
        }

        [Fact]
        public async Task GetsProfileAndFriends()
        {
            var transport = new FakeTransport()
                .Reply(200, "{\"id\":\"u1\",\"username\":\"ornek\",\"global_name\":\"Örnek\",\"avatar\":null,\"bot\":false}")
                .Reply(200, "[{\"id\":\"u2\",\"type\":1,\"nickname\":null,\"user\":{\"id\":\"u2\",\"username\":\"dost\"}},{\"id\":\"u3\",\"type\":3,\"user\":{\"id\":\"u3\",\"username\":\"istek\"}}]");
            var client = new CikletClient(SignedIn(transport), transport);
            var me = await client.GetCurrentUserAsync();
            Assert.Equal("Örnek", me.DisplayName);
            var friends = await client.GetFriendsAsync();
            Assert.Single(friends);
            Assert.Equal("dost", friends[0].User.Username);
            Assert.Equal("https://ciklet.xyz/api/v1/users/@me", transport.Requests[0].Url);
            Assert.Equal("Bearer cik_at_1", transport.Requests[0].Headers["Authorization"]);
            Assert.Equal("https://ciklet.xyz/api/v1/users/@me/relationships", transport.Requests[1].Url);
        }

        [Fact]
        public async Task LobbyCalls()
        {
            const string lobby = "{\"id\":\"l1\",\"application_id\":\"a1\",\"metadata\":{\"harita\":\"çöl\"},\"members\":[{\"id\":\"u1\",\"metadata\":{},\"flags\":1}],\"idle_timeout_seconds\":300,\"linked_channel\":null}";
            var transport = new FakeTransport()
                .Reply(200, lobby)
                .Reply(200, "{\"id\":\"m1\",\"lobby_id\":\"l1\",\"content\":\"gg\",\"author\":{\"id\":\"u1\",\"username\":\"ornek\"},\"metadata\":{}}")
                .Reply(200, "{\"token\":\"lk\",\"url\":\"wss://lk\",\"room_name\":\"lobby_l1\",\"identity\":\"u1\"}")
                .Reply(200, "[]")
                .Reply(204, "");
            var client = new CikletClient(SignedIn(transport), transport);

            var l = await client.CreateOrJoinLobbyAsync("mac-42", memberMetadata: new Dictionary<string, string> { ["takim"] = "mavi" });
            Assert.Equal("çöl", l.Metadata["harita"]);
            Assert.Equal(LobbyMemberFlags.CanLinkLobby, l.Members[0].Flags);
            Assert.Equal("PUT", transport.Requests[0].Method);
            Assert.Equal("{\"secret\":\"mac-42\",\"member_metadata\":{\"takim\":\"mavi\"}}", FakeTransport.BodyOf(transport.Requests[0]));

            var m = await client.SendLobbyMessageAsync("l1", "gg");
            Assert.Equal("gg", m.Content);
            var v = await client.GetLobbyVoiceAsync("l1");
            Assert.Equal("wss://lk", v.Url);
            Assert.Equal("https://ciklet.xyz/api/v1/lobbies/l1/voice", transport.Requests[2].Url);
            await client.GetLobbyMessagesAsync("l1", limit: 50, before: "m9");
            Assert.Equal("https://ciklet.xyz/api/v1/lobbies/l1/messages?limit=50&before=m9", transport.Requests[3].Url);
            await client.LeaveLobbyAsync("l/1");
            Assert.Equal("https://ciklet.xyz/api/v1/lobbies/l%2F1/members/@me", transport.Requests[4].Url);
            Assert.Equal("DELETE", transport.Requests[4].Method);
        }

        [Fact]
        public async Task GameStatsAndActivity()
        {
            var transport = new FakeTransport()
                .Reply(200, "{\"stats\":{\"seviye\":42},\"updated_at\":\"2026-11-04T00:00:00Z\"}")
                .Reply(200, "{\"activities\":[],\"token\":\"0b6e8f2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b\"}")
                .Reply(200, "{\"activities\":[],\"token\":\"0b6e8f2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b\"}")
                .Reply(204, "");
            var client = new CikletClient(SignedIn(transport), transport);
            var stats = await client.PutGameStatsAsync(new Dictionary<string, object> { ["seviye"] = 42, ["lig"] = null });
            Assert.Equal(42L, stats.Stats["seviye"]);
            Assert.Equal("{\"stats\":{\"seviye\":42,\"lig\":null}}", FakeTransport.BodyOf(transport.Requests[0]));
            Assert.Equal("https://ciklet.xyz/api/v1/users/@me/applications/@me/game-stats", transport.Requests[0].Url);

            await client.UpdateActivityAsync(new CikletActivity { Details = "Bölüm 1" });
            Assert.DoesNotContain("token", FakeTransport.BodyOf(transport.Requests[1]));
            await client.UpdateActivityAsync(new CikletActivity { Details = "Bölüm 2" });
            Assert.Contains("\"token\":\"0b6e8f2a-1c2d-4e5f-8a9b-0c1d2e3f4a5b\"", FakeTransport.BodyOf(transport.Requests[2]));
            await client.ClearActivityAsync();
            Assert.Equal("https://ciklet.xyz/api/v1/users/@me/headless-sessions/delete", transport.Requests[3].Url);
        }

        [Fact]
        public async Task RetriesOnceAfter401WithRefresh()
        {
            var transport = new FakeTransport()
                .Reply(401, "{\"error\":\"invalid_token\"}")
                .Reply(200, "{\"access_token\":\"cik_at_new\",\"expires_in\":3600,\"refresh_token\":\"cik_rt_new\",\"scope\":\"identify\"}")
                .Reply(200, "{\"id\":\"u1\",\"username\":\"ornek\"}");
            var client = new CikletClient(SignedIn(transport), transport);
            var me = await client.GetCurrentUserAsync();
            Assert.Equal("u1", me.Id);
            Assert.Equal("Bearer cik_at_new", transport.Requests[2].Headers["Authorization"]);
        }

        [Fact]
        public async Task MapsErrorBodies()
        {
            var transport = new FakeTransport()
                .Reply(404, "{\"code\":\"unknown_lobby\",\"message\":\"Lobi yok.\"}")
                .Reply(429, "{\"error\":\"rate_limited\",\"retry_after\":2.5}")
                .Reply(403, "{\"error\":\"insufficient_scope\",\"error_description\":\"needs lobbies.write\"}");
            var client = new CikletClient(SignedIn(transport), transport);
            var e1 = await Assert.ThrowsAsync<CikletException>(() => client.GetLobbyAsync("x"));
            Assert.Equal(404, e1.Status);
            Assert.Equal("unknown_lobby", e1.Code);
            Assert.False(e1.IsRetryable);
            var e2 = await Assert.ThrowsAsync<CikletException>(() => client.GetLobbyAsync("x"));
            Assert.Equal(2.5, e2.RetryAfterSeconds);
            Assert.True(e2.IsRetryable);
            var e3 = await Assert.ThrowsAsync<CikletException>(() => client.GetLobbyAsync("x"));
            Assert.Equal("insufficient_scope", e3.Code);
        }

        [Fact]
        public async Task CancellationPropagates()
        {
            var transport = new FakeTransport();
            var client = new CikletClient(SignedIn(transport), transport);
            var cts = new CancellationTokenSource();
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.GetCurrentUserAsync(cts.Token));
        }

        [Fact]
        public async Task BotClientUsesBotScheme()
        {
            var transport = new FakeTransport()
                .Reply(201, "{\"id\":\"l1\",\"members\":[]}")
                .Reply(200, "[{\"id\":\"u1\",\"metadata\":{},\"flags\":0}]")
                .Reply(200, "[{\"key\":\"seviye\",\"name\":\"Seviye\",\"type\":1}]")
                .Reply(200, "{\"stats\":{\"seviye\":50},\"updated_at\":null}");
            var bot = new CikletBotClient("Bot cikbot_x", transport);
            await bot.CreateLobbyAsync(new Dictionary<string, string> { ["mod"] = "dereceli" }, new[] { new LobbyMemberInput { Id = "u1", Flags = LobbyMemberFlags.CanLinkLobby } }, 600);
            Assert.Equal("Bot cikbot_x", transport.Requests[0].Headers["Authorization"]);
            Assert.Equal("{\"metadata\":{\"mod\":\"dereceli\"},\"members\":[{\"id\":\"u1\",\"flags\":1}],\"idle_timeout_seconds\":600}", FakeTransport.BodyOf(transport.Requests[0]));
            await bot.BulkUpdateLobbyMembersAsync("l1", new[] { new LobbyMemberInput { Id = "u2", RemoveMember = true } });
            Assert.Equal("[{\"id\":\"u2\",\"remove_member\":true}]", FakeTransport.BodyOf(transport.Requests[1]));
            var schema = await bot.PutGameStatsSchemaAsync(new[] { new GameStatField { Key = "seviye", Name = "Seviye", Type = GameStatType.Number } });
            Assert.Equal(GameStatType.Number, schema[0].Type);
            Assert.Equal("https://ciklet.xyz/api/v1/bot/applications/@me/game-stats/schema", transport.Requests[2].Url);
            await bot.PutUserGameStatsAsync("u1", new Dictionary<string, object> { ["seviye"] = 50 });
            Assert.Equal("https://ciklet.xyz/api/v1/bot/applications/@me/users/u1/game-stats", transport.Requests[3].Url);
            await Assert.ThrowsAsync<ArgumentException>(() => bot.BulkUpdateLobbyMembersAsync("l1", Enumerable.Range(0, 26).Select(i => new LobbyMemberInput { Id = "u" + i })));
        }
    }

    /// <summary>Senaryolu sahte WebSocket.</summary>
    internal sealed class FakeSocket : IGatewaySocket
    {
        public readonly BlockingCollection<string> Incoming = new BlockingCollection<string>();
        public readonly ConcurrentQueue<string> Sent = new ConcurrentQueue<string>();
        public IDictionary<string, string> Headers;
        public Exception ConnectError;
        public bool Disposed;

        public Task ConnectAsync(Uri uri, IDictionary<string, string> headers, CancellationToken ct)
        {
            Headers = headers;
            if (ConnectError != null) throw ConnectError;
            return Task.CompletedTask;
        }

        public Task SendTextAsync(string text, CancellationToken ct) { Sent.Enqueue(text); return Task.CompletedTask; }

        public Task<string> ReceiveTextAsync(CancellationToken ct) => Task.Run(() =>
        {
            var item = Incoming.Take(ct);
            return item == "<close>" ? null : item;
        }, ct);

        public Task CloseAsync(CancellationToken ct) => Task.CompletedTask;
        public void Dispose() => Disposed = true;
    }

    public class GatewayTests
    {
        [Fact]
        public void BackoffGrowsAndCaps()
        {
            var min = TimeSpan.FromSeconds(1);
            var max = TimeSpan.FromSeconds(30);
            Assert.Equal(1000, CikletGateway.ComputeBackoff(0, min, max, 0.9999999).TotalMilliseconds, 0);
            Assert.Equal(500, CikletGateway.ComputeBackoff(0, min, max, 0).TotalMilliseconds, 0);
            Assert.Equal(8000, CikletGateway.ComputeBackoff(3, min, max, 0.9999999).TotalMilliseconds, 0);
            Assert.Equal(30000, CikletGateway.ComputeBackoff(10, min, max, 0.9999999).TotalMilliseconds, 0);
            Assert.Equal(30000, CikletGateway.ComputeBackoff(int.MaxValue, min, max, 0.9999999).TotalMilliseconds, 0);
        }

        [Fact]
        public async Task DispatchesLobbyEventsSendsHeartbeatAndReconnects()
        {
            var sockets = new List<FakeSocket>();
            var delays = new List<TimeSpan>();
            var heartbeatGate = new SemaphoreSlim(0);
            var gateway = new CikletGateway(_ => Task.FromResult("cik_at_1"), new CikletOptions(), () =>
            {
                var s = new FakeSocket();
                lock (sockets) sockets.Add(s);
                return s;
            })
            {
                Random01 = () => 0.9999999,
                Delay = async (t, ct) =>
                {
                    if (t == CikletGateway.DefaultHeartbeatInterval)
                    {
                        await heartbeatGate.WaitAsync(ct); // testin izniyle "30 sn" geçer
                        return;
                    }
                    lock (delays) delays.Add(t);
                },
            };
            var events = new BlockingCollection<LobbyEvent>();
            var readies = 0;
            gateway.LobbyEvent += e => events.Add(e);
            gateway.Ready += _ => Interlocked.Increment(ref readies);
            gateway.Connect();

            var first = await WaitFor(() => { lock (sockets) return sockets.FirstOrDefault(); });
            Assert.Equal("Bearer cik_at_1", first.Headers["Authorization"]);
            first.Incoming.Add("{\"eventType\":\"ready\",\"t\":\"READY\"}");
            first.Incoming.Add("{\"eventType\":\"lobby.message_create\",\"t\":\"LOBBY_MESSAGE_CREATE\",\"d\":{\"id\":\"m1\",\"lobby_id\":\"l1\",\"content\":\"selam\",\"author\":{\"id\":\"u1\",\"username\":\"ornek\"}}}");
            first.Incoming.Add("{\"eventType\":\"lobby.member_remove\",\"t\":\"LOBBY_MEMBER_REMOVE\",\"d\":{\"lobby_id\":\"l1\",\"member\":{\"id\":\"u2\"}}}");
            first.Incoming.Add("bozuk json");

            Assert.True(events.TryTake(out var msg, 5000));
            Assert.Equal("LOBBY_MESSAGE_CREATE", msg.Type);
            Assert.Equal("selam", msg.Message.Content);
            Assert.Equal("l1", msg.LobbyId);
            Assert.True(events.TryTake(out var rem, 5000));
            Assert.Equal("u2", rem.Member.Id);

            heartbeatGate.Release();
            await WaitFor(() => first.Sent.TryPeek(out var hb) ? hb : null);
            Assert.True(first.Sent.TryPeek(out var heartbeat));
            Assert.Equal("{\"event_type\":\"heartbeat\"}", heartbeat);

            // Sunucu kapatır → yeniden bağlanır (ready alındığı için ilk geri çekilme ~1 sn).
            first.Incoming.Add("<close>");
            var second = await WaitFor(() => { lock (sockets) return sockets.Count > 1 ? sockets[1] : null; });
            Assert.NotNull(second);
            lock (delays) Assert.Equal(1000, delays[0].TotalMilliseconds, 0);

            await gateway.DisconnectAsync();
            Assert.Equal(GatewayState.Disconnected, gateway.State);
            Assert.Equal(1, readies);
        }

        [Fact]
        public async Task StopsOnNonRetryableError()
        {
            var errors = new BlockingCollection<CikletException>();
            var count = 0;
            var gateway = new CikletGateway(_ => Task.FromResult("t"), null, () =>
            {
                Interlocked.Increment(ref count);
                var s = new FakeSocket();
                s.Incoming.Add("{\"type\":\"error\",\"code\":\"invalid_token\",\"retryable\":false}");
                return s;
            })
            { Delay = (t, ct) => Task.Delay(1, ct) };
            gateway.Error += e => errors.Add(e);
            gateway.Connect();
            Assert.True(errors.TryTake(out var err, 5000));
            Assert.Equal("invalid_token", err.Code);
            await WaitFor(() => gateway.State == GatewayState.Disconnected ? "ok" : null);
            await Task.Delay(100);
            Assert.Equal(1, count);
        }

        [Fact]
        public async Task StopsWhenSignedOut()
        {
            var errors = new BlockingCollection<CikletException>();
            var gateway = new CikletGateway(_ => throw new CikletException(CikletErrorKind.Auth, "not_signed_in", "x"), null, () => new FakeSocket());
            gateway.Error += e => errors.Add(e);
            gateway.Connect();
            Assert.True(errors.TryTake(out var err, 5000));
            Assert.Equal(CikletErrorKind.Auth, err.Kind);
            await WaitFor(() => gateway.State == GatewayState.Disconnected ? "ok" : null);
        }

        [Fact]
        public async Task BacksOffExponentiallyWhenConnectFails()
        {
            var delays = new List<TimeSpan>();
            var gateway = new CikletGateway(_ => Task.FromResult("t"), null, () => new FakeSocket { ConnectError = new System.Net.WebSockets.WebSocketException("401") })
            {
                Random01 = () => 0.9999999,
                Delay = (t, ct) => { lock (delays) delays.Add(t); return Task.CompletedTask; },
            };
            gateway.Connect();
            await WaitFor(() => { lock (delays) return delays.Count >= 6 ? "ok" : null; });
            await gateway.DisconnectAsync();
            lock (delays)
                Assert.Equal(new double[] { 1000, 2000, 4000, 8000, 16000, 30000 }, delays.Take(6).Select(d => Math.Round(d.TotalMilliseconds)).ToArray());
        }

        private static async Task<T> WaitFor<T>(Func<T> probe) where T : class
        {
            for (var i = 0; i < 500; i++)
            {
                var v = probe();
                if (v != null) return v;
                await Task.Delay(10);
            }
            throw new TimeoutException("Koşul gerçekleşmedi.");
        }
    }
}
