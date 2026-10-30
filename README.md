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
Bu aktivite örneğine bağlı katılımcıların listesini alır. Discord adıyla
`commands.getActivityInstanceConnectedParticipants()` de aynı komuttur.

```typescript
const { participants } = await sdk.commands.getInstanceConnectedParticipants();
```

### `commands.setActivity(input)`
Kullanıcının rich presence'ını (profil, üye listesi, arkadaş listesi) ayarlar — Discord'un
`setActivity`'siyle aynı şekil. Etkinliğin adı her zaman uygulamanızın adıdır.
`activity: null` durumu kaldırır; aktivite kapanınca host da kendiliğinden kaldırır.

| Alan | Açıklama |
|------|----------|
| `type` | `ActivityType` (0 oynuyor — varsayılan, 2 dinliyor, 3 izliyor, 5 yarışıyor) |
| `details`, `state` | İkinci ve üçüncü satır (en çok 128 karakter) |
| `party.size` | `[şu an, en çok]` — durum satırına "(2/4)" olarak eklenir. `party.id` yayınlanmaz |
| `timestamps.start` / `end` | Epoch milisaniye (saniye de kabul edilir); `end` kalan süreyi gösterir |
| `assets.large_image` / `small_image` | `https:` adresi ya da Portal › Rich Presence › Art Assets anahtarı |
| `assets.large_text` / `small_text` | Görselin açıklaması |

```typescript
await sdk.commands.setActivity({
  activity: {
    details: 'Rekabetçi maç',
    state: 'Takımda',
    party: { size: [2, 4] },
    timestamps: { start: Date.now() },
    assets: { large_image: 'map-dust', large_text: 'Dust' },
  },
});
```

`metadata` (Ciklet uzantısı) yalnızca yerel aktivite kutusunun adını/simgesini/rengini değiştirir.

### `commands.openExternalLink(input)`
Kullanıcının tarayıcısında harici bir link açar. Yalnızca `http(s)` kabul edilir.

```typescript
await sdk.commands.openExternalLink({ url: 'https://example.com' });
```

### `commands.openInviteDialog()`
Ciklet istemcisinin **"Arkadaşları Davet Et"** sayfasını bu aktivite oturumu için açar
(Discord'daki `commands.openInviteDialog()` karşılığı). Kapsam gerektirmez.

Kullanıcı host arayüzünde arkadaşlarını / DM'lerini seçer, host seçilen her sohbete bir
aktivite davet kartı gönderir. Söz sayfa **açılır açılmaz** `{}` ile çözülür; kullanıcının
gönderip göndermediğini beklemez ve kimin davet edildiğini aktiviteye **asla** bildirmez.
Sayfa zaten açıkken çağırmak yalnızca tekrar çözülür. Bir kullanıcı hareketinden (buton
tıklaması) çağırın. Host aynı sayfayı kendi aktivite menüsünde de sunar.

```typescript
import { RPCError, RPCErrorCodes } from '@ciklet/embedded-activities-sdk';

inviteButton.onclick = async () => {
  try {
    await sdk.commands.openInviteDialog();
  } catch (err) {
    if (err instanceof RPCError && err.code === RPCErrorCodes.UNSUPPORTED_ON_CLIENT) {
      inviteButton.hidden = true; // bu host'ta davet arayüzü yok
    }
  }
};
```

Davetin kime ulaşabileceğine host karar verir: kart yalnızca oturumun bağlı olduğu
sohbete erişimi olan kişilerde "Katıl" düğmesi gösterir (bkz. host belgeleri).

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
`CLOSE_NORMAL` dışındaki bir kodla kapatırken verilen `message` kullanıcıya bildirim olarak
gösterilir (Discord gibi).

```typescript
import { RPCCloseCodes } from '@ciklet/embedded-activities-sdk';
sdk.close(RPCCloseCodes.CLOSE_NORMAL, 'Aktiviteden çıkıldı');
```

### `patchUrlMappings(mappings, config?)`
Discord'daki `patchUrlMappings` karşılığı. Aktiviteler Ciklet aktivite vekilinin arkasında
(`https://<etiket>.<vekil-alanı>`) çalışır ve yalnızca kendi kökenine istek atabilir. Portal ›
Etkinlikler › URL Eşlemeleri'nde tanımladığınız hedeflere giden mutlak adresleri vekil yoluna
çevirir: önek eşlemeleri `/.proxy/<önek>/…`, kök eşleme (`/`) doğrudan `/…` altındadır.
`fetch`, `XMLHttpRequest` ve `WebSocket` varsayılan olarak yamanır; `patchSrcAttributes: true`
ile `src` öznitelikleri de çevrilir. Dönen fonksiyon yamaları geri alır.

```typescript
import { patchUrlMappings } from '@ciklet/embedded-activities-sdk';

patchUrlMappings([
  { prefix: '/api', target: 'api.example.com' },
  { prefix: '/cdn', target: 'example.com/static' },
]);
// fetch('https://api.example.com/v1/me') → https://<etiket>.<vekil>/.proxy/api/v1/me
```

Uygulama açılır açılmaz, istek atmadan önce ve yalnızca Ciklet içinde çalışırken çağırın.

### Başlatma bağlamı
SDK, host'un iframe adresine eklediği parametreleri okur (bkz. URL Parametreleri):

```typescript
sdk.customId;      // Portal'daki özel bağlantının customId'si (yoksa null)
sdk.referrerId;    // bağlantıyı / daveti paylaşan kullanıcı (mevcut kullanıcı DEĞİL; yoksa null)
sdk.launchId;      // her başlatmada benzersiz
sdk.locationId;    // aktivitenin çalıştığı yer (şu an sohbet kimliği)
sdk.guildId;       // sunucu kanalında sunucu kimliği, DM'de null
sdk.launchContext; // hepsi tek nesnede
```

`referrerId` kimlik kanıtı değildir; ödül vb. için sunucunuzda doğrulayın.

### Safe area
Host çentik / ev çubuğu boşluklarını gönderir; SDK bunları `<html>` üzerinde
`--ciklet-safe-area-inset-top|right|bottom|left` CSS değişkenlerine yazar (Discord:
`--discord-safe-area-inset-*`). Başlangıç değeri `0px`; web ve masaüstünde hep `0px`.

```css
.toolbar { padding-bottom: var(--ciklet-safe-area-inset-bottom); }
```

## Hatalar

Reddedilen bir komut `RPCError` ile reddedilir: `error.code` (sayı), `error.command`,
`error.message` (`"RPC Error <kod>: <açıklama>"`).

| Kod | Anlamı |
|-----|--------|
| `1001` | Bilinmeyen komut |
| `1002` | Komut bu istemcide desteklenmiyor (örn. web'de `fetchExternal`, sohbet bağlamı olmayan yerde `openInviteDialog`) |
| `4001` | Yetki reddedildi / token geçersiz |
| `4002` | Geçersiz argüman (örn. `http(s)` olmayan URL) |
| `4003` | Hedef bu aktivitenin izin listesinde değil |
| `4004` | Yerel katman isteği yapamadı (ağ hatası / zaman aşımı) |
| `4005` | Kullanıcının buna şu an izni yok (örn. oturumda değilken `openInviteDialog`) |
| `4029` | Hız sınırı aşıldı; hemen yeniden denemeyin |

Sayılar yerine `RPCErrorCodes` enum'unu kullanın.

## SDK Olayları

| Olay | Açıklama |
|------|----------|
| `READY` | SDK bağlantısı kurulduğunda (sonradan abone olunursa hemen tetiklenir) |
| `ERROR` | Hata oluştuğunda |
| `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` | Katılımcılar değiştiğinde |
| `ACTIVITY_LAYOUT_MODE_UPDATE` | Layout modu değiştiğinde |
| `ORIENTATION_UPDATE` | Ekran yönü değiştiğinde |
| `CURRENT_USER_UPDATE` | Kullanıcı bilgileri güncellendiğinde (yük kullanıcı nesnesinin kendisi) |
| `THERMAL_STATE_UPDATE` | Cihaz ısı durumu değiştiğinde (`nominal` / `fair` / `serious` / `critical`) |
| `VISIBILITY_UPDATE` | Host aktiviteyi sökmeden gizlediğinde / yeniden gösterdiğinde (`{ hidden }`) |
| `SAFE_AREA_INSETS_UPDATE` | Safe-area boşlukları değiştiğinde (SDK CSS değişkenlerini kendisi günceller) |

Durum olaylarına (`ACTIVITY_LAYOUT_MODE_UPDATE`, `ORIENTATION_UPDATE`, `THERMAL_STATE_UPDATE`,
`CURRENT_USER_UPDATE`, `VISIBILITY_UPDATE`) abone olunduğunda host güncel değeri hemen gönderir
(Discord gibi); ilk değişikliği beklemeniz gerekmez.

## URL Parametreleri

Ciklet, aktivitenizi yüklerken iframe URL'sine şu parametreleri ekler:

| Parametre | Açıklama |
|-----------|----------|
| `instance_id` | Bu aktivite örneğinin benzersiz ID'si |
| `channel_id` | Aktivitenin çalıştığı kanalın ID'si |
| `location_id` | Konum ID'si (şu an `channel_id` ile aynı) |
| `guild_id` | Sunucu kanalında sunucu ID'si (DM'de eklenmez) |
| `frame_id` | iframe'in benzersiz ID'si |
| `platform` | Platform (`web`, `desktop` — Ciklet masaüstü uygulaması, `mobile`) |
| `launch_id` | Bu başlatmanın benzersiz ID'si |
| `custom_id` | Özel bağlantıdan (`/discover/<uygulama>?link=<id>`) açıldıysa bağlantının `customId`'si |
| `referrer_id` | Bağlantıyı / daveti paylaşan kullanıcının ID'si; yoksa eklenmez (kimlik kanıtı DEĞİLDİR) |

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
