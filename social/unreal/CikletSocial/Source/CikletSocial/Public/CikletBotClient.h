// OYUN SUNUCUSU İÇİN — bot jetonuyla lobi yönetimi ve oyuncu adına oyun istatistiği.
#pragma once

#include "CoreMinimal.h"
#include "CikletSocialTypes.h"

/**
 * `Authorization: Bot cikbot_…` ile çağırır.
 *
 * UYARI: Bot jetonu GİZLİDİR. Oyun istemcisine (paketlenmiş oyun, .ini, pak dosyası)
 * ASLA koymayın — istemciden çıkarılabilir ve botunuzun tüm yetkilerini verir. Yalnızca
 * adanmış sunucuda (`UE_SERVER`) ve jetonu ortam değişkeninden okuyarak kullanın:
 *   FPlatformMisc::GetEnvironmentVariable(TEXT("CIKLET_BOT_TOKEN"))
 */
class CIKLETSOCIAL_API FCikletBotClient : public TSharedFromThis<FCikletBotClient>
{
public:
	template <typename T>
	using TCallback = TFunction<void(const TCikletResult<T>&)>;

	static TSharedRef<FCikletBotClient> Create(const FString& BotToken, const FCikletOptions& Options = FCikletOptions());

	// ── Lobiler ──
	FCikletOperation CreateLobby(const TMap<FString, FString>& Metadata, const TArray<FCikletLobbyMemberInput>& Members, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete);
	FCikletOperation GetLobby(const FString& LobbyId, TCallback<FCikletLobby> OnComplete);
	/** Members boş değilse üye listesinin TAMAMI değişir. */
	FCikletOperation UpdateLobby(const FString& LobbyId, const TMap<FString, FString>& Metadata, const TArray<FCikletLobbyMemberInput>& Members, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete);
	FCikletOperation DeleteLobby(const FString& LobbyId, TCallback<FCikletEmpty> OnComplete);
	FCikletOperation AddOrUpdateLobbyMember(const FString& LobbyId, const FCikletLobbyMemberInput& Member, TCallback<FCikletLobbyMember> OnComplete);
	FCikletOperation RemoveLobbyMember(const FString& LobbyId, const FString& UserId, TCallback<FCikletEmpty> OnComplete);
	/** 1-25 satır; bRemoveMember çıkarır. */
	FCikletOperation BulkUpdateLobbyMembers(const FString& LobbyId, const TArray<FCikletLobbyMemberInput>& Rows, TCallback<TArray<FCikletLobbyMember>> OnComplete);
	FCikletOperation SendLobbyMessage(const FString& LobbyId, const FString& Content, TCallback<FCikletLobbyMessage> OnComplete);

	// ── Oyun istatistikleri ──
	FCikletOperation GetGameStatsSchema(TCallback<TArray<FCikletGameStatField>> OnComplete);
	FCikletOperation PutGameStatsSchema(const TArray<FCikletGameStatField>& Fields, TCallback<TArray<FCikletGameStatField>> OnComplete);
	/** Oyuncu `game_stats.write` onaylamış olmalı (yoksa 404 unknown_user). */
	FCikletOperation PutUserGameStats(const FString& UserId, const TSharedRef<FJsonObject>& Stats, TCallback<FCikletGameStats> OnComplete);
	FCikletOperation DeleteUserGameStats(const FString& UserId, TCallback<FCikletEmpty> OnComplete);

	/** Sarmalanmamış bot uçları için: `/api/v1` + Path. */
	FCikletOperation Request(const FString& Method, const FString& Path, const TSharedPtr<FJsonValue>& Body, TCallback<TSharedPtr<FJsonValue>> OnComplete);

private:
	FCikletBotClient(const FString& InToken, const FCikletOptions& InOptions) : Token(InToken), Options(InOptions) {}

	FString Token;
	FCikletOptions Options;
};
