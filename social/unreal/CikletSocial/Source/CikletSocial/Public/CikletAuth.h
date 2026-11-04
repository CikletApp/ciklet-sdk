// Ciklet hesabıyla giriş: OAuth2 yetkilendirme kodu + PKCE, loopback geri dönüşü (RFC 8252).
#pragma once

#include "CoreMinimal.h"
#include "CikletSocialTypes.h"

class FCikletLoopbackServer;

DECLARE_MULTICAST_DELEGATE_OneParam(FOnCikletTokensChanged, const FCikletTokens& /* boşsa çıkış */);

/**
 * Giriş ve jeton yönetimi. Geliştirici Portalı'nda uygulamanız PUBLIC istemci
 * olmalı ve redirect URI olarak `http://127.0.0.1/callback` kayıtlı olmalı (port
 * serbest). client_secret oyuna KONMAZ. Tüm geri çağırmalar oyun iş parçacığında.
 */
class CIKLETSOCIAL_API FCikletAuth : public TSharedFromThis<FCikletAuth>
{
public:
	using FTokensCallback = TFunction<void(const TCikletResult<FCikletTokens>&)>;
	using FAccessTokenCallback = TFunction<void(const TCikletResult<FString>&)>;

	/** Store verilmezse bellek içi. Kalıcı için `MakeShared<FCikletFileTokenStore>(ClientId)` ya da kendi güvenli deponuz. */
	static TSharedRef<FCikletAuth> Create(const FString& ClientId, TSharedPtr<ICikletTokenStore> Store = nullptr, const FCikletOptions& Options = FCikletOptions());

	~FCikletAuth();

	/**
	 * Sistem tarayıcısında onay ekranını açar, 127.0.0.1'de boş bir portu dinler, kodu
	 * alıp jetona çevirir. Kullanıcı reddederse `Auth` (`access_denied`), süre dolarsa
	 * `Timeout`, Cancel() ile `Cancelled`.
	 */
	FCikletOperation LoginWithLoopback(const TArray<FString>& Scopes, FTokensCallback OnComplete, float TimeoutSeconds = 300.f, int32 Port = 0, const FString& CallbackPath = TEXT("/callback"));

	/** Kodu jetona çevirir (kendi geri dönüş yolunuz varsa). */
	FCikletOperation ExchangeCode(const FString& Code, const FString& CodeVerifier, const FString& RedirectUri, FTokensCallback OnComplete);

	/**
	 * Geçerli erişim jetonu; 60 sn içinde dolacaksa önce yeniler. Aynı anda gelen
	 * istekler tek bir yenilemeyi bekler (rotasyonlu yenileme jetonu).
	 */
	void GetAccessToken(FAccessTokenCallback OnComplete);

	/** Şimdi yeniler (ör. 401 sonrası). */
	void Refresh(FTokensCallback OnComplete);

	/** Jetonu sunucuda iptal eder (en iyi çaba) ve yerelden siler. */
	void SignOut();

	bool IsSignedIn() const { return Tokens.IsValid(); }
	const FCikletTokens& GetTokens() const { return Tokens; }
	const FCikletOptions& GetOptions() const { return Options; }
	const FString& GetClientId() const { return ClientId; }

	FOnCikletTokensChanged OnTokensChanged;

	/** 32 bayt rastgele → 43 karakter base64url. */
	static FString CreateVerifier();

private:
	FCikletAuth(const FString& InClientId, TSharedPtr<ICikletTokenStore> InStore, const FCikletOptions& InOptions);

	void TokenRequest(const TSharedPtr<FCikletOperationState>& Op, const TArray<TPair<FString, FString>>& Fields, FTokensCallback OnComplete);
	void SetTokens(const FCikletTokens& NewTokens);

	FString ClientId;
	FCikletOptions Options;
	TSharedPtr<ICikletTokenStore> Store;
	FCikletTokens Tokens;

	bool bRefreshing = false;
	TArray<FTokensCallback> RefreshWaiters;
	TSharedPtr<FCikletLoopbackServer> ActiveServer;
};
