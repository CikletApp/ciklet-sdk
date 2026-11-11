using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    /// <summary>Ortak ayarlar. Varsayılanlar canlı Ciklet'i gösterir.</summary>
    public sealed class CikletOptions
    {
        public string BaseUrl { get; set; } = "https://ciklet.xyz";
        public string GatewayUrl { get; set; } = "wss://ciklet.xyz/gateway/ws";
        /// <summary>Tek bir REST isteğinin zaman aşımı.</summary>
        public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(15);
        public string UserAgent { get; set; } = "CikletSocialSDK-Unity/" + CikletSdkInfo.Version;

        internal string Api(string path) => BaseUrl.TrimEnd('/') + "/api/v1" + path;
        internal string Root(string path) => BaseUrl.TrimEnd('/') + path;
    }

    public static class CikletSdkInfo
    {
        public const string Version = "0.1.0";
    }

    public sealed class HttpRequestSpec
    {
        public string Method { get; set; } = "GET";
        public string Url { get; set; }
        public Dictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public byte[] Body { get; set; }
        public string ContentType { get; set; }
        public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(15);
    }

    public sealed class HttpResponseData
    {
        public int Status { get; set; }
        public string Body { get; set; } = "";
        public Dictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// HTTP taşıyıcısı. Unity'de <c>UnityWebRequestTransport</c>, diğer yerlerde
    /// <see cref="HttpClientTransport"/>. Uygulama: ağ hatasında
    /// <see cref="CikletErrorKind.Network"/>, süre dolunca <see cref="CikletErrorKind.Timeout"/>,
    /// iptalde <see cref="OperationCanceledException"/> fırlatır; HTTP hata kodlarını FIRLATMAZ.
    /// </summary>
    public interface IHttpTransport
    {
        Task<HttpResponseData> SendAsync(HttpRequestSpec request, CancellationToken cancellationToken);
    }

    /// <summary>System.Net.Http tabanlı taşıyıcı (oyun sunucusu, araçlar, testler; WebGL dışı Unity).</summary>
    public sealed class HttpClientTransport : IHttpTransport
    {
        private readonly HttpClient _client;

        public HttpClientTransport(HttpClient client = null)
        {
            _client = client ?? new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
        }

        public async Task<HttpResponseData> SendAsync(HttpRequestSpec request, CancellationToken cancellationToken)
        {
            using (var timeout = new CancellationTokenSource(request.Timeout))
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token))
            using (var message = new HttpRequestMessage(new HttpMethod(request.Method), request.Url))
            {
                foreach (var h in request.Headers)
                {
                    if (!message.Headers.TryAddWithoutValidation(h.Key, h.Value))
                        throw new ArgumentException("Geçersiz başlık: " + h.Key);
                }
                if (request.Body != null)
                {
                    message.Content = new ByteArrayContent(request.Body);
                    message.Content.Headers.TryAddWithoutValidation("Content-Type", request.ContentType ?? "application/json");
                }
                try
                {
                    using (var response = await _client.SendAsync(message, linked.Token).ConfigureAwait(false))
                    {
                        var result = new HttpResponseData
                        {
                            Status = (int)response.StatusCode,
                            Body = await response.Content.ReadAsStringAsync().ConfigureAwait(false),
                        };
                        foreach (var h in response.Headers.Concat(response.Content.Headers))
                            result.Headers[h.Key] = string.Join(",", h.Value);
                        return result;
                    }
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (OperationCanceledException e)
                {
                    throw new CikletException(CikletErrorKind.Timeout, "timeout", "İstek zaman aşımına uğradı: " + request.Url, inner: e);
                }
                catch (HttpRequestException e)
                {
                    throw new CikletException(CikletErrorKind.Network, "network_error", e.Message, inner: e);
                }
            }
        }
    }

    internal static class CikletHttp
    {
        public static byte[] Json(object body) => Encoding.UTF8.GetBytes(CikletJson.Serialize(body));

        public static string FormEncode(IEnumerable<KeyValuePair<string, string>> fields) =>
            string.Join("&", fields.Where(f => f.Value != null).Select(f => Uri.EscapeDataString(f.Key) + "=" + Uri.EscapeDataString(f.Value)));

        public static string Segment(string id)
        {
            if (string.IsNullOrEmpty(id)) throw new ArgumentException("Kimlik boş olamaz.");
            // EscapeDataString "." ve ".." parçalarına dokunmaz; HTTP istemcisi bunları çözer.
            if (id == "." || id == "..") throw new ArgumentException("Kimlik '.' ya da '..' olamaz.");
            return id == "@me" ? "@me" : Uri.EscapeDataString(id);
        }

        /// <summary>Yanıtı ayrıştırır; 2xx değilse sunucu hata gövdesinden <see cref="CikletException"/> üretir.</summary>
        public static object ParseOrThrow(HttpResponseData response)
        {
            object data = null;
            if (!string.IsNullOrEmpty(response.Body))
            {
                try
                {
                    data = CikletJson.Parse(response.Body);
                }
                catch (FormatException e)
                {
                    if (response.Status >= 200 && response.Status < 300)
                        throw new CikletException(CikletErrorKind.Protocol, "invalid_json", "Yanıt JSON değil.", response.Status, inner: e);
                }
            }
            if (response.Status >= 200 && response.Status < 300) return data;
            throw ErrorFrom(response, data as Dictionary<string, object>);
        }

        public static CikletException ErrorFrom(HttpResponseData response, Dictionary<string, object> err)
        {
            // Ciklet iki biçim kullanıyor: REST `{ code, message }`, OAuth `{ error, error_description }`.
            var code = CikletJson.Str(err, "code") ?? CikletJson.Str(err, "error") ?? "http_" + response.Status;
            var message = CikletJson.Str(err, "message") ?? CikletJson.Str(err, "error_description") ?? ("HTTP " + response.Status);
            double? retryAfter = CikletJson.Double(err, "retry_after");
            if (retryAfter == null && response.Headers.TryGetValue("Retry-After", out var ra) &&
                double.TryParse(ra, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed))
                retryAfter = parsed;
            var kind = response.Status == 401 ? CikletErrorKind.Auth : CikletErrorKind.Http;
            return new CikletException(kind, code, message, response.Status, retryAfter);
        }
    }
}
