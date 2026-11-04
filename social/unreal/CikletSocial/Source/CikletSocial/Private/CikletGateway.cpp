#include "CikletGateway.h"

#include "CikletSocialCore.h"
#include "IWebSocket.h"
#include "Math/UnrealMathUtility.h"
#include "WebSocketsModule.h"

TSharedRef<FCikletGateway> FCikletGateway::Create(const TSharedRef<FCikletAuth>& InAuth)
{
	return MakeShareable(new FCikletGateway(InAuth));
}

FCikletGateway::~FCikletGateway()
{
	bWanted = false;
	ClearTickers();
	CloseSocket();
}

void FCikletGateway::Connect()
{
	if (bWanted) return;
	bWanted = true;
	Attempt = 0;
	StartAttempt();
}

void FCikletGateway::Disconnect()
{
	bWanted = false;
	ClearTickers();
	CloseSocket();
	SetState(ECikletGatewayState::Disconnected);
}

void FCikletGateway::StartAttempt()
{
	if (!bWanted) return;
	SetState(Attempt == 0 ? ECikletGatewayState::Connecting : ECikletGatewayState::Reconnecting);
	const uint32 MyGeneration = ++Generation;
	const TWeakPtr<FCikletGateway> WeakThis = AsShared();
	Auth->GetAccessToken([WeakThis, MyGeneration](const TCikletResult<FString>& Token)
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (!This.IsValid() || !This->bWanted || MyGeneration != This->Generation) return;
		if (!Token)
		{
			// Giriş yok / yenilenemedi → yeniden deneme anlamsız; ağ hatasıysa dene.
			This->HandleDrop(&Token.Error, Token.Error.Kind == ECikletErrorKind::Auth);
			return;
		}
		This->OpenSocket(Token.Value);
	});
}

void FCikletGateway::OpenSocket(const FString& AccessToken)
{
	const FCikletOptions& Options = Auth->GetOptions();
	TMap<FString, FString> Headers;
	Headers.Add(TEXT("Authorization"), TEXT("Bearer ") + AccessToken);
	Headers.Add(TEXT("User-Agent"), Options.UserAgent);

	Socket = FWebSocketsModule::Get().CreateWebSocket(Options.GatewayUrl, FString(), Headers);
	bReady = false;
	const uint32 MyGeneration = Generation;
	const TWeakPtr<FCikletGateway> WeakThis = AsShared();

	Socket->OnConnected().AddLambda([WeakThis, MyGeneration]()
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (!This.IsValid() || MyGeneration != This->Generation) return;
		if (This->ConnectTimeoutHandle.IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(This->ConnectTimeoutHandle);
			This->ConnectTimeoutHandle.Reset();
		}
		This->LastAckAt = FPlatformTime::Seconds();
		This->SetState(ECikletGatewayState::Connected);
		This->HeartbeatHandle = FTSTicker::GetCoreTicker().AddTicker(
			FTickerDelegate::CreateSP(This.ToSharedRef(), &FCikletGateway::HeartbeatTick), This->HeartbeatIntervalSeconds);
	});
	Socket->OnConnectionError().AddLambda([WeakThis, MyGeneration](const FString& Error)
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (!This.IsValid() || MyGeneration != This->Generation) return;
		const FCikletError Err(ECikletErrorKind::Network, TEXT("gateway_connect_failed"), Error);
		// El sıkışma reddi (ör. 401) burada gelir; jeton düşmüş olabilir — yenilemeyi dene.
		This->Auth->Refresh([](const TCikletResult<FCikletTokens>&) {});
		This->HandleDrop(&Err, false);
	});
	Socket->OnClosed().AddLambda([WeakThis, MyGeneration](int32 StatusCode, const FString& Reason, bool)
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (!This.IsValid() || MyGeneration != This->Generation) return;
		const FCikletError Err(ECikletErrorKind::Network, TEXT("gateway_closed"), FString::Printf(TEXT("%d %s"), StatusCode, *Reason));
		This->HandleDrop(&Err, false);
	});
	Socket->OnMessage().AddLambda([WeakThis, MyGeneration](const FString& Text)
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (!This.IsValid() || MyGeneration != This->Generation) return;
		This->HandleMessage(Text);
	});

	ConnectTimeoutHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis, MyGeneration](float)
	{
		const TSharedPtr<FCikletGateway> This = WeakThis.Pin();
		if (This.IsValid() && MyGeneration == This->Generation && This->State != ECikletGatewayState::Connected)
		{
			This->ConnectTimeoutHandle.Reset();
			const FCikletError Err(ECikletErrorKind::Timeout, TEXT("gateway_connect_timeout"), TEXT("Ağ geçidine bağlanma zaman aşımı."));
			This->HandleDrop(&Err, false);
		}
		return false;
	}), ConnectTimeoutSeconds);

	Socket->Connect();
}

void FCikletGateway::HandleMessage(const FString& Text)
{
	const TSharedPtr<FJsonValue> Value = CikletJson::Parse(Text);
	const TSharedPtr<FJsonObject>* FramePtr = nullptr;
	if (!Value.IsValid() || !Value->TryGetObject(FramePtr) || !FramePtr) return;
	const TSharedPtr<FJsonObject> Frame = *FramePtr;

	if (CikletJson::Str(Frame, TEXT("type")) == TEXT("error"))
	{
		bool bRetryable = true;
		Frame->TryGetBoolField(TEXT("retryable"), bRetryable);
		FString Code = CikletJson::Str(Frame, TEXT("code"));
		if (Code.IsEmpty()) Code = TEXT("gateway_error");
		const FCikletError Err(bRetryable ? ECikletErrorKind::Network : ECikletErrorKind::Auth, Code, TEXT("Ağ geçidi reddetti: ") + Code);
		if (!bRetryable)
		{
			HandleDrop(&Err, true);
			return;
		}
		OnError.Broadcast(Err);
		return;
	}

	OnRawFrame.Broadcast(Frame);
	const FString EventType = CikletJson::Str(Frame, TEXT("eventType"));
	if (EventType == TEXT("heartbeat.ack"))
	{
		LastAckAt = FPlatformTime::Seconds();
	}
	else if (EventType == TEXT("ready"))
	{
		bReady = true;
		LastAckAt = FPlatformTime::Seconds();
		OnReady.Broadcast(Frame);
	}
	else if (EventType.StartsWith(TEXT("lobby.")))
	{
		FCikletLobbyEvent Event;
		if (FCikletLobbyEvent::FromFrame(Frame, Event)) OnLobbyEvent.Broadcast(Event);
	}
}

bool FCikletGateway::HeartbeatTick(float)
{
	if (!Socket.IsValid() || State != ECikletGatewayState::Connected) return false;
	// İki aralık + pay boyunca ack yoksa bağlantı ölü (yarı açık TCP).
	if (FPlatformTime::Seconds() - LastAckAt > HeartbeatIntervalSeconds * 2 + 5)
	{
		HeartbeatHandle.Reset();
		const FCikletError Err(ECikletErrorKind::Timeout, TEXT("heartbeat_timeout"), TEXT("Ağ geçidi yanıt vermiyor."));
		HandleDrop(&Err, false);
		return false;
	}
	Socket->Send(TEXT("{\"event_type\":\"heartbeat\"}"));
	return true;
}

void FCikletGateway::HandleDrop(const FCikletError* Error, bool bFatal)
{
	const bool bWasReady = bReady;
	++Generation; // bu soketin geç olaylarını yok say
	ClearTickers();
	CloseSocket();
	if (Error) OnError.Broadcast(*Error);
	if (bFatal || !bWanted)
	{
		bWanted = false;
		SetState(ECikletGatewayState::Disconnected);
		return;
	}
	Attempt = bWasReady ? 1 : Attempt + 1;
	ScheduleReconnect();
}

void FCikletGateway::ScheduleReconnect()
{
	SetState(ECikletGatewayState::Reconnecting);
	const double DelayMs = CikletCore::BackoffMs(Attempt - 1, MinBackoffSeconds * 1000.0, MaxBackoffSeconds * 1000.0, FMath::FRand());
	const TWeakPtr<FCikletGateway> WeakThis = AsShared();
	ReconnectHandle = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([WeakThis](float)
	{
		if (const TSharedPtr<FCikletGateway> This = WeakThis.Pin())
		{
			This->ReconnectHandle.Reset();
			This->StartAttempt();
		}
		return false;
	}), static_cast<float>(DelayMs / 1000.0));
}

void FCikletGateway::CloseSocket()
{
	if (!Socket.IsValid()) return;
	const TSharedPtr<IWebSocket> Old = Socket;
	Socket.Reset();
	Old->OnConnected().Clear();
	Old->OnConnectionError().Clear();
	Old->OnClosed().Clear();
	Old->OnMessage().Clear();
	if (Old->IsConnected()) Old->Close(1000, TEXT("bye"));
	// Kendi olay geri çağırmasının içinden kapatılıyor olabiliriz: soketi bu karede
	// yok etme, bir sonraki tick'te bırak.
	FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Old](float) { return false; }), 0.f);
}

void FCikletGateway::ClearTickers()
{
	for (FTSTicker::FDelegateHandle* Handle : {&HeartbeatHandle, &ReconnectHandle, &ConnectTimeoutHandle})
	{
		if (Handle->IsValid())
		{
			FTSTicker::GetCoreTicker().RemoveTicker(*Handle);
			Handle->Reset();
		}
	}
}

void FCikletGateway::SetState(ECikletGatewayState NewState)
{
	if (State == NewState) return;
	State = NewState;
	OnStateChanged.Broadcast(NewState);
}
