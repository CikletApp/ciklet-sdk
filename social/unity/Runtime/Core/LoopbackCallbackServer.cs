using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    public sealed class LoopbackCallback
    {
        public string Code;
        public string State;
        public string Error;
        public string ErrorDescription;
    }

    /// <summary>
    /// RFC 8252 loopback geri dönüşü: yalnızca 127.0.0.1'i dinleyen tek amaçlı küçük
    /// HTTP dinleyici. HttpListener yerine TcpListener — IL2CPP ve Windows'ta yönetici
    /// izni / URL ACL istemez. Port 0 = işletim sistemi boş port verir.
    /// </summary>
    public sealed class LoopbackCallbackServer : IDisposable
    {
        private const int MaxRequestBytes = 16 * 1024;
        private readonly TcpListener _listener;
        private readonly string _path;

        private LoopbackCallbackServer(TcpListener listener, string path)
        {
            _listener = listener;
            _path = path;
        }

        public int Port => ((IPEndPoint)_listener.LocalEndpoint).Port;

        /// <summary>Ciklet'e verilecek redirect_uri, ör. `http://127.0.0.1:53412/callback`.</summary>
        public string RedirectUri => "http://127.0.0.1:" + Port + _path;

        /// <summary>Tarayıcı sekmesinde gösterilecek metin (oyununuzun diline çevirebilirsiniz).</summary>
        public string SuccessHtml { get; set; } =
            "<!doctype html><meta charset=utf-8><title>Ciklet</title><body style=\"font-family:sans-serif;text-align:center;padding:48px\">" +
            "<h2>Giriş tamamlandı</h2><p>Bu sekmeyi kapatıp oyuna dönebilirsiniz.</p></body>";

        public string ErrorHtml { get; set; } =
            "<!doctype html><meta charset=utf-8><title>Ciklet</title><body style=\"font-family:sans-serif;text-align:center;padding:48px\">" +
            "<h2>Giriş tamamlanamadı</h2><p>Oyuna dönüp yeniden deneyin.</p></body>";

        public static LoopbackCallbackServer Start(string path = "/callback", int port = 0)
        {
            if (string.IsNullOrEmpty(path) || path[0] != '/') throw new ArgumentException("Yol '/' ile başlamalı.", nameof(path));
            var listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            return new LoopbackCallbackServer(listener, path);
        }

        /// <summary>
        /// Doğru yola gelen ilk isteği bekler. Başka yollar (favicon vb.) 404 alır ve
        /// beklemeye devam edilir. `state` beklenenle eşleşmeyen geri dönüş YOK SAYILIR
        /// (başka bir sekmenin/sitenin CSRF denemesi) ve beklemeye devam edilir.
        /// </summary>
        public async Task<LoopbackCallback> WaitForCallbackAsync(string expectedState, CancellationToken cancellationToken)
        {
            using (cancellationToken.Register(() => { try { _listener.Stop(); } catch (Exception) { /* kapanıyor */ } }))
            {
                while (true)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    TcpClient client;
                    try
                    {
                        client = await _listener.AcceptTcpClientAsync().ConfigureAwait(false);
                    }
                    catch (Exception) when (cancellationToken.IsCancellationRequested)
                    {
                        throw new OperationCanceledException(cancellationToken);
                    }
                    using (client)
                    {
                        var result = await HandleAsync(client, expectedState, cancellationToken).ConfigureAwait(false);
                        if (result != null) return result;
                    }
                }
            }
        }

        private async Task<LoopbackCallback> HandleAsync(TcpClient client, string expectedState, CancellationToken cancellationToken)
        {
            var stream = client.GetStream();
            string target;
            try
            {
                target = await ReadRequestTargetAsync(stream, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (!(e is OperationCanceledException))
            {
                return null; // bozuk istek — yok say
            }
            if (target == null)
            {
                await WriteAsync(stream, 400, "Bad Request", "text/plain", "bad request").ConfigureAwait(false);
                return null;
            }

            var q = target.IndexOf('?');
            var path = q < 0 ? target : target.Substring(0, q);
            if (path != _path)
            {
                await WriteAsync(stream, 404, "Not Found", "text/plain", "not found").ConfigureAwait(false);
                return null;
            }
            var query = ParseQuery(q < 0 ? "" : target.Substring(q + 1));
            query.TryGetValue("state", out var state);
            if (expectedState != null && state != expectedState)
            {
                await WriteAsync(stream, 400, "Bad Request", "text/html; charset=utf-8", ErrorHtml).ConfigureAwait(false);
                return null;
            }
            query.TryGetValue("code", out var code);
            query.TryGetValue("error", out var error);
            query.TryGetValue("error_description", out var description);
            if (string.IsNullOrEmpty(code) && string.IsNullOrEmpty(error)) error = "invalid_callback";
            await WriteAsync(stream, 200, "OK", "text/html; charset=utf-8", error == null ? SuccessHtml : ErrorHtml).ConfigureAwait(false);
            return new LoopbackCallback { Code = code, State = state, Error = error, ErrorDescription = description };
        }

        /// <summary>İstek satırını (`GET /callback?code=… HTTP/1.1`) okur, hedefi döndürür.</summary>
        internal static async Task<string> ReadRequestTargetAsync(System.IO.Stream stream, CancellationToken cancellationToken)
        {
            var buffer = new byte[4096];
            var collected = new List<byte>();
            using (var readTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(10)))
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, readTimeout.Token))
            {
                while (collected.Count < MaxRequestBytes)
                {
                    var read = await stream.ReadAsync(buffer, 0, buffer.Length, linked.Token).ConfigureAwait(false);
                    if (read <= 0) break;
                    for (var i = 0; i < read; i++) collected.Add(buffer[i]);
                    if (IndexOfHeaderEnd(collected) >= 0) break;
                }
            }
            return ParseRequestTarget(Encoding.ASCII.GetString(collected.ToArray()));
        }

        internal static string ParseRequestTarget(string raw)
        {
            var lineEnd = raw.IndexOf("\r\n", StringComparison.Ordinal);
            var line = lineEnd < 0 ? raw : raw.Substring(0, lineEnd);
            var parts = line.Split(' ');
            if (parts.Length != 3 || parts[0] != "GET" || !parts[2].StartsWith("HTTP/1.", StringComparison.Ordinal)) return null;
            if (parts[1].Length == 0 || parts[1][0] != '/') return null;
            return parts[1];
        }

        private static int IndexOfHeaderEnd(List<byte> data)
        {
            for (var i = 3; i < data.Count; i++)
                if (data[i - 3] == '\r' && data[i - 2] == '\n' && data[i - 1] == '\r' && data[i] == '\n') return i;
            return -1;
        }

        internal static Dictionary<string, string> ParseQuery(string query)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var pair in query.Split('&'))
            {
                if (pair.Length == 0) continue;
                var eq = pair.IndexOf('=');
                var key = Decode(eq < 0 ? pair : pair.Substring(0, eq));
                var value = eq < 0 ? "" : Decode(pair.Substring(eq + 1));
                if (!result.ContainsKey(key)) result[key] = value; // ilk değer geçerli
            }
            return result;
        }

        private static string Decode(string s) => Uri.UnescapeDataString(s.Replace('+', ' '));

        private static async Task WriteAsync(System.IO.Stream stream, int status, string reason, string contentType, string body)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            var head = "HTTP/1.1 " + status + " " + reason + "\r\n" +
                       "Content-Type: " + contentType + "\r\n" +
                       "Content-Length: " + bytes.Length + "\r\n" +
                       "Cache-Control: no-store\r\n" +
                       "Referrer-Policy: no-referrer\r\n" +
                       "Connection: close\r\n\r\n";
            try
            {
                var headBytes = Encoding.ASCII.GetBytes(head);
                await stream.WriteAsync(headBytes, 0, headBytes.Length).ConfigureAwait(false);
                await stream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                await stream.FlushAsync().ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Tarayıcı bağlantıyı erken kapattıysa önemli değil.
            }
        }

        public void Dispose()
        {
            try { _listener.Stop(); } catch (Exception) { /* zaten kapalı */ }
        }
    }
}
