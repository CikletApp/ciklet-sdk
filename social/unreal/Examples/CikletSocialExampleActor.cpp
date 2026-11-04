#include "CikletSocialExampleActor.h"

#include "Dom/JsonObject.h"
#include "TimerManager.h"

void ACikletSocialExampleActor::BeginPlay()
{
	Super::BeginPlay();

	Auth = FCikletAuth::Create(ClientId, MakeShared<FCikletFileTokenStore>(ClientId));
	Client = FCikletClient::Create(Auth.ToSharedRef());
	Gateway = FCikletGateway::Create(Auth.ToSharedRef());

	Gateway->OnStateChanged.AddLambda([](ECikletGatewayState State)
	{
		UE_LOG(LogTemp, Log, TEXT("Ciklet ağ geçidi durumu: %d"), static_cast<int32>(State));
	});
	Gateway->OnError.AddLambda([](const FCikletError& Error)
	{
		UE_LOG(LogTemp, Warning, TEXT("Ciklet ağ geçidi: %s"), *Error.ToString());
	});
	Gateway->OnLobbyEvent.AddWeakLambda(this, [this](const FCikletLobbyEvent& Event)
	{
		if (Event.LobbyId != LobbyId) return;
		if (Event.Type == TEXT("LOBBY_MESSAGE_CREATE"))
		{
			UE_LOG(LogTemp, Log, TEXT("[lobi] %s: %s"), Event.Message.bHasAuthor ? *Event.Message.Author.Username : TEXT("sistem"), *Event.Message.Content);
		}
		else if (Event.Type == TEXT("LOBBY_MEMBER_ADD"))
		{
			UE_LOG(LogTemp, Log, TEXT("[lobi] katıldı: %s"), *Event.Member.Id);
		}
		else if (Event.Type == TEXT("LOBBY_DELETE"))
		{
			LobbyId.Reset();
		}
	});

	if (Auth->IsSignedIn())
	{
		AfterLogin();
		return;
	}

	const TArray<FString> Scopes = {TEXT("identify"), TEXT("relationships.read"), TEXT("activities.write"), TEXT("lobbies.write"), TEXT("game_stats.write")};
	LoginOp = Auth->LoginWithLoopback(Scopes, [WeakThis = TWeakObjectPtr<ACikletSocialExampleActor>(this)](const TCikletResult<FCikletTokens>& Result)
	{
		if (!WeakThis.IsValid()) return;
		if (!Result)
		{
			UE_LOG(LogTemp, Warning, TEXT("Ciklet girişi başarısız: %s"), *Result.Error.ToString());
			return;
		}
		WeakThis->AfterLogin();
	});
}

void ACikletSocialExampleActor::EndPlay(const EEndPlayReason::Type Reason)
{
	LoginOp.Cancel();
	GetWorldTimerManager().ClearTimer(PresenceTimer);
	if (Client.IsValid()) Client->ClearActivity([](const TCikletResult<FCikletEmpty>&) {});
	if (Gateway.IsValid()) Gateway->Disconnect();
	Super::EndPlay(Reason);
}

void ACikletSocialExampleActor::AfterLogin()
{
	Client->GetCurrentUser([](const TCikletResult<FCikletUser>& Me)
	{
		if (Me) UE_LOG(LogTemp, Log, TEXT("Ciklet: %s olarak giriş yapıldı"), *Me.Value.DisplayName());
	});
	Client->GetFriends([](const TCikletResult<TArray<FCikletRelationship>>& Friends)
	{
		if (Friends) UE_LOG(LogTemp, Log, TEXT("Ciklet: %d arkadaş"), Friends.Value.Num());
	});
	Gateway->Connect();
	JoinLobby();

	// Etkinlik oturumu 3 dk'da düşer: 2 dk'da bir tazele.
	RefreshPresence();
	GetWorldTimerManager().SetTimer(PresenceTimer, this, &ACikletSocialExampleActor::RefreshPresence, 120.f, true);
}

void ACikletSocialExampleActor::JoinLobby()
{
	TMap<FString, FString> MemberMetadata;
	MemberMetadata.Add(TEXT("hazir"), TEXT("0"));
	Client->CreateOrJoinLobby(LobbySecret, {}, MemberMetadata, 0, [WeakThis = TWeakObjectPtr<ACikletSocialExampleActor>(this)](const TCikletResult<FCikletLobby>& Lobby)
	{
		if (!WeakThis.IsValid() || !Lobby) return;
		WeakThis->LobbyId = Lobby.Value.Id;
		WeakThis->Client->SendLobbyMessage(Lobby.Value.Id, TEXT("selam!"), {}, [](const TCikletResult<FCikletLobbyMessage>&) {});
		WeakThis->Client->GetLobbyVoice(Lobby.Value.Id, [](const TCikletResult<FCikletLobbyVoice>& Voice)
		{
			// LiveKit Unreal SDK ile: Room->Connect(Voice.Value.Url, Voice.Value.Token)
			if (Voice) UE_LOG(LogTemp, Log, TEXT("Ses odası %s @ %s"), *Voice.Value.RoomName, *Voice.Value.Url);
		});

		const TSharedRef<FJsonObject> Stats = MakeShared<FJsonObject>();
		Stats->SetNumberField(TEXT("seviye"), 12);
		Stats->SetStringField(TEXT("lig"), TEXT("Elmas"));
		WeakThis->Client->PutGameStats(Stats, [](const TCikletResult<FCikletGameStats>& Result)
		{
			if (!Result) UE_LOG(LogTemp, Warning, TEXT("İstatistik yazılamadı: %s"), *Result.Error.ToString());
		});
	});
}

void ACikletSocialExampleActor::RefreshPresence()
{
	FCikletActivity Activity;
	Activity.Details = LobbyId.IsEmpty() ? TEXT("Ana menüde") : TEXT("Lobide");
	Activity.StartTimestamp = FDateTime::UtcNow().ToUnixTimestamp();
	Client->UpdateActivity(Activity, [](const TCikletResult<FCikletEmpty>& Result)
	{
		if (!Result) UE_LOG(LogTemp, Warning, TEXT("Etkinlik yazılamadı: %s"), *Result.Error.ToString());
	});
}
