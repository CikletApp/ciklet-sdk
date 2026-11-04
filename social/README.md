# Ciklet Social SDK (Unity / Unreal)

Oyununuza Ciklet hesabıyla giriş, arkadaş listesi, profilde etkinlik (rich presence), lobiler,
lobi sohbeti ve sesli sohbeti, profilde oyun istatistikleri ekler. Discord Social SDK'nın Ciklet
karşılığıdır. İki paket de Ciklet'in herkese açık uçlarını düz HTTPS + JSON ve bir WebSocket ile
sarmalar; yerel (native) bir kitaplık içermez.

Tam belge: [docs.ciklet.xyz/social-sdk](https://docs.ciklet.xyz/social-sdk)

| Klasör | Ne |
| --- | --- |
| [`unity/`](unity) | UPM paketi `xyz.ciklet.social` (C#; `UnityWebRequest` + `ClientWebSocket`), Unity 2021.3+ |
| [`unreal/CikletSocial/`](unreal/CikletSocial) | Unreal Engine 5.1+ eklentisi (C++; `FHttpModule` + `FWebSocketsModule`) |

Sürüm: **0.1.0 (beta)**.

## 1. Uygulamayı hazırlayın

Geliştirici Portalı'nda (`ciklet.xyz/developers`) uygulamanız:

1. **İstemci tipi `PUBLIC`.** Oyun istemcisi `client_secret` saklayamaz; kimlik kanıtı PKCE'dir.
2. **Redirect URI `http://127.0.0.1/callback`.** Masaüstü oyun her açılışta işletim sisteminden
   boş bir port alır ve `http://127.0.0.1:<port>/callback` adresini dinler. Ciklet, kayıtlı
   loopback adreste **yalnızca portun** değişmesine izin verir (RFC 8252 §7.3); ana makine
   (`127.0.0.1` ya da `[::1]`), yol ve sorgu birebir eşleşmeli. `localhost` port serbestliği
   almaz.
3. **Kapsamlar** — ihtiyacınız olanları kaydedin:

| Kapsam | Ne için |
| --- | --- |
| `identify` | `GET /users/@me` |
| `relationships.read` | Arkadaşlar, istekler |
| `activities.write` | Profilde etkinlik (headless session) |
| `lobbies.write` | Lobiler, lobi sohbeti/sesi, ağ geçidi `lobby.*` olayları |
| `game_stats.write` | Profildeki oyun istatistiği kartı |

## 2. Kurulum

**Unity** — Package Manager › *Add package from git URL*:

```text
https://github.com/CikletApp/ciklet-sdk.git?path=/social/unity
```

Örnek: Package Manager › Ciklet Social SDK › Samples › *Temel Örnek* › Import; `CikletSocialSample`
bileşenini boş bir sahnedeki bir GameObject'e ekleyin, Client Id'yi girin, Play.

**Unreal** — `social/unreal/CikletSocial` klasörünü projenizin `Plugins/` klasörüne kopyalayın,
oyun modülünüzün `.Build.cs` dosyasına `"CikletSocial"` ve `"Json"` ekleyin. Örnek aktör:
[`unreal/Examples/`](unreal/Examples).

## 3. Kullanım (Unity)

```csharp
using Ciklet.Social;
using Ciklet.Social.Unity;

var auth = CikletUnity.CreateAuth("cik_app_...");           // ana iş parçacığında
var client = CikletUnity.CreateClient(auth);
var gateway = CikletUnity.CreateGateway(auth);

if (!auth.IsSignedIn)
    await auth.LoginAsync(new[] { "identify", "relationships.read", "activities.write", "lobbies.write", "game_stats.write" });

var me = await client.GetCurrentUserAsync();
var friends = await client.GetFriendsAsync();

gateway.LobbyEvent += ev => { if (ev.Type == "LOBBY_MESSAGE_CREATE") Debug.Log(ev.Message.Content); };
gateway.Connect();

var lobby = await client.CreateOrJoinLobbyAsync("mac-42");
await client.SendLobbyMessageAsync(lobby.Id, "gg");
var voice = await client.GetLobbyVoiceAsync(lobby.Id);       // LiveKit: voice.Url + voice.Token
await client.UpdateActivityAsync(new CikletActivity { Details = "Lobide" });   // ≤ 2 dk'da bir
await client.PutGameStatsAsync(new Dictionary<string, object> { ["seviye"] = 12, ["lig"] = "Elmas" });
```

## 4. Kullanım (Unreal)

```cpp
TSharedRef<FCikletAuth> Auth = FCikletAuth::Create(TEXT("cik_app_..."), MakeShared<FCikletFileTokenStore>(TEXT("cik_app_...")));
TSharedRef<FCikletClient> Client = FCikletClient::Create(Auth);
TSharedRef<FCikletGateway> Gateway = FCikletGateway::Create(Auth);

FCikletOperation Login = Auth->LoginWithLoopback({TEXT("identify"), TEXT("lobbies.write")},
	[Client, Gateway](const TCikletResult<FCikletTokens>& Result)
	{
		if (!Result) { UE_LOG(LogTemp, Warning, TEXT("%s"), *Result.Error.ToString()); return; }
		Gateway->Connect();
		Client->CreateOrJoinLobby(TEXT("mac-42"), {}, {}, 0, [](const TCikletResult<FCikletLobby>& Lobby) { /* … */ });
	});
// Login.Cancel();  → geri çağırma ECikletErrorKind::Cancelled ile gelir
```

## 5. Davranış

- **Jeton yenileme.** Erişim jetonu 1 saat, yenileme jetonu 30 gün. SDK süresi 60 sn içinde dolacak
  jetonu isteği göndermeden önce yeniler, 401 alırsa bir kez yenileyip tekrar dener. Yenileme
  jetonu **rotasyonludur** (her yenilemede yenisi gelir; eskisi tekrar kullanılırsa sunucu tüm
  aileyi iptal eder) — SDK aynı anda gelen çağrıları tek yenilemede toplar ve yeni jetonu hemen
  depoya yazar. `invalid_grant` → oturum kapanır, `Auth` hatası; yeniden giriş gerekir.
- **Jeton deposu.** Unity'de varsayılan `PlayerPrefsTokenStore`, Unreal'da `FCikletFileTokenStore`
  (`Saved/Ciklet/`). İkisi de **şifreli değildir**; yayında Windows DPAPI / Keychain kullanan kendi
  `ITokenStore` / `ICikletTokenStore` uygulamanızı verin.
- **Ağ geçidi.** `wss://ciklet.xyz/gateway/ws`, `Authorization: Bearer`. 30 sn'de bir
  `{"event_type":"heartbeat"}` gönderilir (sunucu 60 sn sessiz bağlantıyı kapatır); iki aralık
  boyunca `heartbeat.ack` gelmezse bağlantı ölü sayılıp yeniden kurulur. Kopmada 1 sn → 30 sn üstel
  geri çekilme + rastgele sapma (`ready` alınmış bağlantıdan sonra sayaç sıfırlanır). Sunucu
  `{ "type": "error", "retryable": false }` gönderirse ya da giriş yoksa yeniden denenmez.
  Olaylar: `LOBBY_CREATE`, `LOBBY_UPDATE`, `LOBBY_DELETE`, `LOBBY_MEMBER_ADD`,
  `LOBBY_MEMBER_UPDATE`, `LOBBY_MEMBER_REMOVE`, `LOBBY_MESSAGE_CREATE`.
- **Hatalar.** Tür: `Http` (durum + sunucu kodu, ör. `unknown_lobby`, `insufficient_scope`),
  `Network`, `Timeout`, `Protocol`, `Auth`; Unreal'da ayrıca `Cancelled` (Unity'de iptal
  `OperationCanceledException`). `IsRetryable`: ağ, zaman aşımı, 429 (`RetryAfterSeconds`), 5xx.
- **Zaman aşımı ve iptal.** REST isteği varsayılan 15 sn (`CikletOptions.RequestTimeout` /
  `FCikletOptions::RequestTimeoutSeconds`), giriş 5 dk, ağ geçidi bağlanma 15 sn. Unity'de her
  metot `CancellationToken` alır; Unreal'da her metot `FCikletOperation` döndürür (`Cancel()`).
- **İş parçacığı.** Unity: SDK'yı ana iş parçacığından kullanın; `UnityWebRequest` ve
  `PlayerPrefs` ana iş parçacığına aktarılır, ağ geçidi olayları `Connect()`'in çağrıldığı
  bağlamda gelir. Unreal: tüm geri çağırmalar oyun iş parçacığında.

## 6. Sesli sohbet

`POST /lobbies/{id}/voice` bir LiveKit sunucu adresi ve oda jetonu döndürür (`url`, `token`,
`room_name`). Ses aktarımı bu paketlerde yok; LiveKit'in resmî istemcilerini kullanın:

- Unity: [LiveKit Unity SDK](https://github.com/livekit/client-sdk-unity) — `room.Connect(voice.Url, voice.Token)`
- Unreal: LiveKit'in C++ / Rust istemci SDK'ları ([github.com/livekit](https://github.com/livekit)) ya da LiveKit'i destekleyen bir WebRTC eklentisi

## 7. Oyun sunucusu (bot jetonu)

`CikletBotClient` (Unity çekirdeği, .NET'te de çalışır) ve `FCikletBotClient` (Unreal) lobileri
oyun sunucusundan yönetir: lobi oluştur / güncelle / sil, üye ekle / çıkar / toplu güncelle, lobiye
bot mesajı, oyun istatistiği şeması ve oyuncu adına istatistik yazma.

> **Bot jetonu gizlidir.** Oyun istemcisine — derlemeye, ayar dosyasına, PlayerPrefs'e, pak
> dosyasına — **asla** koymayın; istemciden çıkarılabilir ve botunuzun bütün yetkilerini verir.
> Yalnızca adanmış sunucuda (Unity dedicated server / `UE_SERVER`) ya da kendi backend'inizde,
> ortam değişkeninden (`CIKLET_BOT_TOKEN`) okuyarak kullanın.

## 8. Platformlar

| | Giriş (loopback) | REST | Ağ geçidi |
| --- | --- | --- | --- |
| Windows / macOS / Linux | ✓ | ✓ | ✓ |
| Unity WebGL | — (tarayıcı akışı) | ✓ | ClientWebSocket yok: tarayıcı WebSocket'i için kendi `IGatewaySocket`'inizi yazın |
| Android / iOS | — (özel şemalı redirect URI + `AuthorizationRequest` + `ExchangeCodeAsync`) | ✓ | ✓ (doğrulanmadı) |
| Konsollar | doğrulanmadı | | |

## 9. Doğrulama durumu (0.1.0)

| Parça | Nasıl doğrulandı |
| --- | --- |
| Unity çekirdeği (`Runtime/Core`: JSON, PKCE, loopback dinleyici, giriş/yenileme, REST, bot, ağ geçidi) | `Tests~/` — .NET Standard 2.1 + C# 9 ile derlenir, 38 xUnit testi (`dotnet test unity/Tests~/Ciklet.Social.Tests`) |
| Unity katmanı (`Runtime/Unity`, örnek) | `Tests~/UnityCompileCheck` — elle yazılmış UnityEngine stub'larıyla derleme denetimi; **gerçek Unity Editor'da açılıp Play'de denenmedi** |
| Unreal çekirdeği (`CikletSocialCore`: URL/sorgu, SHA-256/PKCE, loopback istek ayrıştırma, geri çekilme) | `unreal/Tests/core_test.cpp` — motorsuz C++17 testi (`zig c++` / `g++` / `clang++`) |
| Unreal eklentisi (HTTP, WebSocket, soket dinleyici, tipler) | **Derlenmedi** — Unreal Engine bu makinede yok; UE 5.1–5.5'te `Build`, Editor'da örnek aktörle giriş + lobi denenmeli |

Gerçek motorda doğrulanması gerekenler: UPM'in `.meta` dosyalarını kabul etmesi, `UnityWebRequest`
iptali, IL2CPP'de `TcpListener` / `ClientWebSocket`, Unreal'da `IHttpRequest::SetTimeout`,
`FWebSocketsModule::CreateWebSocket` başlıkları, `FSocket` dinleyici ve UBT unity build.

## 10. Testler

```bash
# Unity çekirdeği
dotnet test social/unity/Tests~/Ciklet.Social.Tests
dotnet build social/unity/Tests~/UnityCompileCheck

# Unreal çekirdeği
cd social/unreal/Tests
zig c++ -std=c++17 -I../CikletSocial/Source/CikletSocial/Public core_test.cpp ../CikletSocial/Source/CikletSocial/Private/CikletSocialCore.cpp -o core_test && ./core_test
```

Lisans: MIT.
