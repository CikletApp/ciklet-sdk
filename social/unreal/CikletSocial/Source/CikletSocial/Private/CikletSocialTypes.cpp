#include "CikletSocialTypes.h"

#include "HAL/PlatformFileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

FString FCikletOptions::Api(const FString& Path) const
{
	FString Base = BaseUrl;
	Base.RemoveFromEnd(TEXT("/"));
	return Base + TEXT("/api/v1") + Path;
}

FString FCikletOptions::Root(const FString& Path) const
{
	FString Base = BaseUrl;
	Base.RemoveFromEnd(TEXT("/"));
	return Base + Path;
}

FString FCikletError::ToString() const
{
	return FString::Printf(TEXT("CikletError(%d, %d, %s): %s"), static_cast<int32>(Kind), Status, *Code, *Message);
}

void FCikletOperationState::Cancel()
{
	if (bDone || bCancelled) return;
	bCancelled = true;
	if (Current.IsValid()) Current->CancelRequest();
	if (OnCancel)
	{
		TFunction<void()> Callback = MoveTemp(OnCancel);
		OnCancel = nullptr;
		Callback();
	}
}

// ── JSON ──

namespace CikletJson
{
	FString Serialize(const TSharedRef<FJsonObject>& Object)
	{
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Object, Writer);
		return Out;
	}

	FString Serialize(const TArray<TSharedPtr<FJsonValue>>& Array)
	{
		FString Out;
		const TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer = TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Array, Writer);
		return Out;
	}

	TSharedPtr<FJsonValue> Parse(const FString& Text)
	{
		TSharedPtr<FJsonValue> Value;
		const TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Text);
		if (!FJsonSerializer::Deserialize(Reader, Value)) return nullptr;
		return Value;
	}

	TSharedRef<FJsonObject> StringMap(const TMap<FString, FString>& Map)
	{
		TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
		for (const TPair<FString, FString>& Pair : Map) Obj->SetStringField(Pair.Key, Pair.Value);
		return Obj;
	}

	TMap<FString, FString> ReadStringMap(const TSharedPtr<FJsonObject>& Json, const FString& Field)
	{
		TMap<FString, FString> Out;
		const TSharedPtr<FJsonObject> Obj = CikletJson::Obj(Json, Field);
		if (!Obj.IsValid()) return Out;
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : Obj->Values)
		{
			FString Value;
			if (Pair.Value.IsValid() && Pair.Value->Type == EJson::String && Pair.Value->TryGetString(Value)) Out.Add(Pair.Key, Value);
		}
		return Out;
	}

	FString Str(const TSharedPtr<FJsonObject>& Json, const FString& Field)
	{
		FString Out;
		if (Json.IsValid() && Json->HasTypedField<EJson::String>(Field)) Out = Json->GetStringField(Field);
		return Out;
	}

	TSharedPtr<FJsonObject> Obj(const TSharedPtr<FJsonObject>& Json, const FString& Field)
	{
		const TSharedPtr<FJsonObject>* Out = nullptr;
		if (Json.IsValid() && Json->TryGetObjectField(Field, Out) && Out) return *Out;
		return nullptr;
	}
}

// Unity build (UBT dosyaları birleştirir): anonim ad alanı yerine dosyaya özel ad.
namespace CikletTypesDetail
{
	int64 IntField(const TSharedPtr<FJsonObject>& Json, const FString& Field, int64 Fallback = 0)
	{
		double Number = 0;
		if (Json.IsValid() && Json->TryGetNumberField(Field, Number)) return static_cast<int64>(Number);
		return Fallback;
	}

	bool BoolField(const TSharedPtr<FJsonObject>& Json, const FString& Field)
	{
		bool Value = false;
		return Json.IsValid() && Json->TryGetBoolField(Field, Value) && Value;
	}

	TArray<TSharedPtr<FJsonObject>> ObjectArray(const TSharedPtr<FJsonObject>& Json, const FString& Field)
	{
		TArray<TSharedPtr<FJsonObject>> Out;
		const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
		if (!Json.IsValid() || !Json->TryGetArrayField(Field, Values) || !Values) return Out;
		for (const TSharedPtr<FJsonValue>& V : *Values)
		{
			const TSharedPtr<FJsonObject>* Obj = nullptr;
			if (V.IsValid() && V->TryGetObject(Obj) && Obj) Out.Add(*Obj);
		}
		return Out;
	}
}
using namespace CikletTypesDetail;

// ── Modeller ──

FCikletUser FCikletUser::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletUser U;
	U.Id = CikletJson::Str(Json, TEXT("id"));
	U.Username = CikletJson::Str(Json, TEXT("username"));
	U.GlobalName = CikletJson::Str(Json, TEXT("global_name"));
	U.Avatar = CikletJson::Str(Json, TEXT("avatar"));
	U.bBot = BoolField(Json, TEXT("bot"));
	U.Email = CikletJson::Str(Json, TEXT("email"));
	return U;
}

FCikletRelationship FCikletRelationship::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletRelationship R;
	R.Id = CikletJson::Str(Json, TEXT("id"));
	R.Type = static_cast<ECikletRelationshipType>(IntField(Json, TEXT("type")));
	R.Nickname = CikletJson::Str(Json, TEXT("nickname"));
	R.User = FCikletUser::FromJson(CikletJson::Obj(Json, TEXT("user")));
	return R;
}

TSharedRef<FJsonObject> FCikletActivity::ToJson() const
{
	TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
	Obj->SetNumberField(TEXT("type"), static_cast<int32>(Type));
	if (!Details.IsEmpty()) Obj->SetStringField(TEXT("details"), Details);
	if (!State.IsEmpty()) Obj->SetStringField(TEXT("state"), State);
	if (StartTimestamp > 0)
	{
		TSharedRef<FJsonObject> Ts = MakeShared<FJsonObject>();
		Ts->SetNumberField(TEXT("start"), static_cast<double>(StartTimestamp));
		Obj->SetObjectField(TEXT("timestamps"), Ts);
	}
	if (!LargeImage.IsEmpty() || !SmallImage.IsEmpty())
	{
		TSharedRef<FJsonObject> Assets = MakeShared<FJsonObject>();
		if (!LargeImage.IsEmpty()) Assets->SetStringField(TEXT("large_image"), LargeImage);
		if (!SmallImage.IsEmpty()) Assets->SetStringField(TEXT("small_image"), SmallImage);
		Obj->SetObjectField(TEXT("assets"), Assets);
	}
	return Obj;
}

FCikletLobbyMember FCikletLobbyMember::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletLobbyMember M;
	M.Id = CikletJson::Str(Json, TEXT("id"));
	M.Metadata = CikletJson::ReadStringMap(Json, TEXT("metadata"));
	M.Flags = static_cast<int32>(IntField(Json, TEXT("flags")));
	return M;
}

FCikletLobby FCikletLobby::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletLobby L;
	L.Id = CikletJson::Str(Json, TEXT("id"));
	L.ApplicationId = CikletJson::Str(Json, TEXT("application_id"));
	L.Metadata = CikletJson::ReadStringMap(Json, TEXT("metadata"));
	for (const TSharedPtr<FJsonObject>& M : ObjectArray(Json, TEXT("members"))) L.Members.Add(FCikletLobbyMember::FromJson(M));
	L.IdleTimeoutSeconds = static_cast<int32>(IntField(Json, TEXT("idle_timeout_seconds")));
	const TSharedPtr<FJsonObject> Linked = CikletJson::Obj(Json, TEXT("linked_channel"));
	if (Linked.IsValid())
	{
		L.LinkedChannelId = CikletJson::Str(Linked, TEXT("id"));
		L.LinkedChannelName = CikletJson::Str(Linked, TEXT("name"));
		L.LinkedGuildId = CikletJson::Str(Linked, TEXT("guild_id"));
	}
	return L;
}

FCikletLobbyMessage FCikletLobbyMessage::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletLobbyMessage M;
	M.Id = CikletJson::Str(Json, TEXT("id"));
	M.LobbyId = CikletJson::Str(Json, TEXT("lobby_id"));
	M.ChannelId = CikletJson::Str(Json, TEXT("channel_id"));
	M.Content = CikletJson::Str(Json, TEXT("content"));
	const TSharedPtr<FJsonObject> Author = CikletJson::Obj(Json, TEXT("author"));
	M.bHasAuthor = Author.IsValid();
	if (M.bHasAuthor) M.Author = FCikletUser::FromJson(Author);
	M.Metadata = CikletJson::ReadStringMap(Json, TEXT("metadata"));
	M.Timestamp = CikletJson::Str(Json, TEXT("timestamp"));
	return M;
}

FCikletLobbyVoice FCikletLobbyVoice::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletLobbyVoice V;
	V.Token = CikletJson::Str(Json, TEXT("token"));
	V.Url = CikletJson::Str(Json, TEXT("url"));
	V.RoomName = CikletJson::Str(Json, TEXT("room_name"));
	V.Identity = CikletJson::Str(Json, TEXT("identity"));
	return V;
}

FCikletGameStats FCikletGameStats::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletGameStats S;
	S.Stats = CikletJson::Obj(Json, TEXT("stats"));
	if (!S.Stats.IsValid()) S.Stats = MakeShared<FJsonObject>();
	S.UpdatedAt = CikletJson::Str(Json, TEXT("updated_at"));
	return S;
}

TSharedRef<FJsonObject> FCikletGameStatField::ToJson() const
{
	TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
	Obj->SetStringField(TEXT("key"), Key);
	Obj->SetStringField(TEXT("name"), Name);
	Obj->SetNumberField(TEXT("type"), static_cast<int32>(Type));
	return Obj;
}

FCikletGameStatField FCikletGameStatField::FromJson(const TSharedPtr<FJsonObject>& Json)
{
	FCikletGameStatField F;
	F.Key = CikletJson::Str(Json, TEXT("key"));
	F.Name = CikletJson::Str(Json, TEXT("name"));
	F.Type = static_cast<ECikletGameStatType>(IntField(Json, TEXT("type"), 1));
	return F;
}

TSharedRef<FJsonObject> FCikletLobbyMemberInput::ToJson() const
{
	TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
	Obj->SetStringField(TEXT("id"), Id);
	if (bHasMetadata) Obj->SetObjectField(TEXT("metadata"), CikletJson::StringMap(Metadata));
	if (Flags >= 0) Obj->SetNumberField(TEXT("flags"), Flags);
	if (bRemoveMember) Obj->SetBoolField(TEXT("remove_member"), true);
	return Obj;
}

bool FCikletLobbyEvent::FromFrame(const TSharedPtr<FJsonObject>& Frame, FCikletLobbyEvent& Out)
{
	const FString EventType = CikletJson::Str(Frame, TEXT("eventType"));
	if (!EventType.StartsWith(TEXT("lobby."))) return false;
	const TSharedPtr<FJsonObject> D = CikletJson::Obj(Frame, TEXT("d"));
	Out = FCikletLobbyEvent();
	Out.EventType = EventType;
	Out.Type = CikletJson::Str(Frame, TEXT("t"));
	if (Out.Type.IsEmpty()) Out.Type = EventType.Replace(TEXT("."), TEXT("_")).ToUpper();
	Out.Raw = Frame;
	if (Out.Type == TEXT("LOBBY_CREATE") || Out.Type == TEXT("LOBBY_UPDATE"))
	{
		Out.Lobby = FCikletLobby::FromJson(D);
		Out.LobbyId = Out.Lobby.Id;
	}
	else if (Out.Type == TEXT("LOBBY_DELETE"))
	{
		Out.LobbyId = CikletJson::Str(D, TEXT("id"));
	}
	else if (Out.Type.StartsWith(TEXT("LOBBY_MEMBER_")))
	{
		Out.LobbyId = CikletJson::Str(D, TEXT("lobby_id"));
		Out.Member = FCikletLobbyMember::FromJson(CikletJson::Obj(D, TEXT("member")));
	}
	else if (Out.Type == TEXT("LOBBY_MESSAGE_CREATE"))
	{
		Out.Message = FCikletLobbyMessage::FromJson(D);
		Out.LobbyId = Out.Message.LobbyId;
	}
	return true;
}

// ── Jetonlar ──

FString FCikletTokens::ToJsonString() const
{
	TSharedRef<FJsonObject> Obj = MakeShared<FJsonObject>();
	Obj->SetStringField(TEXT("access_token"), AccessToken);
	Obj->SetStringField(TEXT("refresh_token"), RefreshToken);
	Obj->SetNumberField(TEXT("expires_at"), static_cast<double>(ExpiresAtUtc.ToUnixTimestamp()));
	Obj->SetStringField(TEXT("scope"), FString::Join(Scopes, TEXT(" ")));
	return CikletJson::Serialize(Obj);
}

bool FCikletTokens::FromJsonString(const FString& Json, FCikletTokens& Out)
{
	const TSharedPtr<FJsonValue> Value = CikletJson::Parse(Json);
	const TSharedPtr<FJsonObject>* Obj = nullptr;
	if (!Value.IsValid() || !Value->TryGetObject(Obj) || !Obj) return false;
	Out.AccessToken = CikletJson::Str(*Obj, TEXT("access_token"));
	if (Out.AccessToken.IsEmpty()) return false;
	Out.RefreshToken = CikletJson::Str(*Obj, TEXT("refresh_token"));
	Out.ExpiresAtUtc = FDateTime::FromUnixTimestamp(IntField(*Obj, TEXT("expires_at")));
	CikletJson::Str(*Obj, TEXT("scope")).ParseIntoArray(Out.Scopes, TEXT(" "), true);
	return true;
}

bool FCikletTokens::FromTokenResponse(const TSharedPtr<FJsonObject>& Json, FCikletTokens& Out)
{
	Out.AccessToken = CikletJson::Str(Json, TEXT("access_token"));
	if (Out.AccessToken.IsEmpty()) return false;
	Out.RefreshToken = CikletJson::Str(Json, TEXT("refresh_token"));
	Out.ExpiresAtUtc = FDateTime::UtcNow() + FTimespan::FromSeconds(static_cast<double>(IntField(Json, TEXT("expires_in"), 3600)));
	Out.Scopes.Reset();
	CikletJson::Str(Json, TEXT("scope")).ParseIntoArray(Out.Scopes, TEXT(" "), true);
	return true;
}

bool FCikletMemoryTokenStore::Load(FCikletTokens& Out)
{
	if (!Tokens.IsValid()) return false;
	Out = Tokens;
	return true;
}

void FCikletMemoryTokenStore::Save(const FCikletTokens& InTokens) { Tokens = InTokens; }
void FCikletMemoryTokenStore::Clear() { Tokens = FCikletTokens(); }

FCikletFileTokenStore::FCikletFileTokenStore(const FString& ClientId)
	: Path(FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("Ciklet"), ClientId + TEXT(".json")))
{
}

bool FCikletFileTokenStore::Load(FCikletTokens& Out)
{
	FString Text;
	return FFileHelper::LoadFileToString(Text, *Path) && FCikletTokens::FromJsonString(Text, Out);
}

void FCikletFileTokenStore::Save(const FCikletTokens& Tokens)
{
	FFileHelper::SaveStringToFile(Tokens.ToJsonString(), *Path, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
}

void FCikletFileTokenStore::Clear()
{
	FPlatformFileManager::Get().GetPlatformFile().DeleteFile(*Path);
}
