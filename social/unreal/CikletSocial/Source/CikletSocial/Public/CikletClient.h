// Kullanıcı jetonuyla Ciklet REST'i: profil, arkadaşlar, etkinlik, lobiler, oyun istatistikleri.
#pragma once

#include "CoreMinimal.h"
#include "CikletAuth.h"
#include "CikletSocialTypes.h"

/**
 * `https://ciklet.xyz/api/v1` uçları. Jeton FCikletAuth'tan alınır, gerekirse yenilenir;
 * 401'de bir kez yenileyip tekrar dener. Her çağrı iptal edilebilir bir tutamaç döndürür;
 * geri çağırma oyun iş parçacığında bir kez gelir.
 */
class CIKLETSOCIAL_API FCikletClient : public TSharedFromThis<FCikletClient>
{
public:
	template <typename T>
	using TCallback = TFunction<void(const TCikletResult<T>&)>;

	static TSharedRef<FCikletClient> Create(const TSharedRef<FCikletAuth>& Auth);

	// ── Profil ve arkadaşlar ──
	/** `GET /users/@me` (`identify`). */
	FCikletOperation GetCurrentUser(TCallback<FCikletUser> OnComplete);
	/** `GET /users/@me/relationships` (`relationships.read`). */
	FCikletOperation GetRelationships(TCallback<TArray<FCikletRelationship>> OnComplete);
	/** Yalnızca arkadaşlar. */
	FCikletOperation GetFriends(TCallback<TArray<FCikletRelationship>> OnComplete);

	// ── Etkinlik (`activities.write`) — en geç 2 dakikada bir tazeleyin ──
	FCikletOperation UpdateActivity(const FCikletActivity& Activity, TCallback<FCikletEmpty> OnComplete);
	FCikletOperation ClearActivity(TCallback<FCikletEmpty> OnComplete);

	// ── Lobiler (`lobbies.write`) ──
	/** Sırla oluştur ya da katıl (`PUT /lobbies`). IdleTimeoutSeconds <= 0 → sunucu varsayılanı. */
	FCikletOperation CreateOrJoinLobby(const FString& Secret, const TMap<FString, FString>& LobbyMetadata, const TMap<FString, FString>& MemberMetadata, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete);
	FCikletOperation GetLobby(const FString& LobbyId, TCallback<FCikletLobby> OnComplete);
	FCikletOperation LeaveLobby(const FString& LobbyId, TCallback<FCikletEmpty> OnComplete);
	/** Limit <= 0 → sunucu varsayılanı; Before boşsa en yeniler. */
	FCikletOperation GetLobbyMessages(const FString& LobbyId, int32 Limit, const FString& Before, TCallback<TArray<FCikletLobbyMessage>> OnComplete);
	FCikletOperation SendLobbyMessage(const FString& LobbyId, const FString& Content, const TMap<FString, FString>& Metadata, TCallback<FCikletLobbyMessage> OnComplete);
	/** LiveKit bilgisi; sesi LiveKit Unreal SDK'sıyla `Url` + `Token` ile bağlayın. */
	FCikletOperation GetLobbyVoice(const FString& LobbyId, TCallback<FCikletLobbyVoice> OnComplete);
	/** ChannelId boşsa bağı çözer. */
	FCikletOperation LinkLobbyChannel(const FString& LobbyId, const FString& ChannelId, TCallback<FCikletLobby> OnComplete);

	// ── Oyun istatistikleri (`game_stats.write`) ──
	FCikletOperation GetGameStats(TCallback<FCikletGameStats> OnComplete, const FString& ApplicationId = TEXT("@me"));
	/** Kartın TAMAMINI değiştirir; null alan siler. */
	FCikletOperation PutGameStats(const TSharedRef<FJsonObject>& Stats, TCallback<FCikletGameStats> OnComplete, const FString& ApplicationId = TEXT("@me"));
	FCikletOperation DeleteGameStats(TCallback<FCikletEmpty> OnComplete, const FString& ApplicationId = TEXT("@me"));

	/** Sarmalanmamış uçlar için: `/api/v1` + Path. Body null ise gövdesiz. */
	FCikletOperation Request(const FString& Method, const FString& Path, const TSharedPtr<FJsonValue>& Body, TCallback<TSharedPtr<FJsonValue>> OnComplete);

private:
	explicit FCikletClient(const TSharedRef<FCikletAuth>& InAuth) : Auth(InAuth) {}

	void Send(const TSharedPtr<FCikletOperationState>& Op, const FString& Method, const FString& Path, const FString& Body, const FString& Token, bool bRetried, TCallback<TSharedPtr<FJsonValue>> OnComplete);

	TSharedRef<FCikletAuth> Auth;
	FString HeadlessToken;
};
