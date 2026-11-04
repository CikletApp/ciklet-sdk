#include "CikletLoopbackServer.h"

#include "CikletSocialCore.h"
#include "IPAddress.h"
#include "Sockets.h"
#include "SocketSubsystem.h"

// Unity build (UBT dosyaları birleştirir): anonim ad alanı yerine dosyaya özel ad.
namespace CikletLoopbackDetail
{
	constexpr int32 MaxRequestBytes = 16 * 1024;
	constexpr double ClientReadTimeoutSeconds = 10.0;

	void CloseSocket(FSocket*& Socket)
	{
		if (!Socket) return;
		Socket->Close();
		if (ISocketSubsystem* Subsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM)) Subsystem->DestroySocket(Socket);
		Socket = nullptr;
	}
}
using namespace CikletLoopbackDetail;

FCikletLoopbackServer::~FCikletLoopbackServer()
{
	Stop();
}

TSharedPtr<FCikletLoopbackServer> FCikletLoopbackServer::Start(const FString& InPath, int32 Port)
{
	ISocketSubsystem* Subsystem = ISocketSubsystem::Get(PLATFORM_SOCKETSUBSYSTEM);
	if (!Subsystem || !InPath.StartsWith(TEXT("/"))) return nullptr;

	FSocket* Socket = Subsystem->CreateSocket(NAME_Stream, TEXT("CikletLoopback"), false);
	if (!Socket) return nullptr;

	// YALNIZCA loopback: dış ağdan erişilemez.
	const TSharedRef<FInternetAddr> Addr = Subsystem->CreateInternetAddr();
	bool bValidIp = false;
	Addr->SetIp(TEXT("127.0.0.1"), bValidIp);
	Addr->SetPort(Port);
	if (!bValidIp || !Socket->Bind(*Addr) || !Socket->Listen(8))
	{
		CloseSocket(Socket);
		return nullptr;
	}
	Socket->SetNonBlocking(true);

	TSharedPtr<FCikletLoopbackServer> Server = MakeShareable(new FCikletLoopbackServer());
	Server->Listener = Socket;
	Server->BoundPort = Socket->GetPortNo();
	Server->Path = InPath;
	return Server;
}

FString FCikletLoopbackServer::GetRedirectUri() const
{
	return FString::Printf(TEXT("http://127.0.0.1:%d%s"), BoundPort, *Path);
}

void FCikletLoopbackServer::Wait(const FString& InExpectedState, FCallback OnCallback)
{
	ExpectedState = InExpectedState;
	Callback = MoveTemp(OnCallback);
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateSP(this, &FCikletLoopbackServer::Tick), 0.05f);
}

void FCikletLoopbackServer::Stop()
{
	if (TickHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
		TickHandle.Reset();
	}
	for (FPendingClient& Client : Clients) CloseSocket(Client.Socket);
	Clients.Reset();
	CloseSocket(Listener);
	Callback = nullptr;
}

bool FCikletLoopbackServer::Tick(float)
{
	if (!Listener) return false;
	// Geri çağırma sahibi sunucuyu bırakabilir; bu karede ayakta tut.
	const TSharedRef<FCikletLoopbackServer> KeepAlive = AsShared();

	bool bPending = false;
	while (Listener && Listener->HasPendingConnection(bPending) && bPending)
	{
		FSocket* Accepted = Listener->Accept(TEXT("CikletLoopbackClient"));
		if (!Accepted) break;
		Accepted->SetNonBlocking(true);
		FPendingClient Client;
		Client.Socket = Accepted;
		Client.StartedAt = FPlatformTime::Seconds();
		Clients.Add(MoveTemp(Client));
	}

	// Service geri çağırmayı tetikleyip Stop() ile Clients'ı boşaltabilir; dizinle ilerle.
	for (int32 Index = 0; Index < Clients.Num();)
	{
		if (Service(Clients[Index]))
		{
			if (!Clients.IsValidIndex(Index)) break; // Stop() çağrıldı
			CloseSocket(Clients[Index].Socket);
			Clients.RemoveAt(Index);
		}
		else
		{
			++Index;
		}
	}
	return Listener != nullptr;
}

bool FCikletLoopbackServer::Service(FPendingClient& Client)
{
	uint8 Chunk[4096];
	int32 Read = 0;
	while (Client.Socket->Recv(Chunk, sizeof(Chunk), Read) && Read > 0)
	{
		Client.Buffer.Append(Chunk, Read);
		if (Client.Buffer.Num() > MaxRequestBytes) return true; // bozuk/kötü niyetli
	}

	const std::string Raw(reinterpret_cast<const char*>(Client.Buffer.GetData()), Client.Buffer.Num());
	if (!CikletCore::HasHeaderEnd(Raw))
	{
		return FPlatformTime::Seconds() - Client.StartedAt > ClientReadTimeoutSeconds;
	}

	const std::string Target = CikletCore::ParseRequestTarget(Raw);
	if (Target.empty())
	{
		Respond(Client.Socket, 400, TEXT("Bad Request"), TEXT("text/plain"), TEXT("bad request"));
		return true;
	}
	const CikletCore::FLoopbackResult Result = CikletCore::EvaluateCallback(Target, TCHAR_TO_UTF8(*Path), TCHAR_TO_UTF8(*ExpectedState));
	if (Result.Outcome == 0)
	{
		Respond(Client.Socket, 404, TEXT("Not Found"), TEXT("text/plain"), TEXT("not found"));
		return true;
	}
	if (Result.Outcome == 1)
	{
		// Yanlış state: başka bir sekmenin/sitenin denemesi — yok say, beklemeye devam.
		Respond(Client.Socket, 400, TEXT("Bad Request"), TEXT("text/html; charset=utf-8"), ErrorHtml);
		return true;
	}

	Respond(Client.Socket, 200, TEXT("OK"), TEXT("text/html; charset=utf-8"), Result.Error.empty() ? SuccessHtml : ErrorHtml);
	FResult Out;
	Out.Code = UTF8_TO_TCHAR(Result.Code.c_str());
	Out.Error = UTF8_TO_TCHAR(Result.Error.c_str());
	Out.ErrorDescription = UTF8_TO_TCHAR(Result.ErrorDescription.c_str());
	FCallback Pending = MoveTemp(Callback);
	Callback = nullptr;
	if (Pending) Pending(Out);
	return true;
}

void FCikletLoopbackServer::Respond(FSocket* Socket, int32 Status, const FString& Reason, const FString& ContentType, const FString& Body)
{
	const std::string Response = CikletCore::HttpResponse(Status, TCHAR_TO_UTF8(*Reason), TCHAR_TO_UTF8(*ContentType), TCHAR_TO_UTF8(*Body));
	int32 Sent = 0;
	Socket->SetNonBlocking(false);
	Socket->Send(reinterpret_cast<const uint8*>(Response.data()), static_cast<int32>(Response.size()), Sent);
}
