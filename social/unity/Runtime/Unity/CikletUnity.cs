using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace Ciklet.Social.Unity
{
    /// <summary>
    /// Jetonları PlayerPrefs'te saklar. PlayerPrefs ŞİFRELİ DEĞİLDİR (Windows'ta kayıt
    /// defteri, macOS'ta plist): rahat geliştirme için var; yayında platformun güvenli
    /// deposunu (Windows DPAPI / Credential Manager, Keychain) kullanan kendi
    /// <see cref="ITokenStore"/> uygulamanızı tercih edin. Yazma ana iş parçacığına aktarılır.
    /// </summary>
    public sealed class PlayerPrefsTokenStore : ITokenStore
    {
        private readonly string _key;
        private readonly SynchronizationContext _main;
        private CikletTokens _cached;

        public PlayerPrefsTokenStore(string clientId)
        {
            _key = "ciklet.social.tokens." + clientId;
            _main = SynchronizationContext.Current;
            _cached = CikletTokens.FromJson(PlayerPrefs.GetString(_key, ""));
        }

        public CikletTokens Load() => _cached;

        public void Save(CikletTokens tokens)
        {
            _cached = tokens;
            var json = tokens.ToJson();
            OnMain(() => { PlayerPrefs.SetString(_key, json); PlayerPrefs.Save(); });
        }

        public void Clear()
        {
            _cached = null;
            OnMain(() => { PlayerPrefs.DeleteKey(_key); PlayerPrefs.Save(); });
        }

        private void OnMain(System.Action action)
        {
            if (_main == null || SynchronizationContext.Current == _main) action();
            else _main.Post(_ => action(), null);
        }
    }

    /// <summary>Unity kısayolları. Hepsini ana iş parçacığında (Awake/Start) çağırın.</summary>
    public static class CikletUnity
    {
        /// <summary>UnityWebRequest taşıyıcılı, PlayerPrefs depolu giriş nesnesi.</summary>
        public static CikletAuth CreateAuth(string clientId, ITokenStore store = null, CikletOptions options = null) =>
            new CikletAuth(clientId, new UnityWebRequestTransport(), store ?? new PlayerPrefsTokenStore(clientId), options);

        public static CikletClient CreateClient(CikletAuth auth) => new CikletClient(auth, new UnityWebRequestTransport());

        /// <summary>
        /// Ağ geçidi (ClientWebSocket). WebGL'de ClientWebSocket yok — orada tarayıcı
        /// WebSocket'ine bir <see cref="IGatewaySocket"/> köprüsü yazmanız gerekir.
        /// Olaylar bu metodu çağırdığınız iş parçacığında (ana) gelir.
        /// </summary>
        public static CikletGateway CreateGateway(CikletAuth auth) => new CikletGateway(auth);

        /// <summary>Sistem tarayıcısında giriş + loopback geri dönüşü (yalnızca masaüstü: Windows/macOS/Linux).</summary>
        public static Task<CikletTokens> LoginAsync(this CikletAuth auth, IEnumerable<string> scopes, CancellationToken cancellationToken = default)
        {
#if UNITY_WEBGL || UNITY_IOS || UNITY_ANDROID
            throw new System.PlatformNotSupportedException(
                "Loopback girişi masaüstü içindir. Mobilde özel şemalı redirect_uri ile AuthorizationRequest + ExchangeCodeAsync kullanın.");
#else
            return auth.LoginWithLoopbackAsync(scopes, Application.OpenURL, cancellationToken);
#endif
        }
    }
}
