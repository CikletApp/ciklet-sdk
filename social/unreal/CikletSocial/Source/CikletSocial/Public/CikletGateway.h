// Ciklet ağ geçidi — kullanıcı jetonuyla `lobby.*` olayları, heartbeat, geri çekilmeli yeniden bağlanma.
#pragma once

#include "CoreMinimal.h"
#include "CikletAuth.h"
#include "CikletSocialTypes.h"
#include "Containers/Ticker.h"

class IWebSocket;

enum class ECikletGatewayState : uint8
{
	Disconnected,
	Connecting,
	Connected,
	/** Koptu; geri çekilmeyle yeniden denenecek. */
	Reconnecting,
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnCikletGatewayState, ECikletGatewayState);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnCikletGatewayFrame, const TSharedPtr<FJsonObject>&);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnCikletLobbyEvent, const FCikletLobbyEvent&);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnCikletGatewayError, const FCikletError&);

/**
 * `wss://ciklet.xyz/gateway/ws` (`Authorization: Bearer`, `lobbies.write`). 30 sn'de bir
 * heartbeat (sunucu 60 sn sessiz bağlantıyı kapatır); ack gelmezse bağlantıyı ölü sayar.
 * Kopunca 1 sn → 30 sn üstel geri çekilme + rastgele sapma. Tüm olaylar oyun iş parçacığında.
 */
class CIKLETSOCIAL_API FCikletGateway : public TSharedFromThis<FCikletGateway>
{
public:
	static TSharedRef<FCikletGateway> Create(const TSharedRef<FCikletAuth>& Auth);
	~FCikletGateway();

	void Connect();
	/** Kapatır ve yeniden denemeyi durdurur. */
	void Disconnect();

	ECikletGatewayState GetState() const { return State; }

	float HeartbeatIntervalSeconds = 30.f;
	float ConnectTimeoutSeconds = 15.f;
	float MinBackoffSeconds = 1.f;
	float MaxBackoffSeconds = 30.f;

	FOnCikletGatewayState OnStateChanged;
	/** `ready` karesi. */
	FOnCikletGatewayFrame OnReady;
	FOnCikletLobbyEvent OnLobbyEvent;
	/** Her kare (SDK'nın tanımadıkları için). */
	FOnCikletGatewayFrame OnRawFrame;
	/** IsRetryable() false ise yeniden denenmez. */
	FOnCikletGatewayError OnError;

private:
	explicit FCikletGateway(const TSharedRef<FCikletAuth>& InAuth) : Auth(InAuth) {}

	void StartAttempt();
	void OpenSocket(const FString& AccessToken);
	void HandleMessage(const FString& Text);
	void HandleDrop(const FCikletError* Error, bool bFatal);
	void ScheduleReconnect();
	void CloseSocket();
	void SetState(ECikletGatewayState NewState);
	bool HeartbeatTick(float);
	void ClearTickers();

	TSharedRef<FCikletAuth> Auth;
	TSharedPtr<IWebSocket> Socket;
	ECikletGatewayState State = ECikletGatewayState::Disconnected;
	bool bWanted = false;
	bool bReady = false;
	int32 Attempt = 0;
	/** Her bağlantı denemesinde artar; eski soketlerin geç gelen olayları yok sayılır. */
	uint32 Generation = 0;
	double LastAckAt = 0;
	FTSTicker::FDelegateHandle HeartbeatHandle;
	FTSTicker::FDelegateHandle ReconnectHandle;
	FTSTicker::FDelegateHandle ConnectTimeoutHandle;
};
