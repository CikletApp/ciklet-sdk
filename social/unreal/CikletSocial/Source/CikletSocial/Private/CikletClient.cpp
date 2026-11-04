#include "CikletClient.h"

#include "CikletHttp.h"

// Unity build (UBT dosyaları birleştirir): anonim ad alanı yerine dosyaya özel ad.
namespace CikletClientDetail
{
	template <typename T>
	using TCallback = TFunction<void(const TCikletResult<T>&)>;

	/** JSON değerini nesneye çevirip modele eşler. */
	template <typename T>
	TCallback<TSharedPtr<FJsonValue>> MapObject(TCallback<T> OnComplete, TFunction<T(const TSharedPtr<FJsonObject>&)> Map)
	{
		return [OnComplete, Map](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
		{
			if (!Result)
			{
				OnComplete(TCikletResult<T>::Failure(Result.Error));
				return;
			}
			const TSharedPtr<FJsonObject>* Obj = nullptr;
			if (!Result.Value.IsValid() || !Result.Value->TryGetObject(Obj) || !Obj)
			{
				OnComplete(TCikletResult<T>::Failure(FCikletError(ECikletErrorKind::Protocol, TEXT("unexpected_response"), TEXT("Yanıt nesne değil."))));
				return;
			}
			OnComplete(TCikletResult<T>::Success(Map(*Obj)));
		};
	}

	template <typename T>
	TCallback<TSharedPtr<FJsonValue>> MapArray(TCallback<TArray<T>> OnComplete, TFunction<T(const TSharedPtr<FJsonObject>&)> Map)
	{
		return [OnComplete, Map](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
		{
			if (!Result)
			{
				OnComplete(TCikletResult<TArray<T>>::Failure(Result.Error));
				return;
			}
			TArray<T> Out;
			const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
			if (Result.Value.IsValid() && Result.Value->TryGetArray(Values) && Values)
			{
				for (const TSharedPtr<FJsonValue>& V : *Values)
				{
					const TSharedPtr<FJsonObject>* Obj = nullptr;
					if (V.IsValid() && V->TryGetObject(Obj) && Obj) Out.Add(Map(*Obj));
				}
			}
			OnComplete(TCikletResult<TArray<T>>::Success(MoveTemp(Out)));
		};
	}

	TCallback<TSharedPtr<FJsonValue>> MapEmpty(TCallback<FCikletEmpty> OnComplete)
	{
		return [OnComplete](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
		{
			if (Result) OnComplete(TCikletResult<FCikletEmpty>::Success(FCikletEmpty()));
			else OnComplete(TCikletResult<FCikletEmpty>::Failure(Result.Error));
		};
	}

	TSharedPtr<FJsonValue> ObjectValue(const TSharedRef<FJsonObject>& Obj)
	{
		return MakeShared<FJsonValueObject>(Obj);
	}

	FString GameStatsPath(const FString& ApplicationId)
	{
		return TEXT("/users/@me/applications/") + CikletHttp::Segment(ApplicationId) + TEXT("/game-stats");
	}
}
using namespace CikletClientDetail;

TSharedRef<FCikletClient> FCikletClient::Create(const TSharedRef<FCikletAuth>& InAuth)
{
	return MakeShareable(new FCikletClient(InAuth));
}

FCikletOperation FCikletClient::Request(const FString& Method, const FString& Path, const TSharedPtr<FJsonValue>& Body, TCallback<TSharedPtr<FJsonValue>> OnComplete)
{
	FCikletOperation Op = FCikletOperation::Make();
	const TSharedPtr<FCikletOperationState> State = Op.State;

	FString BodyText;
	if (Body.IsValid())
	{
		const TSharedPtr<FJsonObject>* Obj = nullptr;
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (Body->TryGetObject(Obj) && Obj) BodyText = CikletJson::Serialize(Obj->ToSharedRef());
		else if (Body->TryGetArray(Arr) && Arr) BodyText = CikletJson::Serialize(*Arr);
	}

	// Tek çıkış: bir kez bildir.
	TCallback<TSharedPtr<FJsonValue>> Once = [State, OnComplete](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
	{
		if (State->bDone) return;
		State->bDone = true;
		State->OnCancel = nullptr; // State ↔ Once döngüsünü kır
		OnComplete(Result);
	};
	// İptal, jeton yenilemesi sürerken bile hemen bildirilsin.
	State->OnCancel = [Once]()
	{
		Once(TCikletResult<TSharedPtr<FJsonValue>>::Failure(FCikletError(ECikletErrorKind::Cancelled, TEXT("cancelled"), TEXT("İşlem iptal edildi."))));
	};

	const TWeakPtr<FCikletClient> WeakThis = AsShared();
	Auth->GetAccessToken([WeakThis, State, Method, Path, BodyText, Once](const TCikletResult<FString>& Token)
	{
		if (State->bCancelled)
		{
			Once(TCikletResult<TSharedPtr<FJsonValue>>::Failure(FCikletError(ECikletErrorKind::Cancelled, TEXT("cancelled"), TEXT("İşlem iptal edildi."))));
			return;
		}
		if (!Token)
		{
			Once(TCikletResult<TSharedPtr<FJsonValue>>::Failure(Token.Error));
			return;
		}
		if (const TSharedPtr<FCikletClient> This = WeakThis.Pin()) This->Send(State, Method, Path, BodyText, Token.Value, false, Once);
	});
	return Op;
}

void FCikletClient::Send(const TSharedPtr<FCikletOperationState>& Op, const FString& Method, const FString& Path, const FString& Body, const FString& Token, bool bRetried, TCallback<TSharedPtr<FJsonValue>> OnComplete)
{
	const FCikletOptions& Options = Auth->GetOptions();
	TMap<FString, FString> Headers;
	Headers.Add(TEXT("Authorization"), TEXT("Bearer ") + Token);
	Headers.Add(TEXT("Accept"), TEXT("application/json"));
	Headers.Add(TEXT("User-Agent"), Options.UserAgent);

	const TWeakPtr<FCikletClient> WeakThis = AsShared();
	CikletHttp::Send(Op, Method, Options.Api(Path), Headers, Body, TEXT("application/json"), Options.RequestTimeoutSeconds,
		[WeakThis, Op, Method, Path, Body, bRetried, OnComplete](const FCikletHttpResponse* Response, const FCikletError* Error)
		{
			if (Error)
			{
				OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Failure(*Error));
				return;
			}
			const TSharedPtr<FCikletClient> This = WeakThis.Pin();
			if (Response->Status == 401 && !bRetried && This.IsValid())
			{
				// Jeton sunucuda düşmüş olabilir: bir kez yenile ve tekrar dene.
				This->Auth->Refresh([WeakThis, Op, Method, Path, Body, OnComplete](const TCikletResult<FCikletTokens>& Refreshed)
				{
					const TSharedPtr<FCikletClient> Inner = WeakThis.Pin();
					if (!Refreshed || !Inner.IsValid())
					{
						OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Failure(Refreshed ? FCikletError(ECikletErrorKind::Auth, TEXT("invalid_token"), TEXT("Jeton geçersiz.")) : Refreshed.Error));
						return;
					}
					Inner->Send(Op, Method, Path, Body, Refreshed.Value.AccessToken, true, OnComplete);
				});
				return;
			}
			TSharedPtr<FJsonValue> Value;
			FCikletError ParseError;
			if (!CikletHttp::ParseOrError(*Response, Value, ParseError))
			{
				OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Failure(ParseError));
				return;
			}
			OnComplete(TCikletResult<TSharedPtr<FJsonValue>>::Success(Value));
		});
}

// ── Profil ve arkadaşlar ──

FCikletOperation FCikletClient::GetCurrentUser(TCallback<FCikletUser> OnComplete)
{
	return Request(TEXT("GET"), TEXT("/users/@me"), nullptr, MapObject<FCikletUser>(OnComplete, &FCikletUser::FromJson));
}

FCikletOperation FCikletClient::GetRelationships(TCallback<TArray<FCikletRelationship>> OnComplete)
{
	return Request(TEXT("GET"), TEXT("/users/@me/relationships"), nullptr, MapArray<FCikletRelationship>(OnComplete, &FCikletRelationship::FromJson));
}

FCikletOperation FCikletClient::GetFriends(TCallback<TArray<FCikletRelationship>> OnComplete)
{
	return GetRelationships([OnComplete](const TCikletResult<TArray<FCikletRelationship>>& Result)
	{
		if (!Result)
		{
			OnComplete(Result);
			return;
		}
		TArray<FCikletRelationship> Friends = Result.Value.FilterByPredicate([](const FCikletRelationship& R) { return R.Type == ECikletRelationshipType::Friend; });
		OnComplete(TCikletResult<TArray<FCikletRelationship>>::Success(MoveTemp(Friends)));
	});
}

// ── Etkinlik ──

FCikletOperation FCikletClient::UpdateActivity(const FCikletActivity& Activity, TCallback<FCikletEmpty> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	TArray<TSharedPtr<FJsonValue>> Activities;
	Activities.Add(ObjectValue(Activity.ToJson()));
	Body->SetArrayField(TEXT("activities"), Activities);
	if (!HeadlessToken.IsEmpty()) Body->SetStringField(TEXT("token"), HeadlessToken);

	const TWeakPtr<FCikletClient> WeakThis = AsShared();
	const bool bHadToken = !HeadlessToken.IsEmpty();
	return Request(TEXT("POST"), TEXT("/users/@me/headless-sessions"), ObjectValue(Body),
		[WeakThis, Activity, bHadToken, OnComplete](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
		{
			const TSharedPtr<FCikletClient> This = WeakThis.Pin();
			if (!This.IsValid()) return;
			if (!Result && Result.Error.Status == 404 && bHadToken)
			{
				// Oturum süresi doldu — yenisini aç.
				This->HeadlessToken.Reset();
				This->UpdateActivity(Activity, OnComplete);
				return;
			}
			if (!Result)
			{
				OnComplete(TCikletResult<FCikletEmpty>::Failure(Result.Error));
				return;
			}
			const TSharedPtr<FJsonObject>* Obj = nullptr;
			if (Result.Value.IsValid() && Result.Value->TryGetObject(Obj) && Obj)
			{
				const FString Token = CikletJson::Str(*Obj, TEXT("token"));
				if (!Token.IsEmpty()) This->HeadlessToken = Token;
			}
			OnComplete(TCikletResult<FCikletEmpty>::Success(FCikletEmpty()));
		});
}

FCikletOperation FCikletClient::ClearActivity(TCallback<FCikletEmpty> OnComplete)
{
	if (HeadlessToken.IsEmpty())
	{
		OnComplete(TCikletResult<FCikletEmpty>::Success(FCikletEmpty()));
		return FCikletOperation();
	}
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("token"), HeadlessToken);
	HeadlessToken.Reset();
	return Request(TEXT("POST"), TEXT("/users/@me/headless-sessions/delete"), ObjectValue(Body),
		[OnComplete](const TCikletResult<TSharedPtr<FJsonValue>>& Result)
		{
			if (Result || Result.Error.Status == 404) OnComplete(TCikletResult<FCikletEmpty>::Success(FCikletEmpty()));
			else OnComplete(TCikletResult<FCikletEmpty>::Failure(Result.Error));
		});
}

// ── Lobiler ──

FCikletOperation FCikletClient::CreateOrJoinLobby(const FString& Secret, const TMap<FString, FString>& LobbyMetadata, const TMap<FString, FString>& MemberMetadata, int32 IdleTimeoutSeconds, TCallback<FCikletLobby> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("secret"), Secret);
	if (LobbyMetadata.Num() > 0) Body->SetObjectField(TEXT("lobby_metadata"), CikletJson::StringMap(LobbyMetadata));
	if (MemberMetadata.Num() > 0) Body->SetObjectField(TEXT("member_metadata"), CikletJson::StringMap(MemberMetadata));
	if (IdleTimeoutSeconds > 0) Body->SetNumberField(TEXT("idle_timeout_seconds"), IdleTimeoutSeconds);
	return Request(TEXT("PUT"), TEXT("/lobbies"), ObjectValue(Body), MapObject<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

FCikletOperation FCikletClient::GetLobby(const FString& LobbyId, TCallback<FCikletLobby> OnComplete)
{
	return Request(TEXT("GET"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId), nullptr, MapObject<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

FCikletOperation FCikletClient::LeaveLobby(const FString& LobbyId, TCallback<FCikletEmpty> OnComplete)
{
	return Request(TEXT("DELETE"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId) + TEXT("/members/@me"), nullptr, MapEmpty(OnComplete));
}

FCikletOperation FCikletClient::GetLobbyMessages(const FString& LobbyId, int32 Limit, const FString& Before, TCallback<TArray<FCikletLobbyMessage>> OnComplete)
{
	TArray<TPair<FString, FString>> Query;
	if (Limit > 0) Query.Add(TPair<FString, FString>(TEXT("limit"), FString::FromInt(Limit)));
	if (!Before.IsEmpty()) Query.Add(TPair<FString, FString>(TEXT("before"), Before));
	const FString Suffix = Query.Num() > 0 ? TEXT("?") + CikletHttp::FormEncode(Query) : FString();
	return Request(TEXT("GET"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId) + TEXT("/messages") + Suffix, nullptr,
		MapArray<FCikletLobbyMessage>(OnComplete, &FCikletLobbyMessage::FromJson));
}

FCikletOperation FCikletClient::SendLobbyMessage(const FString& LobbyId, const FString& Content, const TMap<FString, FString>& Metadata, TCallback<FCikletLobbyMessage> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetStringField(TEXT("content"), Content);
	if (Metadata.Num() > 0) Body->SetObjectField(TEXT("metadata"), CikletJson::StringMap(Metadata));
	return Request(TEXT("POST"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId) + TEXT("/messages"), ObjectValue(Body),
		MapObject<FCikletLobbyMessage>(OnComplete, &FCikletLobbyMessage::FromJson));
}

FCikletOperation FCikletClient::GetLobbyVoice(const FString& LobbyId, TCallback<FCikletLobbyVoice> OnComplete)
{
	return Request(TEXT("POST"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId) + TEXT("/voice"), nullptr,
		MapObject<FCikletLobbyVoice>(OnComplete, &FCikletLobbyVoice::FromJson));
}

FCikletOperation FCikletClient::LinkLobbyChannel(const FString& LobbyId, const FString& ChannelId, TCallback<FCikletLobby> OnComplete)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	if (!ChannelId.IsEmpty()) Body->SetStringField(TEXT("channel_id"), ChannelId);
	return Request(TEXT("PATCH"), TEXT("/lobbies/") + CikletHttp::Segment(LobbyId) + TEXT("/channel-linking"), ObjectValue(Body),
		MapObject<FCikletLobby>(OnComplete, &FCikletLobby::FromJson));
}

// ── Oyun istatistikleri ──

FCikletOperation FCikletClient::GetGameStats(TCallback<FCikletGameStats> OnComplete, const FString& ApplicationId)
{
	return Request(TEXT("GET"), GameStatsPath(ApplicationId), nullptr, MapObject<FCikletGameStats>(OnComplete, &FCikletGameStats::FromJson));
}

FCikletOperation FCikletClient::PutGameStats(const TSharedRef<FJsonObject>& Stats, TCallback<FCikletGameStats> OnComplete, const FString& ApplicationId)
{
	TSharedRef<FJsonObject> Body = MakeShared<FJsonObject>();
	Body->SetObjectField(TEXT("stats"), Stats);
	return Request(TEXT("PUT"), GameStatsPath(ApplicationId), ObjectValue(Body), MapObject<FCikletGameStats>(OnComplete, &FCikletGameStats::FromJson));
}

FCikletOperation FCikletClient::DeleteGameStats(TCallback<FCikletEmpty> OnComplete, const FString& ApplicationId)
{
	return Request(TEXT("DELETE"), GameStatsPath(ApplicationId), nullptr, MapEmpty(OnComplete));
}
