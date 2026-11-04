// Ciklet Social SDK — temel örnek.
//
// Kullanım: boş bir sahnede bir GameObject'e bu bileşeni ekleyin, Inspector'da
// Client Id'yi doldurun ve Play'e basın. Geliştirici Portalı'nda uygulamanız:
//   - İstemci tipi PUBLIC (gizli anahtar oyuna girmez),
//   - Redirect URI: http://127.0.0.1/callback  (port serbest — RFC 8252),
//   - Kapsamlar: identify relationships.read activities.write lobbies.write game_stats.write
using System;
using System.Collections.Generic;
using System.Threading;
using Ciklet.Social;
using Ciklet.Social.Unity;
using UnityEngine;

namespace Ciklet.Social.Samples
{
    public sealed class CikletSocialSample : MonoBehaviour
    {
        [SerializeField] private string clientId = "cik_app_...";
        [SerializeField] private string lobbySecret = "ornek-mac-1";

        private CikletAuth _auth;
        private CikletClient _client;
        private CikletGateway _gateway;
        private CancellationTokenSource _cts;

        private CikletUser _me;
        private int _friendCount;
        private CikletLobby _lobby;
        private LobbyVoiceInfo _voice;
        private string _chatInput = "";
        private string _status = "Hazır";
        private readonly List<string> _log = new List<string>();
        private float _nextPresence;

        private static readonly string[] Scopes =
            { "identify", "relationships.read", "activities.write", "lobbies.write", "game_stats.write" };

        private void Awake()
        {
            _cts = new CancellationTokenSource();
            _auth = CikletUnity.CreateAuth(clientId);
            _client = CikletUnity.CreateClient(_auth);
            _gateway = CikletUnity.CreateGateway(_auth);
            _gateway.StateChanged += s => _status = "Ağ geçidi: " + s;
            _gateway.Error += e => Log("Ağ geçidi hatası: " + e.Code);
            _gateway.LobbyEvent += OnLobbyEvent;
            if (_auth.IsSignedIn) AfterLogin();
        }

        private void OnDestroy()
        {
            _cts.Cancel();
            _gateway.Dispose();
            if (_auth.IsSignedIn) _ = _client.ClearActivityAsync();
        }

        private void Update()
        {
            // Etkinlik oturumu 3 dk'da düşer; 2 dk'da bir tazele.
            if (_me != null && Time.unscaledTime >= _nextPresence)
            {
                _nextPresence = Time.unscaledTime + 120f;
                Run(() => _client.UpdateActivityAsync(new CikletActivity
                {
                    Details = _lobby != null ? "Lobide (" + _lobby.Members.Count + " kişi)" : "Ana menüde",
                    StartTimestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                }, _cts.Token));
            }
        }

        private async void Login()
        {
            try
            {
                _status = "Tarayıcıda onay bekleniyor…";
                await _auth.LoginAsync(Scopes, _cts.Token);
                AfterLogin();
            }
            catch (OperationCanceledException) { }
            catch (CikletException e) { _status = "Giriş başarısız: " + e.Code; }
        }

        private async void AfterLogin()
        {
            try
            {
                _me = await _client.GetCurrentUserAsync(_cts.Token);
                _friendCount = (await _client.GetFriendsAsync(_cts.Token)).Count;
                _status = "Giriş yapıldı: " + _me.DisplayName;
                _gateway.Connect();
            }
            catch (OperationCanceledException) { }
            catch (CikletException e) { _status = "Hata: " + e.Code + " (" + e.Message + ")"; }
        }

        private void OnLobbyEvent(LobbyEvent ev)
        {
            if (_lobby == null || ev.LobbyId != _lobby.Id) return;
            switch (ev.Type)
            {
                case "LOBBY_MESSAGE_CREATE":
                    Log((ev.Message.Author?.Username ?? "sistem") + ": " + ev.Message.Content);
                    break;
                case "LOBBY_MEMBER_ADD":
                    Log("Katıldı: " + ev.Member.Id);
                    Run(async () => _lobby = await _client.GetLobbyAsync(_lobby.Id, _cts.Token));
                    break;
                case "LOBBY_MEMBER_REMOVE":
                    Log("Ayrıldı: " + ev.Member.Id);
                    break;
                case "LOBBY_UPDATE":
                    _lobby = ev.Lobby;
                    break;
                case "LOBBY_DELETE":
                    Log("Lobi kapandı.");
                    _lobby = null;
                    break;
            }
        }

        private void OnGUI()
        {
            GUILayout.BeginArea(new Rect(16, 16, 460, Screen.height - 32), GUI.skin.box);
            GUILayout.Label("Ciklet Social SDK — " + _status);
            if (!_auth.IsSignedIn)
            {
                if (GUILayout.Button("Ciklet ile giriş yap")) Login();
                GUILayout.EndArea();
                return;
            }
            if (_me != null) GUILayout.Label(_me.DisplayName + " (@" + _me.Username + ") · " + _friendCount + " arkadaş");

            if (_lobby == null)
            {
                lobbySecret = GUILayout.TextField(lobbySecret);
                if (GUILayout.Button("Lobiye katıl / oluştur"))
                    Run(async () =>
                    {
                        _lobby = await _client.CreateOrJoinLobbyAsync(lobbySecret,
                            memberMetadata: new Dictionary<string, string> { ["hazir"] = "0" }, ct: _cts.Token);
                        foreach (var m in await _client.GetLobbyMessagesAsync(_lobby.Id, limit: 20, ct: _cts.Token))
                            Log((m.Author?.Username ?? "sistem") + ": " + m.Content);
                        _nextPresence = 0;
                    });
            }
            else
            {
                GUILayout.Label("Lobi " + _lobby.Id + " · " + _lobby.Members.Count + " üye");
                GUILayout.BeginHorizontal();
                _chatInput = GUILayout.TextField(_chatInput, GUILayout.Width(330));
                if (GUILayout.Button("Gönder") && _chatInput.Length > 0)
                {
                    var text = _chatInput;
                    _chatInput = "";
                    Run(() => _client.SendLobbyMessageAsync(_lobby.Id, text, ct: _cts.Token));
                }
                GUILayout.EndHorizontal();
                if (GUILayout.Button("Sesli sohbet bilgisi (LiveKit)"))
                    Run(async () =>
                    {
                        _voice = await _client.GetLobbyVoiceAsync(_lobby.Id, _cts.Token);
                        // LiveKit Unity SDK: var room = new Room(); room.Connect(_voice.Url, _voice.Token);
                        Log("Ses odası " + _voice.RoomName + " @ " + _voice.Url);
                    });
                if (GUILayout.Button("Skoru profile yaz"))
                    Run(() => _client.PutGameStatsAsync(new Dictionary<string, object>
                    {
                        ["seviye"] = UnityEngine.Random.Range(1, 100),
                        ["son_mac"] = DateTime.UtcNow.ToString("o"),
                    }, ct: _cts.Token));
                if (GUILayout.Button("Lobiden ayrıl"))
                    Run(async () => { await _client.LeaveLobbyAsync(_lobby.Id, _cts.Token); _lobby = null; _nextPresence = 0; });
            }

            if (GUILayout.Button("Çıkış yap"))
                Run(async () => { await _gateway.DisconnectAsync(); await _auth.SignOutAsync(); _me = null; _lobby = null; });

            foreach (var line in _log) GUILayout.Label(line);
            GUILayout.EndArea();
        }

        private async void Run(Func<System.Threading.Tasks.Task> action)
        {
            try { await action(); }
            catch (OperationCanceledException) { }
            catch (CikletException e) { Log("Hata: " + e.Code + " — " + e.Message); }
        }

        private void Log(string line)
        {
            _log.Add(line);
            if (_log.Count > 14) _log.RemoveAt(0);
        }
    }
}
