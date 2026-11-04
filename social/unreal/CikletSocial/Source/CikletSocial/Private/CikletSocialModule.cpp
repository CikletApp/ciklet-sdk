#include "CikletSocialModule.h"

#include "WebSocketsModule.h"

void FCikletSocialModule::StartupModule()
{
	// Ağ geçidi için WebSockets modülünün yüklü olduğundan emin ol.
	FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
}

void FCikletSocialModule::ShutdownModule()
{
}

IMPLEMENT_MODULE(FCikletSocialModule, CikletSocial)
