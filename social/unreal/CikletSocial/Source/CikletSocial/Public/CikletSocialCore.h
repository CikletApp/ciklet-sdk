// Ciklet Social SDK — motordan bağımsız çekirdek (yalnızca standart C++17).
//
// URL/sorgu kodlama, PKCE (SHA-256 + base64url), loopback HTTP istek satırı
// ayrıştırma ve geri çekilme hesabı. Unreal tipleri kullanmaz; böylece motor
// olmadan da derlenip test edilebilir (Tests/core_test.cpp).
#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace CikletCore
{
	/** RFC 3986 "unreserved" dışındaki her baytı %XX yapar (UTF-8 girdi). */
	std::string UrlEncode(const std::string& Value);

	/** %XX ve '+' (boşluk) çözer. Bozuk kaçış olduğu gibi bırakılır. */
	std::string UrlDecode(const std::string& Value);

	/** `a=1&b=2` — boş değerli alanlar atlanır, sıra korunur. */
	std::string BuildQuery(const std::vector<std::pair<std::string, std::string>>& Fields);

	/** Sorgu dizgesi → sözlük. Aynı anahtar tekrarlanırsa İLK değer geçerli. */
	std::map<std::string, std::string> ParseQuery(const std::string& Query);

	/** SHA-256 özeti (32 bayt). */
	std::vector<uint8_t> Sha256(const std::string& Data);

	/** Dolgusuz base64url (RFC 4648 §5). */
	std::string Base64UrlEncode(const std::vector<uint8_t>& Bytes);

	/** PKCE S256: BASE64URL(SHA256(verifier)). */
	std::string PkceChallenge(const std::string& Verifier);

	/** `https://ciklet.xyz/oauth/authorize?...` */
	std::string BuildAuthorizeUrl(
		const std::string& BaseUrl,
		const std::string& ClientId,
		const std::string& RedirectUri,
		const std::vector<std::string>& Scopes,
		const std::string& CodeChallenge,
		const std::string& State);

	/**
	 * Loopback dinleyicisine gelen ham isteğin ilk satırından hedefi çıkarır:
	 * `GET /callback?code=… HTTP/1.1` → `/callback?code=…`. GET değilse,
	 * mutlak URI ise ya da satır bozuksa boş dizge.
	 */
	std::string ParseRequestTarget(const std::string& RawRequest);

	/** Ham istekte başlık sonu (`\r\n\r\n`) var mı? */
	bool HasHeaderEnd(const std::string& RawRequest);

	struct FLoopbackResult
	{
		/** 0: yol yanlış (404), 1: state yanlış/bozuk (400), 2: geçerli geri dönüş. */
		int Outcome = 0;
		std::string Code;
		std::string Error;
		std::string ErrorDescription;
	};

	/** İstek hedefini beklenen yol ve state'e göre değerlendirir. */
	FLoopbackResult EvaluateCallback(const std::string& Target, const std::string& ExpectedPath, const std::string& ExpectedState);

	/** Geri çekilme (ms): min(üst, alt·2^deneme) × [0.5, 1.0) sapma. */
	double BackoffMs(int Attempt, double MinMs, double MaxMs, double Random01);

	/** Basit HTTP/1.1 yanıtı (loopback sayfası). */
	std::string HttpResponse(int Status, const std::string& Reason, const std::string& ContentType, const std::string& Body);

	/** Kimlik yol parçası: `@me` olduğu gibi, diğerleri UrlEncode. */
	std::string PathSegment(const std::string& Id);
}
