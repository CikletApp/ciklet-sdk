#include "CikletHttp.h"

#include "CikletSocialCore.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"

namespace CikletHttp
{
	void Send(
		const TSharedPtr<FCikletOperationState>& Op,
		const FString& Method,
		const FString& Url,
		const TMap<FString, FString>& Headers,
		const FString& Body,
		const FString& ContentType,
		float TimeoutSeconds,
		TFunction<void(const FCikletHttpResponse* Response, const FCikletError* Error)> OnComplete)
	{
		if (Op.IsValid() && Op->bCancelled)
		{
			const FCikletError Cancelled(ECikletErrorKind::Cancelled, TEXT("cancelled"), TEXT("İşlem iptal edildi."));
			OnComplete(nullptr, &Cancelled);
			return;
		}

		const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		Request->SetVerb(Method);
		Request->SetURL(Url);
		for (const TPair<FString, FString>& Header : Headers) Request->SetHeader(Header.Key, Header.Value);
		if (!Body.IsEmpty() || Method == TEXT("POST") || Method == TEXT("PUT") || Method == TEXT("PATCH"))
		{
			Request->SetHeader(TEXT("Content-Type"), ContentType.IsEmpty() ? TEXT("application/json") : ContentType);
			Request->SetContentAsString(Body);
		}
		Request->SetTimeout(TimeoutSeconds);

		const double StartedAt = FPlatformTime::Seconds();
		const TWeakPtr<FCikletOperationState> WeakOp = Op;
		Request->OnProcessRequestComplete().BindLambda(
			[WeakOp, StartedAt, TimeoutSeconds, OnComplete](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully)
			{
				const TSharedPtr<FCikletOperationState> PinnedOp = WeakOp.Pin();
				if (PinnedOp.IsValid() && PinnedOp->bCancelled)
				{
					const FCikletError Cancelled(ECikletErrorKind::Cancelled, TEXT("cancelled"), TEXT("İşlem iptal edildi."));
					OnComplete(nullptr, &Cancelled);
					return;
				}
				if (!bConnectedSuccessfully || !Response.IsValid())
				{
					// Sürüm bağımsız zaman aşımı tespiti: süre dolduysa Timeout, değilse ağ hatası.
					const bool bTimedOut = FPlatformTime::Seconds() - StartedAt >= TimeoutSeconds - 0.25;
					const FCikletError Error = bTimedOut
						? FCikletError(ECikletErrorKind::Timeout, TEXT("timeout"), TEXT("İstek zaman aşımına uğradı."))
						: FCikletError(ECikletErrorKind::Network, TEXT("network_error"), TEXT("Sunucuya bağlanılamadı."));
					OnComplete(nullptr, &Error);
					return;
				}
				FCikletHttpResponse Out;
				Out.Status = Response->GetResponseCode();
				Out.Body = Response->GetContentAsString();
				Out.RetryAfter = Response->GetHeader(TEXT("Retry-After"));
				OnComplete(&Out, nullptr);
			});

		if (Op.IsValid()) Op->Current = Request;
		if (!Request->ProcessRequest())
		{
			const FCikletError Error(ECikletErrorKind::Network, TEXT("network_error"), TEXT("İstek başlatılamadı."));
			OnComplete(nullptr, &Error);
		}
	}

	FCikletError ErrorFrom(const FCikletHttpResponse& Response)
	{
		const TSharedPtr<FJsonValue> Value = CikletJson::Parse(Response.Body);
		const TSharedPtr<FJsonObject>* ObjPtr = nullptr;
		TSharedPtr<FJsonObject> Obj;
		if (Value.IsValid() && Value->TryGetObject(ObjPtr) && ObjPtr) Obj = *ObjPtr;

		FString Code = CikletJson::Str(Obj, TEXT("code"));
		double NumericCode = 0;
		if (Code.IsEmpty() && Obj.IsValid() && Obj->TryGetNumberField(TEXT("code"), NumericCode)) Code = FString::Printf(TEXT("%lld"), static_cast<long long>(NumericCode));
		if (Code.IsEmpty()) Code = CikletJson::Str(Obj, TEXT("error"));
		if (Code.IsEmpty()) Code = FString::Printf(TEXT("http_%d"), Response.Status);

		FString Message = CikletJson::Str(Obj, TEXT("message"));
		if (Message.IsEmpty()) Message = CikletJson::Str(Obj, TEXT("error_description"));
		if (Message.IsEmpty()) Message = FString::Printf(TEXT("HTTP %d"), Response.Status);

		FCikletError Error(Response.Status == 401 ? ECikletErrorKind::Auth : ECikletErrorKind::Http, Code, Message, Response.Status);
		double RetryAfter = -1;
		if (Obj.IsValid() && Obj->TryGetNumberField(TEXT("retry_after"), RetryAfter)) Error.RetryAfterSeconds = static_cast<float>(RetryAfter);
		else if (!Response.RetryAfter.IsEmpty()) Error.RetryAfterSeconds = FCString::Atof(*Response.RetryAfter);
		return Error;
	}

	bool ParseOrError(const FCikletHttpResponse& Response, TSharedPtr<FJsonValue>& OutValue, FCikletError& OutError)
	{
		if (Response.Status < 200 || Response.Status >= 300)
		{
			OutError = ErrorFrom(Response);
			return false;
		}
		if (Response.Body.IsEmpty())
		{
			OutValue = MakeShared<FJsonValueNull>();
			return true;
		}
		OutValue = CikletJson::Parse(Response.Body);
		if (!OutValue.IsValid())
		{
			OutError = FCikletError(ECikletErrorKind::Protocol, TEXT("invalid_json"), TEXT("Yanıt JSON değil."), Response.Status);
			return false;
		}
		return true;
	}

	FString FormEncode(const TArray<TPair<FString, FString>>& Fields)
	{
		std::vector<std::pair<std::string, std::string>> Raw;
		for (const TPair<FString, FString>& Field : Fields)
		{
			Raw.emplace_back(TCHAR_TO_UTF8(*Field.Key), TCHAR_TO_UTF8(*Field.Value));
		}
		return UTF8_TO_TCHAR(CikletCore::BuildQuery(Raw).c_str());
	}

	FString Segment(const FString& Id)
	{
		return UTF8_TO_TCHAR(CikletCore::PathSegment(TCHAR_TO_UTF8(*Id)).c_str());
	}
}
