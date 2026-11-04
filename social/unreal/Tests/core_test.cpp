// Motordan bağımsız çekirdeğin birim testi (Unreal gerekmez).
//   zig c++ -std=c++17 -I../CikletSocial/Source/CikletSocial/Public core_test.cpp ../CikletSocial/Source/CikletSocial/Private/CikletSocialCore.cpp -o core_test
//   (ya da g++/clang++/cl aynı dosyalarla)
#include "CikletSocialCore.h"

#include <cstdio>
#include <cstdlib>
#include <string>

static int Failures = 0;

#define CHECK_EQ(A, B)                                                                       \
	do                                                                                       \
	{                                                                                        \
		const auto _a = (A);                                                                 \
		const auto _b = (B);                                                                 \
		if (!(_a == _b))                                                                     \
		{                                                                                    \
			std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #A " == " #B);              \
			++Failures;                                                                      \
		}                                                                                    \
	} while (0)

static std::string Hex(const std::vector<uint8_t>& Bytes)
{
	static const char* D = "0123456789abcdef";
	std::string Out;
	for (uint8_t B : Bytes) { Out.push_back(D[B >> 4]); Out.push_back(D[B & 15]); }
	return Out;
}

int main()
{
	using namespace CikletCore;

	// SHA-256 FIPS 180-2 test vektörleri
	CHECK_EQ(Hex(Sha256("abc")), std::string("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
	CHECK_EQ(Hex(Sha256("")), std::string("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
	CHECK_EQ(Hex(Sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
			 std::string("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"));
	CHECK_EQ(Hex(Sha256(std::string(1000, 'a'))).size(), size_t(64));

	// PKCE — Node referansı: createHash("sha256").update("x".repeat(43)).digest("base64url")
	CHECK_EQ(PkceChallenge(std::string(43, 'x')), std::string("zAscLGbzu5_RoIHGJrob72L2-WRBpDvhUmhSN3asJqE"));
	CHECK_EQ(Base64UrlEncode({0xfb, 0xff}), std::string("-_8"));
	CHECK_EQ(Base64UrlEncode({'f'}), std::string("Zg"));
	CHECK_EQ(Base64UrlEncode({'f', 'o', 'o'}), std::string("Zm9v"));

	// URL kodlama
	CHECK_EQ(UrlEncode("http://127.0.0.1:5000/callback"), std::string("http%3A%2F%2F127.0.0.1%3A5000%2Fcallback"));
	CHECK_EQ(UrlEncode("a b~"), std::string("a%20b~"));
	CHECK_EQ(UrlEncode("\xC3\xA7"), std::string("%C3%A7")); // ç
	CHECK_EQ(UrlDecode("a%2Bb+c%zz%4"), std::string("a+b c%zz%4"));
	CHECK_EQ(BuildQuery({{"a", "1"}, {"bos", ""}, {"b", "x y"}}), std::string("a=1&b=x%20y"));

	auto Q = ParseQuery("code=a%2Bb&state=s+1&code=evil&flag");
	CHECK_EQ(Q["code"], std::string("a+b"));
	CHECK_EQ(Q["state"], std::string("s 1"));
	CHECK_EQ(Q.count("flag"), size_t(1));

	const std::string Url = BuildAuthorizeUrl("https://ciklet.xyz/", "cik_app_1", "http://127.0.0.1:5000/callback",
											  {"identify", "lobbies.write"}, "CH", "ST");
	CHECK_EQ(Url, std::string("https://ciklet.xyz/oauth/authorize?client_id=cik_app_1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback"
							  "&response_type=code&scope=identify%20lobbies.write&code_challenge=CH&code_challenge_method=S256&state=ST"));

	// Loopback istek satırı
	CHECK_EQ(ParseRequestTarget("GET /callback?code=a HTTP/1.1\r\nHost: x\r\n\r\n"), std::string("/callback?code=a"));
	CHECK_EQ(ParseRequestTarget("POST /callback HTTP/1.1\r\n\r\n"), std::string());
	CHECK_EQ(ParseRequestTarget("GET http://evil/callback HTTP/1.1\r\n\r\n"), std::string());
	CHECK_EQ(ParseRequestTarget("GET /a b HTTP/1.1\r\n"), std::string());
	CHECK_EQ(ParseRequestTarget("garbage"), std::string());
	CHECK_EQ(HasHeaderEnd("GET / HTTP/1.1\r\n\r\n"), true);
	CHECK_EQ(HasHeaderEnd("GET / HTTP/1.1\r\n"), false);

	auto R1 = EvaluateCallback("/favicon.ico", "/callback", "s");
	CHECK_EQ(R1.Outcome, 0);
	auto R2 = EvaluateCallback("/callback?code=attacker&state=wrong", "/callback", "s");
	CHECK_EQ(R2.Outcome, 1);
	auto R3 = EvaluateCallback("/callback?code=cik_ac_1&state=s", "/callback", "s");
	CHECK_EQ(R3.Outcome, 2);
	CHECK_EQ(R3.Code, std::string("cik_ac_1"));
	auto R4 = EvaluateCallback("/callback?error=access_denied&error_description=hay%C4%B1r&state=s", "/callback", "s");
	CHECK_EQ(R4.Error, std::string("access_denied"));
	CHECK_EQ(R4.ErrorDescription, std::string("hay\xC4\xB1r"));
	auto R5 = EvaluateCallback("/callback?state=s", "/callback", "s");
	CHECK_EQ(R5.Error, std::string("invalid_callback"));

	// Geri çekilme
	CHECK_EQ(BackoffMs(0, 1000, 30000, 0.0), 500.0);
	CHECK_EQ(BackoffMs(3, 1000, 30000, 1.0), 8000.0);
	CHECK_EQ(BackoffMs(10, 1000, 30000, 1.0), 30000.0);
	CHECK_EQ(BackoffMs(1 << 30, 1000, 30000, 1.0), 30000.0);
	CHECK_EQ(BackoffMs(-5, 1000, 30000, 1.0), 1000.0);

	CHECK_EQ(PathSegment("@me"), std::string("@me"));
	CHECK_EQ(PathSegment("l/1"), std::string("l%2F1"));
	CHECK_EQ(HttpResponse(404, "Not Found", "text/plain", "x").find("Content-Length: 1\r\n") != std::string::npos, true);

	if (Failures == 0) std::printf("OK — tüm çekirdek testleri geçti\n");
	return Failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
