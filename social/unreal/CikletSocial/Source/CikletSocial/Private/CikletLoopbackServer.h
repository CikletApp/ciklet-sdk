// 127.0.0.1'i dinleyen tek amaçlı küçük HTTP dinleyici (oyun iş parçacığında, ticker ile).
#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"

class FSocket;

class FCikletLoopbackServer : public TSharedFromThis<FCikletLoopbackServer>
{
public:
	struct FResult
	{
		FString Code;
		FString Error;
		FString ErrorDescription;
	};

	using FCallback = TFunction<void(const FResult&)>;

	~FCikletLoopbackServer();

	/** Port 0 = işletim sistemi boş port verir. Başarısızsa nullptr. */
	static TSharedPtr<FCikletLoopbackServer> Start(const FString& Path, int32 Port);

	int32 GetPort() const { return BoundPort; }
	FString GetRedirectUri() const;

	/** Doğru yol + doğru state ile gelen ilk istekte bir kez çağrılır. */
	void Wait(const FString& ExpectedState, FCallback OnCallback);
	void Stop();

	FString SuccessHtml = TEXT("<!doctype html><meta charset=utf-8><title>Ciklet</title><body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h2>Giriş tamamlandı</h2><p>Bu sekmeyi kapatıp oyuna dönebilirsiniz.</p></body>");
	FString ErrorHtml = TEXT("<!doctype html><meta charset=utf-8><title>Ciklet</title><body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h2>Giriş tamamlanamadı</h2><p>Oyuna dönüp yeniden deneyin.</p></body>");

private:
	struct FPendingClient
	{
		FSocket* Socket = nullptr;
		TArray<uint8> Buffer;
		double StartedAt = 0;
	};

	bool Tick(float DeltaTime);
	/** true: istemci işlendi ve kapatılmalı. */
	bool Service(FPendingClient& Client);
	void Respond(FSocket* Socket, int32 Status, const FString& Reason, const FString& ContentType, const FString& Body);

	FSocket* Listener = nullptr;
	int32 BoundPort = 0;
	FString Path;
	FString ExpectedState;
	FCallback Callback;
	TArray<FPendingClient> Clients;
	FTSTicker::FDelegateHandle TickHandle;
};
