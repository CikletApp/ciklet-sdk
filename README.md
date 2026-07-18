# @ciklet/embedded-activities-sdk

Ciklet'te çalışan zengin, çok oyunculu deneyimler (aktiviteler) oluşturmanızı sağlayan SDK.

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

## Hızlı Başlangıç

```typescript
import { CikletSDK } from '@ciklet/embedded-activities-sdk';

const CLIENT_ID = 'sizin-client-id';
const sdk = new CikletSDK(CLIENT_ID);

async function setup() {
  // 1. READY olayını bekle
  await sdk.ready();

  // 2. OAuth izin diyaloğunu aç ve authorization code al
  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: ['identify'],
  });

  // 3. Kendi backend'inizde code → access_token değişimi yapın
  const response = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { access_token } = await response.json();

  // 4. Token ile kimlik doğrulama yapın
  const auth = await sdk.commands.authenticate({ access_token });
  console.log('Authenticated user:', auth.user);
}

setup();
```

## SDK Yöntemleri

### `ready()`
Ciklet istemcisinden READY olayı alınana kadar bekler.

```typescript
await sdk.ready();
```

### `commands.authorize(input)`
OAuth izin diyaloğunu açar ve authorization code döner.

```typescript
const { code } = await sdk.commands.authorize({
  client_id: 'YOUR_CLIENT_ID',
  response_type: 'code',
  scope: ['identify'],
});
```

### `commands.authenticate(input)`
Access token ile kimlik doğrulaması yapar.

```typescript
const auth = await sdk.commands.authenticate({
  access_token: 'YOUR_ACCESS_TOKEN',
});
```

### `commands.getChannel(input?)`
Aktivitenin çalıştığı kanal hakkında bilgi alır.

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
Kullanıcının rich presence'ını ayarlar.

```typescript
await sdk.commands.setActivity({
  activity: {
    state: 'Playing',
    details: 'In a game',
  },
});
```

### `commands.openExternalLink(input)`
Kullanıcının tarayıcısında harici bir link açar.

```typescript
await sdk.commands.openExternalLink({ url: 'https://example.com' });
```

### `commands.getPlatformBehaviors()`
Platform davranışlarını alır.

### `commands.setConfig(input)`
Aktivite yapılandırmasını ayarlar.

### `commands.captureLog(input)`
Hata ayıklama loglarını Ciklet istemcisine gönderir.

### `commands.userSettingsGetLocale()`
Kullanıcının dil ayarını alır.

### `subscribe(event, handler)`
Bir SDK olayına abone olur.

```typescript
sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', (data) => {
  console.log('Katılımcılar:', data.participants);
});
```

### `unsubscribe(event, handler?)`
Bir SDK olayı aboneliğini iptal eder.

### `close(code?, message?)`
Aktiviteyi kapatır.

```typescript
import { RPCCloseCodes } from '@ciklet/embedded-activities-sdk';
sdk.close(RPCCloseCodes.CLOSE_NORMAL, 'Aktiviteden çıkıldı');
```

## SDK Olayları

| Olay | Açıklama |
|------|----------|
| `READY` | SDK bağlantısı kurulduğunda |
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
| `location_id` | Konum ID'si |
| `frame_id` | iframe'in benzersiz ID'si |
| `platform` | Platform (`web`, `desktop`, `mobile`) |
| `launch_id` | Başlatma zamanı |
| `referrer_id` | Aktiviteyi başlatan kullanıcının ID'si |

## Backend Gereksinimler

Aktiviteniz, OAuth code → token değişimi için bir backend'e ihtiyaç duyar:

```typescript
// POST /api/token
app.post('/api/token', async (req, res) => {
  const { code } = req.body;
  
  // Ciklet API'den token al
  const response = await fetch('https://ciklet.xyz/api/internal/exchange-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  
  const data = await response.json();
  res.json({ access_token: data.token });
});
```

## Deployment

Aktivitenizi kendi sunucunuzda barındırın. Ciklet, aktivitenizi iframe olarak yükler.

1. Uygulamanızı build edin ve statik dosyaları serve edin
2. HTTPS kullanın (production'da zorunlu)
3. `X-Frame-Options` header'ını kaldırın veya `ALLOWALL` yapın
4. CORS ayarlarınızda Ciklet domain'ini izin verin

## Lisans

MIT
