# Değişiklik Günlüğü

## 1.3.0

Discord Embedded App SDK uyumluluğu. Geriye uyumlu: yeni alanlar ve olaylar eski host'larda
yalnızca boş kalır.

- **Başlatma bağlamı:** `sdk.customId`, `sdk.referrerId`, `sdk.launchId`, `sdk.locationId`,
  `sdk.guildId` ve hepsini toplayan `sdk.launchContext`. Masaüstü uygulaması artık
  `platform: "desktop"` bildirir.
- **`setActivity`:** Discord şekli (`details`, `state`, `party.size`, `timestamps`, `assets`)
  ve `ActivityType`; host kullanıcının rich presence'ına yayınlar, aktivite kapanınca kaldırır.
- **`patchUrlMappings(mappings, config?)`:** `fetch` / `XMLHttpRequest` / `WebSocket` (isteğe
  bağlı `src`) adreslerini Ciklet aktivite vekiline (`/.proxy/<önek>`) çevirir. `attemptRemap`
  ve `matchAndRewriteURL` da dışa aktarılır.
- **Takma ad:** `commands.getActivityInstanceConnectedParticipants()`.
- **Olaylar:** `VISIBILITY_UPDATE` ve `SAFE_AREA_INSETS_UPDATE` enum'a ve tiplere eklendi.
  Host'lar durum olaylarına abone olunduğunda güncel değeri hemen gönderir.
- **Safe area:** `--ciklet-safe-area-inset-{top,right,bottom,left}` CSS değişkenleri SDK
  tarafından `<html>` üzerinde tutulur (varsayılan `0px`).
- **`CURRENT_USER_UPDATE`:** yük artık kullanıcı nesnesinin kendisi (Discord gibi); eski
  `user` alanı da gönderilir.
- `close(code, message)`: normal olmayan kodla kapatırken mesaj kullanıcıya gösterilir.
- Birim testleri (`npm test`, Node test koşucusu).

## 1.2.0

- `commands.openInviteDialog()` — "Arkadaşları Davet Et".

## 1.1.0

- `hostOrigin` seçeneği, `RPCError`, `commands.fetchExternal()` ve `RPCErrorCodes`.
