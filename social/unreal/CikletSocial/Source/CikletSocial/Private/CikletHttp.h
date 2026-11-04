// SDK içi HTTP yardımcısı: FHttpModule isteği + zaman aşımı + iptal + hata eşleme.
#pragma once

#include "CoreMinimal.h"
#include "CikletSocialTypes.h"

struct FCikletHttpResponse
{
	int32 Status = 0;
	FString Body;
	FString RetryAfter;
};

namespace CikletHttp
{
	/**
	 * İsteği gönderir; geri çağırma oyun iş parçacığında bir kez gelir. Bağlantı
	 * hatası / zaman aşımı / iptal `Error` ile, her HTTP yanıtı (4xx dahil) `Response` ile.
	 */
	void Send(
		const TSharedPtr<FCikletOperationState>& Op,
		const FString& Method,
		const FString& Url,
		const TMap<FString, FString>& Headers,
		const FString& Body,
		const FString& ContentType,
		float TimeoutSeconds,
		TFunction<void(const FCikletHttpResponse* Response, const FCikletError* Error)> OnComplete);

	/** 2xx değilse sunucu gövdesinden hata üretir; 2xx ise JSON'u ayrıştırır (boş gövde → null değer). */
	bool ParseOrError(const FCikletHttpResponse& Response, TSharedPtr<FJsonValue>& OutValue, FCikletError& OutError);

	/** Ciklet hata gövdeleri: REST `{ code, message }`, OAuth `{ error, error_description }`. */
	FCikletError ErrorFrom(const FCikletHttpResponse& Response);

	FString FormEncode(const TArray<TPair<FString, FString>>& Fields);
	FString Segment(const FString& Id);
}
