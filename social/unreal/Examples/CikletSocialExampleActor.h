// Ciklet Social SDK — örnek aktör. Oyun modülünüze kopyalayın (ör. Source/MyGame/),
// MyGame.Build.cs'e "CikletSocial", "Json" bağımlılığını ekleyin ve aktörü sahneye koyun.
// MYGAME_API'yi kendi modül makronuzla değiştirin.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "CikletAuth.h"
#include "CikletClient.h"
#include "CikletGateway.h"
#include "CikletSocialExampleActor.generated.h"

UCLASS()
class MYGAME_API ACikletSocialExampleActor : public AActor
{
	GENERATED_BODY()

public:
	/** Geliştirici Portalı › OAuth2: PUBLIC istemci, redirect URI http://127.0.0.1/callback */
	UPROPERTY(EditAnywhere, Category = "Ciklet")
	FString ClientId = TEXT("cik_app_...");

	UPROPERTY(EditAnywhere, Category = "Ciklet")
	FString LobbySecret = TEXT("ornek-mac-1");

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	void AfterLogin();
	void JoinLobby();
	void RefreshPresence();

	TSharedPtr<FCikletAuth> Auth;
	TSharedPtr<FCikletClient> Client;
	TSharedPtr<FCikletGateway> Gateway;
	FCikletOperation LoginOp;
	FString LobbyId;
	FTimerHandle PresenceTimer;
};
