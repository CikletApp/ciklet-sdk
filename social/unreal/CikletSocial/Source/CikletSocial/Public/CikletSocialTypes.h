// Ciklet Social SDK — veri tipleri, hata ve sonuç türleri.
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Interfaces/IHttpRequest.h"

/** Ortak ayarlar. Varsayılanlar canlı Ciklet'i gösterir. */
struct CIKLETSOCIAL_API FCikletOptions
{
	FString BaseUrl = TEXT("https://ciklet.xyz");
	FString GatewayUrl = TEXT("wss://ciklet.xyz/gateway/ws");
	/** Tek bir REST isteğinin zaman aşımı (sn). */
	float RequestTimeoutSeconds = 15.f;
	FString UserAgent = TEXT("CikletSocialSDK-Unreal/0.1.0");

	FString Api(const FString& Path) const;
	FString Root(const FString& Path) const;
};

enum class ECikletErrorKind : uint8
{
	/** Sunucu 4xx/5xx döndü. */
	Http,
	/** Bağlantı kurulamadı (DNS, TLS…). */
	Network,
	Timeout,
	/** Yanıt beklenen biçimde değil. */
	Protocol,
	/** Giriş yok / yenilenemedi / kullanıcı reddetti — yeniden giriş gerekir. */
	Auth,
	/** İşlem Cancel() ile iptal edildi. */
	Cancelled,
};

struct CIKLETSOCIAL_API FCikletError
{
	ECikletErrorKind Kind = ECikletErrorKind::Network;
	/** HTTP durum kodu; HTTP dışı hatalarda 0. */
	int32 Status = 0;
	/** Sunucu kodu (`unknown_lobby`, `invalid_grant`, `insufficient_scope`…) ya da SDK kodu. */
	FString Code;
	FString Message;
	/** 429'da önerilen bekleme (sn); yoksa negatif. */
	float RetryAfterSeconds = -1.f;

	FCikletError() = default;
	FCikletError(ECikletErrorKind InKind, const FString& InCode, const FString& InMessage, int32 InStatus = 0)
		: Kind(InKind), Status(InStatus), Code(InCode), Message(InMessage)
	{
	}

	bool IsRetryable() const
	{
		return Kind == ECikletErrorKind::Network || Kind == ECikletErrorKind::Timeout ||
			   (Kind == ECikletErrorKind::Http && (Status == 429 || Status >= 500));
	}

	FString ToString() const;
};

/** Başarı ya da hata. `if (Result) { Result.Value… } else { Result.Error… }` */
template <typename T>
struct TCikletResult
{
	bool bOk = false;
	T Value{};
	FCikletError Error;

	static TCikletResult Success(T InValue)
	{
		TCikletResult R;
		R.bOk = true;
		R.Value = MoveTemp(InValue);
		return R;
	}

	static TCikletResult Failure(FCikletError InError)
	{
		TCikletResult R;
		R.Error = MoveTemp(InError);
		return R;
	}

	explicit operator bool() const { return bOk; }
};

/** Değeri olmayan işlemler (sil, ayrıl) için. */
struct FCikletEmpty
{
};

/**
 * Süren işlemin tutamacı. Cancel() çağrılırsa geri çağırma bir kez,
 * `ECikletErrorKind::Cancelled` ile gelir (zaten bitmişse hiçbir şey olmaz).
 */
class CIKLETSOCIAL_API FCikletOperationState
{
public:
	bool bCancelled = false;
	bool bDone = false;
	FHttpRequestPtr Current;
	TFunction<void()> OnCancel;

	void Cancel();
};

struct CIKLETSOCIAL_API FCikletOperation
{
	TSharedPtr<FCikletOperationState> State;

	void Cancel() const
	{
		if (State.IsValid()) State->Cancel();
	}

	bool IsDone() const { return !State.IsValid() || State->bDone; }

	static FCikletOperation Make()
	{
		FCikletOperation Op;
		Op.State = MakeShared<FCikletOperationState>();
		return Op;
	}
};

struct CIKLETSOCIAL_API FCikletUser
{
	FString Id;
	FString Username;
	FString GlobalName;
	FString Avatar;
	bool bBot = false;
	FString Email;

	FString DisplayName() const { return GlobalName.IsEmpty() ? Username : GlobalName; }
	static FCikletUser FromJson(const TSharedPtr<FJsonObject>& Json);
};

enum class ECikletRelationshipType : uint8
{
	None = 0,
	Friend = 1,
	Blocked = 2,
	IncomingRequest = 3,
	OutgoingRequest = 4,
};

struct CIKLETSOCIAL_API FCikletRelationship
{
	FString Id;
	ECikletRelationshipType Type = ECikletRelationshipType::None;
	FString Nickname;
	FCikletUser User;

	static FCikletRelationship FromJson(const TSharedPtr<FJsonObject>& Json);
};

enum class ECikletActivityType : uint8
{
	Playing = 0,
	Streaming = 1,
	Listening = 2,
	Watching = 3,
	Competing = 5,
};

/** Profilde görünen etkinlik (`activities.write`). Adı her zaman uygulamanızın adıdır. */
struct CIKLETSOCIAL_API FCikletActivity
{
	ECikletActivityType Type = ECikletActivityType::Playing;
	FString Details;
	FString State;
	/** Unix saniye; 0 = süre gösterilmez. */
	int64 StartTimestamp = 0;
	/** https görsel adresleri. */
	FString LargeImage;
	FString SmallImage;

	TSharedRef<FJsonObject> ToJson() const;
};

namespace ECikletLobbyMemberFlags
{
	enum Type : int32
	{
		None = 0,
		CanLinkLobby = 1,
	};
}

struct CIKLETSOCIAL_API FCikletLobbyMember
{
	FString Id;
	TMap<FString, FString> Metadata;
	int32 Flags = 0;

	static FCikletLobbyMember FromJson(const TSharedPtr<FJsonObject>& Json);
};

struct CIKLETSOCIAL_API FCikletLobby
{
	FString Id;
	FString ApplicationId;
	TMap<FString, FString> Metadata;
	TArray<FCikletLobbyMember> Members;
	int32 IdleTimeoutSeconds = 0;
	/** Bağlı kanal yoksa boş. */
	FString LinkedChannelId;
	FString LinkedChannelName;
	FString LinkedGuildId;

	static FCikletLobby FromJson(const TSharedPtr<FJsonObject>& Json);
};

struct CIKLETSOCIAL_API FCikletLobbyMessage
{
	FString Id;
	FString LobbyId;
	FString ChannelId;
	FString Content;
	/** Bot/sistem mesajında boş. */
	FCikletUser Author;
	bool bHasAuthor = false;
	TMap<FString, FString> Metadata;
	FString Timestamp;

	static FCikletLobbyMessage FromJson(const TSharedPtr<FJsonObject>& Json);
};

/** Lobi sesli sohbeti: LiveKit adresi + oda jetonu. Sesi LiveKit'in Unreal SDK'sıyla bağlayın. */
struct CIKLETSOCIAL_API FCikletLobbyVoice
{
	FString Token;
	FString Url;
	FString RoomName;
	FString Identity;

	static FCikletLobbyVoice FromJson(const TSharedPtr<FJsonObject>& Json);
};

/** Profil oyun istatistikleri: sayı, metin ya da ISO 8601 tarih (şemaya göre). */
struct CIKLETSOCIAL_API FCikletGameStats
{
	TSharedPtr<FJsonObject> Stats;
	FString UpdatedAt;

	static FCikletGameStats FromJson(const TSharedPtr<FJsonObject>& Json);
};

enum class ECikletGameStatType : uint8
{
	Number = 1,
	Text = 2,
	Date = 3,
};

struct CIKLETSOCIAL_API FCikletGameStatField
{
	FString Key;
	FString Name;
	ECikletGameStatType Type = ECikletGameStatType::Number;

	TSharedRef<FJsonObject> ToJson() const;
	static FCikletGameStatField FromJson(const TSharedPtr<FJsonObject>& Json);
};

/** Bot jetonlu lobi üyesi satırı. */
struct CIKLETSOCIAL_API FCikletLobbyMemberInput
{
	FString Id;
	TMap<FString, FString> Metadata;
	bool bHasMetadata = false;
	int32 Flags = -1; // -1: gönderme
	bool bRemoveMember = false;

	TSharedRef<FJsonObject> ToJson() const;
};

/** Ağ geçidinden gelen `lobby.*` olayı. */
struct CIKLETSOCIAL_API FCikletLobbyEvent
{
	/** LOBBY_CREATE, LOBBY_UPDATE, LOBBY_DELETE, LOBBY_MEMBER_ADD, LOBBY_MEMBER_UPDATE, LOBBY_MEMBER_REMOVE, LOBBY_MESSAGE_CREATE */
	FString Type;
	FString EventType;
	FString LobbyId;
	FCikletLobby Lobby;
	FCikletLobbyMember Member;
	FCikletLobbyMessage Message;
	TSharedPtr<FJsonObject> Raw;

	/** Lobi olayı değilse false. */
	static bool FromFrame(const TSharedPtr<FJsonObject>& Frame, FCikletLobbyEvent& Out);
};

struct CIKLETSOCIAL_API FCikletTokens
{
	FString AccessToken;
	/** ROTASYONLU: her yenilemede yenisi gelir, hemen saklanır. */
	FString RefreshToken;
	FDateTime ExpiresAtUtc;
	TArray<FString> Scopes;

	bool IsValid() const { return !AccessToken.IsEmpty(); }
	bool ExpiresWithin(FTimespan Window) const { return FDateTime::UtcNow() + Window >= ExpiresAtUtc; }
	bool HasScope(const FString& Scope) const { return Scopes.Contains(Scope); }

	FString ToJsonString() const;
	static bool FromJsonString(const FString& Json, FCikletTokens& Out);
	static bool FromTokenResponse(const TSharedPtr<FJsonObject>& Json, FCikletTokens& Out);
};

/** Jeton saklama. Üretimde işletim sisteminin güvenli deposunu tercih edin. */
class CIKLETSOCIAL_API ICikletTokenStore
{
public:
	virtual ~ICikletTokenStore() = default;
	virtual bool Load(FCikletTokens& Out) = 0;
	virtual void Save(const FCikletTokens& Tokens) = 0;
	virtual void Clear() = 0;
};

class CIKLETSOCIAL_API FCikletMemoryTokenStore : public ICikletTokenStore
{
public:
	virtual bool Load(FCikletTokens& Out) override;
	virtual void Save(const FCikletTokens& Tokens) override;
	virtual void Clear() override;

private:
	FCikletTokens Tokens;
};

/**
 * `Saved/Ciklet/<clientId>.json` dosyasına yazar. ŞİFRELİ DEĞİLDİR — yayında
 * Windows DPAPI / Keychain kullanan kendi deponuzu yazın.
 */
class CIKLETSOCIAL_API FCikletFileTokenStore : public ICikletTokenStore
{
public:
	explicit FCikletFileTokenStore(const FString& ClientId);
	virtual bool Load(FCikletTokens& Out) override;
	virtual void Save(const FCikletTokens& Tokens) override;
	virtual void Clear() override;

private:
	FString Path;
};

/** JSON yardımcıları (SDK içi ve sarmalanmamış uçlar için). */
namespace CikletJson
{
	CIKLETSOCIAL_API FString Serialize(const TSharedRef<FJsonObject>& Object);
	CIKLETSOCIAL_API FString Serialize(const TArray<TSharedPtr<FJsonValue>>& Array);
	CIKLETSOCIAL_API TSharedPtr<FJsonValue> Parse(const FString& Text);
	CIKLETSOCIAL_API TSharedRef<FJsonObject> StringMap(const TMap<FString, FString>& Map);
	CIKLETSOCIAL_API TMap<FString, FString> ReadStringMap(const TSharedPtr<FJsonObject>& Json, const FString& Field);
	CIKLETSOCIAL_API FString Str(const TSharedPtr<FJsonObject>& Json, const FString& Field);
	CIKLETSOCIAL_API TSharedPtr<FJsonObject> Obj(const TSharedPtr<FJsonObject>& Json, const FString& Field);
}
