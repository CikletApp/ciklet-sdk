# @ciklet/embedded-activities-sdk

Ciklet'te çalışan zengin, çok oyunculu deneyimler (aktiviteler) oluşturmanızı sağlayan SDK.
Güncel ve tam referans: [docs.ciklet.xyz/activities](https://docs.ciklet.xyz/activities).

## Mimari

Aktiviteler, Ciklet istemcisinde bir iframe içinde çalışan web uygulamalarıdır. SDK, iframe'inizdeki uygulama ile Ciklet arasındaki iletişimi yönetir.

```
┌─────────────────────┐    postMessage RPC    ┌──────────────────────────┐
│ Ciklet İstemcisi     │◄──────────────────────►│ Sizin Aktiviteniz       │
│ (iframe host)        │                        │ (CikletSDK kullanır)    │
│                      │                        │ (kendi sunucunuzda)     │
└─────────────────────┘                        └──────────────────────────┘
```

## Kurulum

```bash
npm install @ciklet/embedded-activities-sdk
```

Paket ESM ve CommonJS olarak yayınlanır; tarayıcıda (iframe içinde) çalışır.

## Hızlı Başlangıç

```typescript
import { CikletSDK } from '@ciklet/embedded-activities-sdk';

const CLIENT_ID = 'sizin-client-id';
const sdk = new CikletSDK(CLIENT_ID, { hostOrigin: 'https://ciklet.xyz' });

async function setup() {
  // 1. READY olayını bekle (kullanıcı yetki onayını verene kadar çözülmez)
  await sdk.ready();

  // 2. Authorization code al (onay zaten alındıysa modal çıkmaz)
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: ['identify'],
  });

  // 3. Kendi backend'inizde code → access_token değişimi yapın
  const response = await fetch('/api/exchange-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  // 4. Token ile kimlik doğrulama yapın
  const auth = await sdk.commands.authenticate({ access_token });
  console.log('Authenticated user:', auth.user, 'expires:', auth.expires);
}

setup();
```

## Kurucu seçenekleri

```typescript
new CikletSDK(clientId, {
  hostOrigin: 'https://ciklet.xyz', // RPC mesajlarının gideceği origin (önerilir)
  commandTimeoutMs: 15_000,          // komut başına zaman aşımı (varsayılan 15 sn)
});
```

`hostOrigin` verilmezse SDK bunu `document.referrer` üzerinden türetir (Ciklet iframe'i
`referrerPolicy="strict-origin"` ile yükler). Referrer da yoksa `"*"`'a düşer ve konsola
uyarı yazar; üretimde her zaman açıkça verin.

## SDK Yöntemleri

### `ready()`
Ciklet istemcisinden READY olayı alınana kadar bekler. Komutlar bundan önce gönderilirse
`commandTimeoutMs` sonunda zaman aşımına uğrar.

```typescript
await sdk.ready();
console.log(sdk.isReady, sdk.readyPayload);
```

### `commands.authorize(input)`
OAuth izin akışını tamamlar ve authorization code döner. Kod 5 dakika geçerlidir ve tek
kullanımlıktır.

```typescript
const { code } = await sdk.commands.authorize({
  client_id: 'YOUR_CLIENT_ID',
  response_type: 'code',
  scope: ['identify'],
});
```

### `commands.authenticate(input)`
Access token ile kimlik doğrulaması yapar. Token Ciklet sunucusunda doğrulanır.

```typescript
const auth = await sdk.commands.authenticate({ access_token: 'cik_at_...' });
// auth: { access_token, user: { id, username, global_name, avatar }, scopes, expires, application }
```

### `commands.getChannel(input?)`
Aktivitenin çalıştığı kanal hakkında bilgi alır (`type` DM için `1`, kanal için `0`).

```typescript
const channel = await sdk.commands.getChannel();
console.log('Channel ID:', channel.id);
```

### `commands.getInstanceConnectedParticipants()`
Bu aktivite örneğine bağlı katılımcıların listesini alır.

```typescript
const { participants } = await sdk.commands.getInstanceConnectedParticipants();
```

### `commands.setActivity(input)`
Kullanıcının rich presence'ını ayarlar; `metadata` ile aktivite kartının adı/simgesi/rengi
güncellenebilir.

```typescript
await sdk.commands.setActivity({
  activity: { state: 'Playing', details: 'In a game' },
  metadata: { activityName: 'Oyunum', activityColor: '#ff0000' },
});
```

### `commands.openExternalLink(input)`
Kullanıcının tarayıcısında harici bir link açar. Yalnızca `http(s)` kabul edilir.

```typescript
await sdk.commands.openExternalLink({ url: 'https://example.com' });
```

### `commands.getPlatformBehaviors()`
Platform davranışlarını alır (`{ iosKeyboardResizesView }`).

### `commands.setConfig(input)`
Aktivite yapılandırmasını ayarlar (`{ use_interactive_pip }`).

### `commands.captureLog(input)`
Hata ayıklama loglarını Ciklet istemcisine gönderir (yalnızca geliştirme derlemesinde yazılır).

### `commands.userSettingsGetLocale()`
Kullanıcının dil ayarını alır (`{ locale }`).

### `subscribe(event, handler)` / `unsubscribe(event, handler?)`
Bir SDK olayına abone olur / aboneliği iptal eder.

```typescript
sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (data) => {
  console.log('Katılımcılar:', data.participants);
});
```

### `close(code?, message?)`
Aktiviteyi kapatır; bekleyen komutlar reddedilir, örnek yeniden kullanılamaz.

```typescript
import { RPCCloseCodes } from '@ciklet/embedded-activities-sdk';
sdk.close(RPCCloseCodes.CLOSE_NORMAL, 'Aktiviteden çıkıldı');
```

## Hatalar

Reddedilen bir komut `RPCError` ile reddedilir: `error.code` (sayı), `error.command`,
`error.message` (`"RPC Error <kod>: <açıklama>"`).

| Kod | Anlamı |
|-----|--------|
| `1001` | Bilinmeyen komut |
| `4001` | Yetki reddedildi / token geçersiz |
| `4002` | Geçersiz argüman (örn. `http(s)` olmayan URL) |

## SDK Olayları

| Olay | Açıklama |
|------|----------|
| `READY` | SDK bağlantısı kurulduğunda (sonradan abone olunursa hemen tetiklenir) |
| `ERROR` | Hata oluştuğunda |
| `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` | Katılımcılar değiştiğinde |
| `ACTIVITY_LAYOUT_MODE_UPDATE` | Layout modu değiştiğinde |
| `ORIENTATION_UPDATE` | Ekran yönü değiştiğinde |
| `CURRENT_USER_UPDATE` | Kullanıcı bilgileri güncellendiğinde |
| `THERMAL_STATE_UPDATE` | Cihaz ısı durumu değiştiğinde |

## URL Parametreleri

Ciklet, aktivitenizi yüklerken iframe URL'sine şu parametreleri ekler:

| Parametre | Açıklama |
|-----------|----------|
| `instance_id` | Bu aktivite örneğinin benzersiz ID'si |
| `channel_id` | Aktivitenin çalıştığı kanalın ID'si |
| `location_id` | Konum ID'si (şu an `channel_id` ile aynı) |
| `frame_id` | iframe'in benzersiz ID'si |
| `platform` | Platform (`web`, `desktop`, `mobile`) |
| `launch_id` | Başlatma zamanı |
| `referrer_id` | Aktiviteyi başlatan kullanıcının ID'si (kimlik kanıtı DEĞİLDİR) |

## Backend Gereksinimler

Aktiviteniz, OAuth code → token değişimi için bir backend'e ihtiyaç duyar. Kod, Ciklet'in
standart token uç noktasında `client_secret` ile takas edilir; aktivite kodlarında
`code_verifier` gönderilmez. `client_secret` yalnızca sunucuda yaşar.

```typescript
// POST /api/exchange-token
app.post('/api/exchange-token', async (req, res) => {
  const { code } = req.body;

  const response = await fetch('https://ciklet.xyz/api/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }),
  });

  if (!response.ok) return res.status(response.status).json(await response.json());

  const data = await response.json(); // { access_token, refresh_token, expires_in, scope }
  res.json({ access_token: data.access_token });
});
```

Kullanıcı bilgisi `GET https://ciklet.xyz/api/oauth/userinfo` (`Authorization: Bearer`)
ile okunur; token yenileme ve iptal için [OAuth2 dokümantasyonuna](https://docs.ciklet.xyz/oauth2/tokens) bakın.

## Paylaşılan tipler

`@ciklet/embedded-activities-sdk/types` alt yolu Ciklet'in HTTP ve gerçek zamanlı
sözleşmelerinin tiplerini dışa aktarır: profil/sunucu/kanal/mesaj modelleri, ağ geçidi olay
adları (`ClientEvents`, `ServerEvents`, `GatewayErrorFrame`) ve bot olay yükleri
(`BotReadyEvent`, `BotMessageCreateEvent`). Ağ geçidi adresi `wss://ciklet.xyz/gateway/ws`
(`DEFAULT_GATEWAY_URL`); heartbeat aralığı `HEARTBEAT_INTERVAL_MS`.

## Deployment

Aktivitenizi kendi sunucunuzda barındırın. Ciklet, aktivitenizi iframe olarak yükler.

1. Uygulamanızı build edin ve statik dosyaları serve edin
2. HTTPS kullanın (zorunlu; `http` yalnızca localhost için)
3. `X-Frame-Options` göndermeyin; CSP kullanıyorsanız `frame-ancestors https://ciklet.xyz` verin
4. Uygulamanızı Geliştirici Portalı'ndan incelemeye gönderin — onaylanana kadar listelenmez

## Lisans

MIT
