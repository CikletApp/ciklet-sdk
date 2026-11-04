#include "CikletBotClient.h"

#include "CikletHttp.h"

// Unity build (UBT dosyaları birleştirir): anonim ad alanı yerine dosyaya özel ad.
namespace CikletBotDetail
{
	template <typename T>
	using TCallback = TFunction<void(const TCikletResult<T>&)>;

	template <typename T>
	TCallback<TSharedPtr<FJsonValue>> Obj(TCallback<T> OnComplete, TFunction<T(const TSharedPtr<FJsonObject>&)> Map)
	{
		return [OnComplete, Map](const TCikletResult<TSharedPtr<FJsonValue>>& R)
		{
			const TSharedPtr<FJsonObject>* O = nullptr;
			if (!R) OnComplete(TCikletResult<T>::Failure(R.Error));
			else if (R.Value.IsValid() && R.Value->TryGetObject(O) && O) OnComplete(TCikletResult<T>::Success(Map(*O)));
			else OnComplete(TCikletResult<T>::Failure(FCikletError(ECikletErrorKind::Protocol, TEXT("unexpected_response"), TEXT("Yanıt nesne değil."))));
		};
	}

	template <typename T>
	TCallback<TSharedPtr<FJsonValue>> Arr(TCallback<TArray<T>> OnComplete, TFunction<T(const TSharedPtr<FJsonObject>&)> Map)
	{
		return [OnComplete, Map](const TCikletResult<TSharedPtr<FJsonValue>>& R)
		{
			if (!R)
			{
				OnComplete(TCikletResult<TArray<T>>::Failure(R.Error));
				return;
			}
			TArray<T> Out;
			const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
			if (R.Value.IsValid() && R.Value->TryGetArray(Values) && Values)
			{
				for (const TSharedPtr<FJsonValue>& V : *Values)
				{
					const TSharedPtr<FJsonObject>* O = nullptr;
					if (V.IsValid() && V->TryGetObject(O) && O) Out.Add(Map(*O));
				}
			}
			OnComplete(TCikletResult<TArray<T>>::Success(MoveTemp(Out)));
		};
	}

	TCallback<TSharedPtr<FJsonValue>> Empty(TCallback<FCikletEmpty> OnComplete)
	{
		return [OnComplete](const TCikletResult<TSharedPtr<FJsonValue>>& R)
		{
			if (R) OnComplete(TCikletResult<FCikletEmpty>::Success(FCikletEmpty()));
			else OnComplete(TCikletResult<FCikletEmpty>::Failure(R.Error));
		};
	}

	TSharedPtr<FJsonValue> Val(const TSharedRef<FJsonObject>& O) { return MakeShared<FJsonValueObject>(O); }

	TArray<TSharedPtr<FJsonValue>> MemberArray(const TArray<FCikletLobbyMemberInput>& Members)
	{
		TArray<TSharedPtr<FJsonValue>> Out;
		for (const FCikletLobbyMemberInput& M : Members) Out.Add(Val(M.ToJson()));
		return Out;
	}

	FString LobbyPath(const FString& LobbyId) { return TEXT("/lobbies/") + CikletHttp::Segment(LobbyId); }
	FString UserStatsPath(const FString& UserId) { return TEXT("/bot/applications/@me/users/") + CikletHttp::Segment(UserId) + TEXT("/game-stats"); }
}
using namespace CikletBotDetail;

TSharedRef<FCikletBotClient> FCikletBotClient::Create(const FString& BotToken, const FCikletOptions& Options)
{
	FString Clean = BotToken;
	Clean.RemoveFromStart(TEXT("Bot "));
	return MakeShareable(new FCikletBotClient(Clean, Options));
}

FCikletOperation FCikletBotClient::Request(const FString& Method, const FString& Path, const TSharedPtr<FJsonValue>& Body, TCallback<TSharedPtr<FJsonValue>> OnComplete)
{
	FCikletOperation Op = FCikletOperation::Make();
	const TSharedPtr<FCikletOperationState> State = Op.State;

	FString BodyText;
	if (Body.IsValid())
	{
		const TSharedPtr<FJsonObject>* O = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (Body->TryGetObject(O) && O) BodyText = CikletJson::Serialize(O->ToSharedRef());
		else if (Body->TryGetArray(A) && A) BodyText = CikletJson::Serialize(*A);
	}

	TMap<FString, FString> Headers;
	Headers.Add(TEXT("Authorization"), TEXT("Bot ") + Token);
	Headers.Add(TEXT("Accept"), TEXT("application/json"));
	Headers.Add(TEXT("User-Agent"), Options.UserAgent);
	CikletHttp::Send(State, Method, Options.Api(Path), Headers, BodyText, TEXT("application/json"), Options.RequestTimeoutSeconds,
		[State, OnComplete](const FCikletHttpResponse* Response, const FCikletError* Error)
		{
			if (State->bDone) return;
			State->bDone = true;
			if (Error)
			{
				OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Failure(*Error));
				return;
			}
			TSharedPtr<FJsonValue> Value;
			FCikletError ParseError;
			if (CikletHttp::ParseOrError(*Response, Value, ParseError)) OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Success(Value));
			else OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Failure(ParseError));
		});
	return Op;
}

FCikletOperation FCikletBotClient::CreateLobby(const TMap<FString, FString>& Metadata, const TArray<FCikletLobbyMemberInput>& Members, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	if (Metadata.Num() > 0) Body->SetObjectField(TEXT("metadata"), CikletJson::StringMap(Metadata));
	if (Members.Num() > 0) Body->SetArrayField(TEXT("members"), MemberArray(Members));
	if (IdleTimeoutSeconds > 0) Body->SetNumberField(TEXT("idle_timeout_seconds"), IdleTimeoutSeconds);
	return Request(TEXT("POST"), TEXT("/lobbies"), Val(Body), Obj<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

FCikletOperation FCikletBotClient::GetLobby(const FString& LobbyId, TCallback<FCikletLobby> OnComplete)
{
	return Request(TEXT("GET"), LobbyPath(LobbyId), nullptr, Obj<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

FCikletOperation FCikletBotClient::UpdateLobby(const FString& LobbyId, const TMap<FString, FString>& Metadata, const TArray<FCikletLobbyMemberInput>& Members, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	if (Metadata.Num() > 0) Body->SetObjectField(TEXT("metadata"), CikletJson::StringMap(Metadata));
	if (Members.Num() > 0) Body->SetArrayField(TEXT("members"), MemberArray(Members));
	if (IdleTimeoutSeconds > 0) Body->SetNumberField(TEXT("idle_timeout_seconds"), IdleTimeoutSeconds);
	return Request(TEXT("PATCH"), LobbyPath(LobbyId), Val(Body), Obj<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

FCikletOperation FCikletBotClient::DeleteLobby(const FString& LobbyId, TCallback<FCikletEmpty> OnComplete)
{
	return Request(TEXT("DELETE"), LobbyPath(LobbyId), nullptr, Empty(OnComplete));
}

FCikletOperation FCikletBotClient::AddOrUpdateLobbyMember(const FString& LobbyId, const FCikletLobbyMemberInput& Member, TCallback<FCikletLobbyMember> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	if (Member.bHasMetadata) Body->SetObjectField(TEXT("metadata"), CikletJson::StringMap(Member.Metadata));
	if (Member.Flags >= 0) Body->SetNumberField(TEXT("flags"), Member.Flags);
	return Request(TEXT("PUT"), LobbyPath(LobbyId) + TEXT("/members/") + CikletHttp::Segment(Member.Id), Val(Body),
		Obj<FCikletLobbyMember>(OnComplete, &FCikletLobbyMember::FromJson));
}

FCikletOperation FCikletBotClient::RemoveLobbyMember(const FString& LobbyId, const FString& UserId, TCallback<FCikletEmpty> OnComplete)
{
	return Request(TEXT("DELETE"), LobbyPath(LobbyId) + TEXT("/members/") + CikletHttp::Segment(UserId), nullptr, Empty(OnComplete));
}

FCikletOperation FCikletBotClient::BulkUpdateLobbyMembers(const FString& LobbyId, const TArray<FCikletLobbyMemberInput>& Rows, TCallback<TArray<FCikletLobbyMember>> OnComplete)
{
	if (Rows.Num() < 1 || Rows.Num() > 25)
	{
		OnComplete(TCikletResult<TArray<FCikletLobbyMember>>::Failure(FCikletError(ECikletErrorKind::Protocol, TEXT("invalid_argument"), TEXT("1-25 satır olmalı."))));
		return FCikletOperation();
	}
	return Request(TEXT("POST"), LobbyPath(LobbyId) + TEXT("/members/bulk"), MakeShared<FJsonValueArray>(MemberArray(Rows)),
		Arr<FCikletLobbyMember>(OnComplete, &FCikletLobbyMember::FromJson));
}

FCikletOperation FCikletBotClient::SendLobbyMessage(const FString& LobbyId, const FString& Content, TCallback<FCikletLobbyMessage> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("content"), Content);
	return Request(TEXT("POST"), LobbyPath(LobbyId) + TEXT("/messages"), Val(Body), Obj<FCikletLobbyMessage>(OnComplete, &FCikletLobbyMessage::FromJson));
}

FCikletOperation FCikletBotClient::GetGameStatsSchema(TCallback<TArray<FCikletGameStatField>> OnComplete)
{
	return Request(TEXT("GET"), TEXT("/bot/applications/@me/game-stats/schema"), nullptr, Arr<FCikletGameStatField>(OnComplete, &FCikletGameStatField::FromJson));
}

FCikletOperation FCikletBotClient::PutGameStatsSchema(const TArray<FCikletGameStatField>& Fields, TCallback<TArray<FCikletGameStatField>> OnComplete)
{
	TArray<TSharedPtr<FJsonValue>> Values;
	for (const FCikletGameStatField& F : Fields) Values.Add(Val(F.ToJson()));
	return Request(TEXT("PUT"), TEXT("/bot/applications/@me/game-stats/schema"), MakeShared<FJsonValueArray>(Values),
		Arr<FCikletGameStatField>(OnComplete, &FCikletGameStatField::FromJson));
}

FCikletOperation FCikletBotClient::PutUserGameStats(const FString& UserId, const TSharedRef<FJsonObject>& Stats, TCallback<FCikletGameStats> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetObjectField(TEXT("stats"), Stats);
	return Request(TEXT("PUT"), UserStatsPath(UserId), Val(Body), Obj<FCikletGameStats>(OnComplete, &FCikletGameStats::FromJson));
}

FCikletOperation FCikletBotClient::DeleteUserGameStats(const FString& UserId, TCallback<FCikletEmpty> OnComplete)
{
	return Request(TEXT("DELETE"), UserStatsPath(UserId), nullptr, Empty(OnComplete));
}
