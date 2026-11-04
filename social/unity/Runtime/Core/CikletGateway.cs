using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Ciklet.Social
{
    public enum GatewayState
    {
        Disconnected,
        Connecting,
        Connected,
        /// <summary>Bağlantı koptu, geri çekilmeyle yeniden denenecek.</summary>
        Reconnecting,
    }

    /// <summary>Ağ geçidi için en küçük WebSocket soyutlaması (testlerde sahtesi kullanılır).</summary>
    public interface IGatewaySocket : IDisposable
    {
        Task ConnectAsync(Uri uri, IDictionary<string, string> headers, CancellationToken ct);
        Task SendTextAsync(string text, CancellationToken ct);
        /// <summary>Bir metin karesi; bağlantı kapandıysa null.</summary>
        Task<string> ReceiveTextAsync(CancellationToken ct);
        Task CloseAsync(CancellationToken ct);
    }

    /// <summary><see cref="ClientWebSocket"/> tabanlı varsayılan uygulama (WebGL dışında Unity dahil).</summary>
    public sealed class ClientWebSocketGatewaySocket : IGatewaySocket
    {
        private const int MaxFrameBytes = 1024 * 1024;
        private readonly ClientWebSocket _ws = new ClientWebSocket();
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);

        public async Task ConnectAsync(Uri uri, IDictionary<string, string> headers, CancellationToken ct)
        {
            foreach (var h in headers) _ws.Options.SetRequestHeader(h.Key, h.Value);
            await _ws.ConnectAsync(uri, ct).ConfigureAwait(false);
        }

        public async Task SendTextAsync(string text, CancellationToken ct)
        {
            var bytes = Encoding.UTF8.GetBytes(text);
            await _sendLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct).ConfigureAwait(false);
            }
            finally
            {
                _sendLock.Release();
            }
        }

        public async Task<string> ReceiveTextAsync(CancellationToken ct)
        {
            var buffer = new byte[8192];
            using (var ms = new MemoryStream())
            {
                while (true)
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct).ConfigureAwait(false);
                    if (result.MessageType == WebSocketMessageType.Close) return null;
                    ms.Write(buffer, 0, result.Count);
                    if (ms.Length > MaxFrameBytes) throw new CikletException(CikletErrorKind.Protocol, "frame_too_large", "Ağ geçidi karesi çok büyük.");
                    if (result.EndOfMessage)
                    {
                        if (result.MessageType != WebSocketMessageType.Text) { ms.SetLength(0); continue; }
                        return Encoding.UTF8.GetString(ms.ToArray());
                    }
                }
            }
        }

        public async Task CloseAsync(CancellationToken ct)
        {
            if (_ws.State == WebSocketState.Open || _ws.State == WebSocketState.CloseReceived)
                await _ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", ct).ConfigureAwait(false);
        }

        public void Dispose() => _ws.Dispose();
    }

    /// <summary>
    /// Ciklet ağ geçidi (`wss://ciklet.xyz/gateway/ws`), kullanıcı jetonuyla
    /// (`Authorization: Bearer`, `lobbies.write`): <c>lobby.*</c> olayları.
    /// 30 sn'de bir heartbeat gönderir (sunucu 60 sn sessiz bağlantıyı kapatır),
    /// kopunca üstel geri çekilme + rastgele sapmayla (1 sn → 30 sn) yeniden bağlanır.
    ///
    /// Olaylar <see cref="Connect"/>'in çağrıldığı SynchronizationContext'e gönderilir —
    /// Unity'de ana iş parçacığından çağırırsanız olay işleyicileri ana iş parçacığında çalışır.
    /// </summary>
    public sealed class CikletGateway : IDisposable
    {
        public static readonly TimeSpan DefaultHeartbeatInterval = TimeSpan.FromSeconds(30);

        private readonly Func<CancellationToken, Task<string>> _tokenProvider;
        private readonly Func<IGatewaySocket> _socketFactory;
        private readonly CikletOptions _options;
        private readonly CikletAuth _auth;
        private CancellationTokenSource _lifetime;
        private SynchronizationContext _context;
        private Task _loop;
        private GatewayState _state = GatewayState.Disconnected;

        public TimeSpan HeartbeatInterval { get; set; } = DefaultHeartbeatInterval;
        public TimeSpan ConnectTimeout { get; set; } = TimeSpan.FromSeconds(15);
        public TimeSpan MinBackoff { get; set; } = TimeSpan.FromSeconds(1);
        public TimeSpan MaxBackoff { get; set; } = TimeSpan.FromSeconds(30);
        /// <summary>Test için gecikme fonksiyonu.</summary>
        public Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = (t, ct) => Task.Delay(t, ct);
        public Func<double> Random01 { get; set; } = CreateRandom();

        public event Action<GatewayState> StateChanged;
        /// <summary>`ready` karesi (ham).</summary>
        public event Action<Dictionary<string, object>> Ready;
        public event Action<LobbyEvent> LobbyEvent;
        /// <summary>Her kare (ham) — SDK'nın tanımadığı olaylar için.</summary>
        public event Action<Dictionary<string, object>> RawFrame;
        /// <summary>Bağlantı hatası; <see cref="CikletException.IsRetryable"/> false ise yeniden denenmez.</summary>
        public event Action<CikletException> Error;

        public GatewayState State => _state;

        public CikletGateway(CikletAuth auth, Func<IGatewaySocket> socketFactory = null)
            : this(auth.GetAccessTokenAsync, auth.Options, socketFactory)
        {
            _auth = auth;
        }

        public CikletGateway(Func<CancellationToken, Task<string>> accessTokenProvider, CikletOptions options = null, Func<IGatewaySocket> socketFactory = null)
        {
            _tokenProvider = accessTokenProvider ?? throw new ArgumentNullException(nameof(accessTokenProvider));
            _options = options ?? new CikletOptions();
            _socketFactory = socketFactory ?? (() => new ClientWebSocketGatewaySocket());
        }

        /// <summary>Arka planda bağlanmayı başlatır (zaten çalışıyorsa bir şey yapmaz).</summary>
        public void Connect()
        {
            if (_loop != null && !_loop.IsCompleted) return;
            _context = SynchronizationContext.Current;
            _lifetime = new CancellationTokenSource();
            var token = _lifetime.Token;
            _loop = Task.Run(() => RunAsync(token));
        }

        /// <summary>Bağlantıyı kapatır ve yeniden denemeyi durdurur.</summary>
        public async Task DisconnectAsync()
        {
            var cts = _lifetime;
            var loop = _loop;
            if (cts == null) return;
            cts.Cancel();
            if (loop != null)
            {
                try { await loop.ConfigureAwait(false); }
                catch (OperationCanceledException) { /* beklenen */ }
            }
            SetState(GatewayState.Disconnected);
        }

        /// <summary>Geri çekilme süresi: min(üst, alt·2^deneme) × [0.5, 1.0) sapma.</summary>
        public static TimeSpan ComputeBackoff(int attempt, TimeSpan min, TimeSpan max, double random01)
        {
            var exp = Math.Min(attempt, 16);
            var ms = Math.Min(max.TotalMilliseconds, min.TotalMilliseconds * Math.Pow(2, exp));
            return TimeSpan.FromMilliseconds(ms * (0.5 + 0.5 * random01));
        }

        private async Task RunAsync(CancellationToken lifetime)
        {
            var attempt = 0;
            while (!lifetime.IsCancellationRequested)
            {
                SetState(attempt == 0 ? GatewayState.Connecting : GatewayState.Reconnecting);
                var healthy = false;
                try
                {
                    healthy = await RunOnceAsync(lifetime).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
                {
                    break;
                }
                catch (CikletException e)
                {
                    Raise(() => Error?.Invoke(e));
                    if (!e.IsRetryable && e.Kind != CikletErrorKind.Protocol) break;
                }
                catch (Exception e)
                {
                    Raise(() => Error?.Invoke(new CikletException(CikletErrorKind.Network, "gateway_error", e.Message, inner: e)));
                }
                if (lifetime.IsCancellationRequested) break;
                attempt = healthy ? 1 : attempt + 1;
                SetState(GatewayState.Reconnecting);
                try
                {
                    await Delay(ComputeBackoff(attempt - 1, MinBackoff, MaxBackoff, Random01()), lifetime).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
            SetState(GatewayState.Disconnected);
        }

        /// <summary>Tek bağlantı ömrü. `ready` alındıysa true (geri çekilme sıfırlanır).</summary>
        private async Task<bool> RunOnceAsync(CancellationToken lifetime)
        {
            var accessToken = await _tokenProvider(lifetime).ConfigureAwait(false);
            using (var socket = _socketFactory())
            using (var connection = CancellationTokenSource.CreateLinkedTokenSource(lifetime))
            {
                using (var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime))
                {
                    connectTimeout.CancelAfter(ConnectTimeout);
                    try
                    {
                        await socket.ConnectAsync(new Uri(_options.GatewayUrl), new Dictionary<string, string>
                        {
                            ["Authorization"] = "Bearer " + accessToken,
                            ["User-Agent"] = _options.UserAgent,
                        }, connectTimeout.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!lifetime.IsCancellationRequested)
                    {
                        throw new CikletException(CikletErrorKind.Timeout, "gateway_connect_timeout", "Ağ geçidine bağlanma zaman aşımı.");
                    }
                    catch (WebSocketException e)
                    {
                        // El sıkışma reddi (ör. 401) WebSocketException olarak gelir; jeton
                        // düşmüş olabilir — bir sonraki denemeden önce yenile.
                        await TryRefreshAsync(lifetime).ConfigureAwait(false);
                        throw new CikletException(CikletErrorKind.Network, "gateway_connect_failed", e.Message, inner: e);
                    }
                }

                SetState(GatewayState.Connected);
                var lastAck = DateTime.UtcNow;
                var ready = false;
                var heartbeat = HeartbeatLoopAsync(socket, () => lastAck, connection);

                try
                {
                    while (!connection.IsCancellationRequested)
                    {
                        string text;
                        try
                        {
                            text = await socket.ReceiveTextAsync(connection.Token).ConfigureAwait(false);
                        }
                        catch (OperationCanceledException) when (!lifetime.IsCancellationRequested)
                        {
                            // Heartbeat zombi bağlantı tespit etti.
                            throw new CikletException(CikletErrorKind.Timeout, "heartbeat_timeout", "Ağ geçidi yanıt vermiyor.");
                        }
                        if (text == null) break; // sunucu kapattı → yeniden bağlan

                        Dictionary<string, object> frame;
                        try { frame = CikletJson.AsObject(CikletJson.Parse(text)); }
                        catch (FormatException) { continue; }
                        if (frame == null) continue;

                        if (CikletJson.Str(frame, "type") == "error")
                        {
                            var retryable = CikletJson.Bool(frame, "retryable", true);
                            var code = CikletJson.Str(frame, "code") ?? "gateway_error";
                            var err = new CikletException(
                                retryable ? CikletErrorKind.Network : CikletErrorKind.Auth,
                                code,
                                CikletJson.Str(frame, "message") ?? "Ağ geçidi reddetti: " + code);
                            if (!retryable) throw err; // RunAsync bildirir ve durur
                            Raise(() => Error?.Invoke(err));
                            continue;
                        }

                        var eventType = CikletJson.Str(frame, "eventType");
                        Raise(() => RawFrame?.Invoke(frame));
                        if (eventType == "heartbeat.ack")
                        {
                            lastAck = DateTime.UtcNow;
                        }
                        else if (eventType == "ready")
                        {
                            ready = true;
                            lastAck = DateTime.UtcNow;
                            Raise(() => Ready?.Invoke(frame));
                        }
                        else if (eventType != null && eventType.StartsWith("lobby.", StringComparison.Ordinal))
                        {
                            var ev = Social.LobbyEvent.FromFrame(frame);
                            if (ev != null) Raise(() => LobbyEvent?.Invoke(ev));
                        }
                    }
                }
                finally
                {
                    connection.Cancel();
                    try { await heartbeat.ConfigureAwait(false); } catch (Exception) { /* bağlantıyla bitti */ }
                    try
                    {
                        using (var closeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(2)))
                            await socket.CloseAsync(closeTimeout.Token).ConfigureAwait(false);
                    }
                    catch (Exception) { /* zaten kopuk */ }
                }
                return ready;
            }
        }

        private async Task HeartbeatLoopAsync(IGatewaySocket socket, Func<DateTime> lastAck, CancellationTokenSource connection)
        {
            var token = connection.Token;
            while (!token.IsCancellationRequested)
            {
                await Delay(HeartbeatInterval, token).ConfigureAwait(false);
                // İki aralık boyunca ack gelmediyse bağlantı ölü: kes, dış döngü yeniden bağlansın.
                if (DateTime.UtcNow - lastAck() > HeartbeatInterval + HeartbeatInterval + TimeSpan.FromSeconds(5))
                {
                    connection.Cancel();
                    return;
                }
                await socket.SendTextAsync("{\"event_type\":\"heartbeat\"}", token).ConfigureAwait(false);
            }
        }

        private async Task TryRefreshAsync(CancellationToken ct)
        {
            if (_auth == null) return;
            try { await _auth.RefreshAsync(ct).ConfigureAwait(false); }
            catch (CikletException) { /* sonraki deneme tokenProvider'da Auth hatası verir */ }
        }

        private void SetState(GatewayState state)
        {
            if (_state == state) return;
            _state = state;
            Raise(() => StateChanged?.Invoke(state));
        }

        private void Raise(Action action)
        {
            var ctx = _context;
            if (ctx != null) ctx.Post(_ => SafeInvoke(action), null);
            else SafeInvoke(action);
        }

        private static void SafeInvoke(Action action)
        {
            try { action(); }
            catch (Exception) { /* kullanıcı işleyicisindeki hata bağlantıyı düşürmesin */ }
        }

        private static Func<double> CreateRandom()
        {
            var rng = new Random();
            var gate = new object();
            return () => { lock (gate) return rng.NextDouble(); };
        }

        public void Dispose()
        {
            _lifetime?.Cancel();
            _lifetime?.Dispose();
            _lifetime = null;
        }
    }
}
