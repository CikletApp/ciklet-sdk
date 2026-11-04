#include "CikletAuth.h"

#include "CikletHttp.h"
#include "CikletLoopbackServer.h"
#include "CikletSocialCore.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "Misc/Guid.h"

// Unity build (UBT dosyaları birleştirir): anonim ad alanı yerine dosyaya özel ad.
namespace CikletAuthDetail
{
	const FTimespan RefreshWindow = FTimespan::FromSeconds(60);
}
using namespace CikletAuthDetail;

TSharedRef<FCikletAuth> FCikletAuth::Create(const FString& ClientId, TSharedPtr<ICikletTokenStore> Store, const FCikletOptions& Options)
{
	return MakeShareable(new FCikletAuth(ClientId, Store, Options));
}

FCikletAuth::FCikletAuth(const FString& InClientId, TSharedPtr<ICikletTokenStore> InStore, const FCikletOptions& InOptions)
	: ClientId(InClientId)
	, Options(InOptions)
	, Store(InStore.IsValid() ? InStore : MakeShared<FCikletMemoryTokenStore>())
{
	Store->Load(Tokens);
}

FCikletAuth::~FCikletAuth()
{
	if (ActiveServer.IsValid()) ActiveServer->Stop();
}

FString FCikletAuth::CreateVerifier()
{
	// FGuid::NewGuid işletim sisteminin GUID üreticisini (Windows: CoCreateGuid, v4
	// rastgele) kullanır; iki GUID ≈ 244 bit rastgelelik, PKCE için yeterli.
	std::vector<uint8_t> Bytes;
	for (int32 I = 0; I < 2; ++I)
	{
		const FGuid Guid = FGuid::NewGuid();
		const uint32 Parts[4] = {Guid.A, Guid.B, Guid.C, Guid.D};
		for (uint32 Part : Parts)
		{
			for (int32 Shift = 24; Shift >= 0; Shift -= 8) Bytes.push_back(static_cast<uint8_t>(Part >> Shift));
		}
	}
	return UTF8_TO_TCHAR(CikletCore::Base64UrlEncode(Bytes).c_str());
}

FCikletOperation FCikletAuth::LoginWithLoopback(const TArray<FString>& Scopes, FTokensCallback OnComplete, float TimeoutSeconds, int32 Port, const FString& CallbackPath)
{
	FCikletOperation Op = FCikletOperation::Make();
	const TSharedPtr<FCikletOperationState> State = Op.State;

	if (ActiveServer.IsValid()) ActiveServer->Stop();
	ActiveServer = FCikletLoopbackServer::Start(CallbackPath, Port);
	if (!ActiveServer.IsValid())
	{
		State->bDone = true;
		OnComplete(TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Network, TEXT("loopback_failed"), TEXT("127.0.0.1 üzerinde port açılamadı."))));
		return Op;
	}

	const FString Verifier = CreateVerifier();
	const FString StateParam = CreateVerifier().Left(22);
	const FString RedirectUri = ActiveServer->GetRedirectUri();

	std::vector<std::string> RawScopes;
	for (const FString& Scope : Scopes) RawScopes.emplace_back(TCHAR_TO_UTF8(*Scope));
	const std::string Url = CikletCore::BuildAuthorizeUrl(
		TCHAR_TO_UTF8(*Options.BaseUrl), TCHAR_TO_UTF8(*ClientId), TCHAR_TO_UTF8(*RedirectUri), RawScopes,
		CikletCore::PkceChallenge(TCHAR_TO_UTF8(*Verifier)), TCHAR_TO_UTF8(*StateParam));

	const TWeakPtr<FCikletAuth> WeakThis = AsShared();
	const TSharedPtr<FTSTicker::FDelegateHandle> TimeoutHandle = MakeShared<FTSTicker::FDelegateHandle>();

	// Tek çıkış noktası: sunucuyu kapat, zaman aşımını kaldır, bir kez bildir.
	const TSharedRef<TFunction<void(const TCikletResult<FCikletTokens>&)>> Finish = MakeShared<TFunction<void(const TCikletResult<FCikletTokens>&)>>(
		[WeakThis, State, TimeoutHandle, OnComplete](const TCikletResult<FCikletTokens>& Result)
		{
			if (State->bDone) return;
			State->bDone = true;
			State->OnCancel = nullptr; // State ↔ Finish döngüsünü kır
			if (TimeoutHandle->IsValid()) FTSTicker::GetCoreTicker().RemoveTicker(*TimeoutHandle);
			if (const TSharedPtr<FCikletAuth> This = WeakThis.Pin())
			{
				if (This->ActiveServer.IsValid()) This->ActiveServer->Stop();
				This->ActiveServer.Reset();
			}
			OnComplete(Result);
		});

	State->OnCancel = [Finish]()
	{
		(*Finish)(TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Cancelled, TEXT("cancelled"), TEXT("Giriş iptal edildi."))));
	};

	*TimeoutHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Finish](float)
	{
		(*Finish)(TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Timeout, TEXT("login_timeout"), TEXT("Giriş süresi doldu."))));
		return false;
	}), TimeoutSeconds);

	ActiveServer->Wait(StateParam, [WeakThis, State, Verifier, RedirectUri, Finish](const FCikletLoopbackServer::FResult& Callback)
	{
		const TSharedPtr<FCikletAuth> This = WeakThis.Pin();
		if (!This.IsValid() || State->bDone) return;
		if (!Callback.Error.IsEmpty())
		{
			(*Finish)(TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Auth, Callback.Error,
				Callback.ErrorDescription.IsEmpty() ? FString(TEXT("Giriş reddedildi.")) : Callback.ErrorDescription)));
			return;
		}
		// Kod geldi: dinleyiciyi kapat, takas et (zaman aşımı artık takası kesmesin).
		This->TokenRequest(State, {
			TPair<FString, FString>(TEXT("grant_type"), TEXT("authorization_code")),
			TPair<FString, FString>(TEXT("code"), Callback.Code),
			TPair<FString, FString>(TEXT("code_verifier"), Verifier),
			TPair<FString, FString>(TEXT("redirect_uri"), RedirectUri),
			TPair<FString, FString>(TEXT("client_id"), This->ClientId),
		}, [Finish](const TCikletResult<FCikletTokens>& Result) { (*Finish)(Result); });
	});

	FPlatformProcess::LaunchURL(UTF8_TO_TCHAR(Url.c_str()), nullptr, nullptr);
	return Op;
}

FCikletOperation FCikletAuth::ExchangeCode(const FString& Code, const FString& CodeVerifier, const FString& RedirectUri, FTokensCallback OnComplete)
{
	FCikletOperation Op = FCikletOperation::Make();
	const TSharedPtr<FCikletOperationState> State = Op.State;
	TokenRequest(State, {
		TPair<FString, FString>(TEXT("grant_type"), TEXT("authorization_code")),
		TPair<FString, FString>(TEXT("code"), Code),
		TPair<FString, FString>(TEXT("code_verifier"), CodeVerifier),
		TPair<FString, FString>(TEXT("redirect_uri"), RedirectUri),
		TPair<FString, FString>(TEXT("client_id"), ClientId),
	}, [State, OnComplete](const TCikletResult<FCikletTokens>& Result)
	{
		if (State->bDone) return;
		State->bDone = true;
		OnComplete(Result);
	});
	return Op;
}

void FCikletAuth::GetAccessToken(FAccessTokenCallback OnComplete)
{
	if (!Tokens.IsValid())
	{
		OnComplete(TCikletResult<FString>::Failure(FCikletError(ECikletErrorKind::Auth, TEXT("not_signed_in"), TEXT("Önce giriş yapın."))));
		return;
	}
	if (!Tokens.ExpiresWithin(RefreshWindow))
	{
		OnComplete(TCikletResult<FString>::Success(Tokens.AccessToken));
		return;
	}
	Refresh([OnComplete](const TCikletResult<FCikletTokens>& Result)
	{
		if (Result) OnComplete(TCikletResult<FString>::Success(Result.Value.AccessToken));
		else OnComplete(TCikletResult<FString>::Failure(Result.Error));
	});
}

void FCikletAuth::Refresh(FTokensCallback OnComplete)
{
	RefreshWaiters.Add(MoveTemp(OnComplete));
	if (bRefreshing) return; // süren yenilemeyi bekle
	if (Tokens.RefreshToken.IsEmpty())
	{
		TArray<FTokensCallback> Waiters = MoveTemp(RefreshWaiters);
		RefreshWaiters.Reset();
		const auto Failure = TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Auth, TEXT("not_signed_in"), TEXT("Yenileme jetonu yok; yeniden giriş gerekli.")));
		for (FTokensCallback& Waiter : Waiters) Waiter(Failure);
		return;
	}
	bRefreshing = true;
	const TWeakPtr<FCikletAuth> WeakThis = AsShared();
	TokenRequest(nullptr, {
		TPair<FString, FString>(TEXT("grant_type"), TEXT("refresh_token")),
		TPair<FString, FString>(TEXT("refresh_token"), Tokens.RefreshToken),
		TPair<FString, FString>(TEXT("client_id"), ClientId),
	}, [WeakThis](const TCikletResult<FCikletTokens>& Result)
	{
		const TSharedPtr<FCikletAuth> This = WeakThis.Pin();
		if (!This.IsValid()) return;
		This->bRefreshing = false;
		TCikletResult<FCikletTokens> Final = Result;
		if (!Result && Result.Error.Code == TEXT("invalid_grant"))
		{
			// Kullanıcı yetkiyi geri aldı ya da aile düştü.
			This->SetTokens(FCikletTokens());
			Final = TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Auth, TEXT("invalid_grant"), TEXT("Oturum sona erdi; yeniden giriş gerekli."), Result.Error.Status));
		}
		TArray<FTokensCallback> Waiters = MoveTemp(This->RefreshWaiters);
		This->RefreshWaiters.Reset();
		for (FTokensCallback& Waiter : Waiters) Waiter(Final);
	});
}

void FCikletAuth::SignOut()
{
	const FCikletTokens Old = Tokens;
	SetTokens(FCikletTokens());
	if (!Old.IsValid()) return;
	TMap<FString, FString> Headers;
	Headers.Add(TEXT("Accept"), TEXT("application/json"));
	Headers.Add(TEXT("User-Agent"), Options.UserAgent);
	CikletHttp::Send(nullptr, TEXT("POST"), Options.Root(TEXT("/api/oauth/revoke")), Headers,
		CikletHttp::FormEncode({
			TPair<FString, FString>(TEXT("token"), Old.RefreshToken.IsEmpty() ? Old.AccessToken : Old.RefreshToken),
			TPair<FString, FString>(TEXT("client_id"), ClientId),
		}),
		TEXT("application/x-www-form-urlencoded"), Options.RequestTimeoutSeconds,
		[](const FCikletHttpResponse*, const FCikletError*) { /* en iyi çaba */ });
}

void FCikletAuth::TokenRequest(const TSharedPtr<FCikletOperationState>& Op, const TArray<TPair<FString, FString>>& Fields, FTokensCallback OnComplete)
{
	TMap<FString, FString> Headers;
	Headers.Add(TEXT("Accept"), TEXT("application/json"));
	Headers.Add(TEXT("User-Agent"), Options.UserAgent);
	const TWeakPtr<FCikletAuth> WeakThis = AsShared();
	CikletHttp::Send(Op, TEXT("POST"), Options.Root(TEXT("/api/oauth/token")), Headers, CikletHttp::FormEncode(Fields),
		TEXT("application/x-www-form-urlencoded"), Options.RequestTimeoutSeconds,
		[WeakThis, OnComplete](const FCikletHttpResponse* Response, const FCikletError* Error)
		{
			if (Error)
			{
				OnComplete(TCikletResult<FCikletTokens>::Failure(*Error));
				return;
			}
			TSharedPtr<FJsonValue> Value;
			FCikletError ParseError;
			if (!CikletHttp::ParseOrError(*Response, Value, ParseError))
			{
				// OAuth hataları (invalid_grant, invalid_client…) yeniden giriş ister.
				if (ParseError.Status == 400 || ParseError.Status == 401) ParseError.Kind = ECikletErrorKind::Auth;
				OnComplete(TCikletResult<FCikletTokens>::Failure(ParseError));
				return;
			}
			const TSharedPtr<FJsonObject>* Obj = nullptr;
			FCikletTokens NewTokens;
			if (!Value->TryGetObject(Obj) || !Obj || !FCikletTokens::FromTokenResponse(*Obj, NewTokens))
			{
				OnComplete(TCikletResult<FCikletTokens>::Failure(FCikletError(ECikletErrorKind::Protocol, TEXT("invalid_token_response"), TEXT("Jeton yanıtı geçersiz."))));
				return;
			}
			if (const TSharedPtr<FCikletAuth> This = WeakThis.Pin()) This->SetTokens(NewTokens);
			OnComplete(TCikletResult<FCikletTokens>::Success(NewTokens));
		});
}

void FCikletAuth::SetTokens(const FCikletTokens& NewTokens)
{
	Tokens = NewTokens;
	if (Tokens.IsValid()) Store->Save(Tokens);
	else Store->Clear();
	OnTokensChanged.Broadcast(Tokens);
}
