// Motordan bağımsız çekirdek — bkz. CikletSocialCore.h
#include "CikletSocialCore.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace CikletCore
{
	namespace
	{
		bool IsUnreserved(unsigned char C)
		{
			return (C >= 'A' && C <= 'Z') || (C >= 'a' && C <= 'z') || (C >= '0' && C <= '9') || C == '-' || C == '.' || C == '_' || C == '~';
		}

		int HexValue(char C)
		{
			if (C >= '0' && C <= '9') return C - '0';
			if (C >= 'a' && C <= 'f') return C - 'a' + 10;
			if (C >= 'A' && C <= 'F') return C - 'A' + 10;
			return -1;
		}

		// ── SHA-256 (FIPS 180-4) ──
		const uint32_t K[64] = {
			0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
			0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
			0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
			0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
			0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
			0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
			0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
			0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

		inline uint32_t Rotr(uint32_t X, uint32_t N) { return (X >> N) | (X << (32 - N)); }
	}

	std::string UrlEncode(const std::string& Value)
	{
		static const char* Hex = "0123456789ABCDEF";
		std::string Out;
		Out.reserve(Value.size() * 3);
		for (unsigned char C : Value)
		{
			if (IsUnreserved(C))
			{
				Out.push_back(static_cast<char>(C));
			}
			else
			{
				Out.push_back('%');
				Out.push_back(Hex[C >> 4]);
				Out.push_back(Hex[C & 0x0F]);
			}
		}
		return Out;
	}

	std::string UrlDecode(const std::string& Value)
	{
		std::string Out;
		Out.reserve(Value.size());
		for (size_t I = 0; I < Value.size(); ++I)
		{
			const char C = Value[I];
			if (C == '+')
			{
				Out.push_back(' ');
			}
			else if (C == '%' && I + 2 < Value.size() && HexValue(Value[I + 1]) >= 0 && HexValue(Value[I + 2]) >= 0)
			{
				Out.push_back(static_cast<char>(HexValue(Value[I + 1]) * 16 + HexValue(Value[I + 2])));
				I += 2;
			}
			else
			{
				Out.push_back(C);
			}
		}
		return Out;
	}

	std::string BuildQuery(const std::vector<std::pair<std::string, std::string>>& Fields)
	{
		std::string Out;
		for (const auto& Field : Fields)
		{
			if (Field.second.empty()) continue;
			if (!Out.empty()) Out.push_back('&');
			Out += UrlEncode(Field.first);
			Out.push_back('=');
			Out += UrlEncode(Field.second);
		}
		return Out;
	}

	std::map<std::string, std::string> ParseQuery(const std::string& Query)
	{
		std::map<std::string, std::string> Out;
		size_t Start = 0;
		while (Start <= Query.size())
		{
			size_t End = Query.find('&', Start);
			if (End == std::string::npos) End = Query.size();
			const std::string Pair = Query.substr(Start, End - Start);
			if (!Pair.empty())
			{
				const size_t Eq = Pair.find('=');
				const std::string Key = UrlDecode(Eq == std::string::npos ? Pair : Pair.substr(0, Eq));
				const std::string Val = Eq == std::string::npos ? std::string() : UrlDecode(Pair.substr(Eq + 1));
				Out.emplace(Key, Val); // emplace: ilk değer kalır
			}
			Start = End + 1;
		}
		return Out;
	}

	std::vector<uint8_t> Sha256(const std::string& Data)
	{
		uint32_t H[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
		std::vector<uint8_t> Msg(Data.begin(), Data.end());
		const uint64_t BitLen = static_cast<uint64_t>(Msg.size()) * 8;
		Msg.push_back(0x80);
		while (Msg.size() % 64 != 56) Msg.push_back(0);
		for (int I = 7; I >= 0; --I) Msg.push_back(static_cast<uint8_t>(BitLen >> (I * 8)));

		uint32_t W[64];
		for (size_t Chunk = 0; Chunk < Msg.size(); Chunk += 64)
		{
			for (int I = 0; I < 16; ++I)
			{
				W[I] = (uint32_t(Msg[Chunk + I * 4]) << 24) | (uint32_t(Msg[Chunk + I * 4 + 1]) << 16) |
					   (uint32_t(Msg[Chunk + I * 4 + 2]) << 8) | uint32_t(Msg[Chunk + I * 4 + 3]);
			}
			for (int I = 16; I < 64; ++I)
			{
				const uint32_t S0 = Rotr(W[I - 15], 7) ^ Rotr(W[I - 15], 18) ^ (W[I - 15] >> 3);
				const uint32_t S1 = Rotr(W[I - 2], 17) ^ Rotr(W[I - 2], 19) ^ (W[I - 2] >> 10);
				W[I] = W[I - 16] + S0 + W[I - 7] + S1;
			}
			uint32_t A = H[0], B = H[1], C = H[2], D = H[3], E = H[4], F = H[5], G = H[6], Hh = H[7];
			for (int I = 0; I < 64; ++I)
			{
				const uint32_t S1 = Rotr(E, 6) ^ Rotr(E, 11) ^ Rotr(E, 25);
				const uint32_t Ch = (E & F) ^ (~E & G);
				const uint32_t T1 = Hh + S1 + Ch + K[I] + W[I];
				const uint32_t S0 = Rotr(A, 2) ^ Rotr(A, 13) ^ Rotr(A, 22);
				const uint32_t Maj = (A & B) ^ (A & C) ^ (B & C);
				const uint32_t T2 = S0 + Maj;
				Hh = G; G = F; F = E; E = D + T1; D = C; C = B; B = A; A = T1 + T2;
			}
			H[0] += A; H[1] += B; H[2] += C; H[3] += D; H[4] += E; H[5] += F; H[6] += G; H[7] += Hh;
		}
		std::vector<uint8_t> Out(32);
		for (int I = 0; I < 8; ++I)
		{
			Out[I * 4] = static_cast<uint8_t>(H[I] >> 24);
			Out[I * 4 + 1] = static_cast<uint8_t>(H[I] >> 16);
			Out[I * 4 + 2] = static_cast<uint8_t>(H[I] >> 8);
			Out[I * 4 + 3] = static_cast<uint8_t>(H[I]);
		}
		return Out;
	}

	std::string Base64UrlEncode(const std::vector<uint8_t>& Bytes)
	{
		static const char* Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		std::string Out;
		size_t I = 0;
		for (; I + 2 < Bytes.size(); I += 3)
		{
			const uint32_t N = (uint32_t(Bytes[I]) << 16) | (uint32_t(Bytes[I + 1]) << 8) | Bytes[I + 2];
			Out.push_back(Alphabet[(N >> 18) & 63]);
			Out.push_back(Alphabet[(N >> 12) & 63]);
			Out.push_back(Alphabet[(N >> 6) & 63]);
			Out.push_back(Alphabet[N & 63]);
		}
		const size_t Rest = Bytes.size() - I;
		if (Rest == 1)
		{
			const uint32_t N = uint32_t(Bytes[I]) << 16;
			Out.push_back(Alphabet[(N >> 18) & 63]);
			Out.push_back(Alphabet[(N >> 12) & 63]);
		}
		else if (Rest == 2)
		{
			const uint32_t N = (uint32_t(Bytes[I]) << 16) | (uint32_t(Bytes[I + 1]) << 8);
			Out.push_back(Alphabet[(N >> 18) & 63]);
			Out.push_back(Alphabet[(N >> 12) & 63]);
			Out.push_back(Alphabet[(N >> 6) & 63]);
		}
		return Out;
	}

	std::string PkceChallenge(const std::string& Verifier)
	{
		return Base64UrlEncode(Sha256(Verifier));
	}

	std::string BuildAuthorizeUrl(
		const std::string& BaseUrl,
		const std::string& ClientId,
		const std::string& RedirectUri,
		const std::vector<std::string>& Scopes,
		const std::string& CodeChallenge,
		const std::string& State)
	{
		std::string ScopeText;
		for (const auto& Scope : Scopes)
		{
			if (!ScopeText.empty()) ScopeText.push_back(' ');
			ScopeText += Scope;
		}
		std::string Base = BaseUrl;
		while (!Base.empty() && Base.back() == '/') Base.pop_back();
		return Base + "/oauth/authorize?" + BuildQuery({
			{"client_id", ClientId},
			{"redirect_uri", RedirectUri},
			{"response_type", "code"},
			{"scope", ScopeText},
			{"code_challenge", CodeChallenge},
			{"code_challenge_method", "S256"},
			{"state", State},
		});
	}

	std::string ParseRequestTarget(const std::string& RawRequest)
	{
		const size_t LineEnd = RawRequest.find("\r\n");
		const std::string Line = LineEnd == std::string::npos ? RawRequest : RawRequest.substr(0, LineEnd);
		const size_t S1 = Line.find(' ');
		if (S1 == std::string::npos) return {};
		const size_t S2 = Line.find(' ', S1 + 1);
		if (S2 == std::string::npos || Line.find(' ', S2 + 1) != std::string::npos) return {};
		if (Line.substr(0, S1) != "GET") return {};
		const std::string Version = Line.substr(S2 + 1);
		if (Version.rfind("HTTP/1.", 0) != 0) return {};
		const std::string Target = Line.substr(S1 + 1, S2 - S1 - 1);
		if (Target.empty() || Target[0] != '/') return {};
		return Target;
	}

	bool HasHeaderEnd(const std::string& RawRequest)
	{
		return RawRequest.find("\r\n\r\n") != std::string::npos;
	}

	FLoopbackResult EvaluateCallback(const std::string& Target, const std::string& ExpectedPath, const std::string& ExpectedState)
	{
		FLoopbackResult Result;
		const size_t Q = Target.find('?');
		const std::string Path = Q == std::string::npos ? Target : Target.substr(0, Q);
		if (Path != ExpectedPath)
		{
			Result.Outcome = 0;
			return Result;
		}
		const auto Query = ParseQuery(Q == std::string::npos ? std::string() : Target.substr(Q + 1));
		const auto Get = [&Query](const char* Key) {
			const auto It = Query.find(Key);
			return It == Query.end() ? std::string() : It->second;
		};
		if (Get("state") != ExpectedState)
		{
			Result.Outcome = 1;
			return Result;
		}
		Result.Outcome = 2;
		Result.Code = Get("code");
		Result.Error = Get("error");
		Result.ErrorDescription = Get("error_description");
		if (Result.Code.empty() && Result.Error.empty()) Result.Error = "invalid_callback";
		return Result;
	}

	double BackoffMs(int Attempt, double MinMs, double MaxMs, double Random01)
	{
		const int Exp = std::min(std::max(Attempt, 0), 16);
		const double Ms = std::min(MaxMs, MinMs * std::pow(2.0, Exp));
		return Ms * (0.5 + 0.5 * Random01);
	}

	std::string HttpResponse(int Status, const std::string& Reason, const std::string& ContentType, const std::string& Body)
	{
		return "HTTP/1.1 " + std::to_string(Status) + " " + Reason + "\r\n" +
			   "Content-Type: " + ContentType + "\r\n" +
			   "Content-Length: " + std::to_string(Body.size()) + "\r\n" +
			   "Cache-Control: no-store\r\n" +
			   "Referrer-Policy: no-referrer\r\n" +
			   "Connection: close\r\n\r\n" + Body;
	}

	std::string PathSegment(const std::string& Id)
	{
		// "." ve ".." kodlanmaz ve HTTP istemcisi bunları çözer (/lobbies/.. → /);
		// boş kimlik de bir üst uca düşer. Hiçbir kaynakla eşleşmeyen parça döndür.
		if (Id.empty() || Id == "." || Id == "..") return "_gecersiz_kimlik_";
		return Id == "@me" ? Id : UrlEncode(Id);
	}
}
