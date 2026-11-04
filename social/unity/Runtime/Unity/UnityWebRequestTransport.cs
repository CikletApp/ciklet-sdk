using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine.Networking;

namespace Ciklet.Social.Unity
{
    /// <summary>
    /// UnityWebRequest tabanlı taşıyıcı (her platform, WebGL dahil). UnityWebRequest
    /// yalnızca ana iş parçacığında kullanılabildiği için istek, nesnenin oluşturulduğu
    /// (ana) iş parçacığının SynchronizationContext'ine aktarılır — SDK çekirdeği
    /// `ConfigureAwait(false)` kullandığından çağrı arka plandan gelebilir.
    /// Bu nesneyi ana iş parçacığında oluşturun (ör. Awake/Start).
    /// </summary>
    public sealed class UnityWebRequestTransport : IHttpTransport
    {
        private readonly SynchronizationContext _main;

        public UnityWebRequestTransport()
        {
            _main = SynchronizationContext.Current ??
                    throw new InvalidOperationException("UnityWebRequestTransport ana iş parçacığında oluşturulmalı.");
        }

        public Task<HttpResponseData> SendAsync(HttpRequestSpec request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var tcs = new TaskCompletionSource<HttpResponseData>(TaskCreationOptions.RunContinuationsAsynchronously);
            if (SynchronizationContext.Current == _main) Start(request, tcs, cancellationToken);
            else _main.Post(_ => Start(request, tcs, cancellationToken), null);
            return tcs.Task;
        }

        private void Start(HttpRequestSpec request, TaskCompletionSource<HttpResponseData> tcs, CancellationToken cancellationToken)
        {
            if (cancellationToken.IsCancellationRequested) { tcs.TrySetCanceled(cancellationToken); return; }
            var uwr = new UnityWebRequest(request.Url, request.Method)
            {
                downloadHandler = new DownloadHandlerBuffer(),
                // UnityWebRequest.timeout saniye (tam sayı); 0 = sınırsız.
                timeout = Math.Max(1, (int)Math.Ceiling(request.Timeout.TotalSeconds)),
            };
            if (request.Body != null)
            {
                uwr.uploadHandler = new UploadHandlerRaw(request.Body) { contentType = request.ContentType ?? "application/json" };
                uwr.SetRequestHeader("Content-Type", request.ContentType ?? "application/json");
            }
            foreach (var h in request.Headers)
            {
                // WebGL'de tarayıcı User-Agent'ı değiştirmeye izin vermez.
                if (string.Equals(h.Key, "User-Agent", StringComparison.OrdinalIgnoreCase) && UnityEngine.Application.platform == UnityEngine.RuntimePlatform.WebGLPlayer) continue;
                uwr.SetRequestHeader(h.Key, h.Value);
            }

            var op = uwr.SendWebRequest();
            var registration = cancellationToken.Register(() =>
            {
                // Görev hemen iptal olur; isteği ana iş parçacığında durdur.
                tcs.TrySetCanceled(cancellationToken);
                _main.Post(__ => { try { if (!op.isDone) uwr.Abort(); } catch (Exception) { /* bitti/silindi */ } }, null);
            });
            op.completed += _ =>
            {
                registration.Dispose();
                try
                {
                    if (tcs.Task.IsCompleted) return; // iptal edildi
                    if (uwr.result == UnityWebRequest.Result.ConnectionError)
                    {
                        var timedOut = uwr.error != null && uwr.error.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0;
                        tcs.TrySetException(new CikletException(
                            timedOut ? CikletErrorKind.Timeout : CikletErrorKind.Network,
                            timedOut ? "timeout" : "network_error",
                            uwr.error ?? "Bağlantı hatası"));
                        return;
                    }
                    var response = new HttpResponseData
                    {
                        Status = (int)uwr.responseCode,
                        Body = uwr.downloadHandler?.text ?? "",
                    };
                    var headers = uwr.GetResponseHeaders();
                    if (headers != null) foreach (var kv in headers) response.Headers[kv.Key] = kv.Value;
                    tcs.TrySetResult(response);
                }
                finally
                {
                    uwr.Dispose();
                }
            };
        }
    }
}
