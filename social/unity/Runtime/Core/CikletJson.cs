// Küçük, bağımlılıksız JSON okuyucu/yazıcı.
//
// Unity'nin JsonUtility'si sözlük (metadata, stats) ve kök dizi okuyamıyor;
// Newtonsoft'a bağımlılık da paketi ağırlaştırıyor. Ciklet yanıtları küçük ve
// düz olduğu için bu yeterli: nesne → Dictionary<string, object>, dizi →
// List<object>, sayı → long (tam sayıysa) ya da double, metin, bool, null.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Ciklet.Social
{
    public static class CikletJson
    {
        /// <summary>JSON metnini ayrıştırır. Geçersiz girdide <see cref="FormatException"/>.</summary>
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            var parser = new Parser(json);
            parser.SkipWhitespace();
            var value = parser.ReadValue(0);
            parser.SkipWhitespace();
            if (!parser.AtEnd) throw new FormatException("JSON sonunda fazladan karakter var.");
            return value;
        }

        public static string Serialize(object value)
        {
            var sb = new StringBuilder();
            Write(sb, value);
            return sb.ToString();
        }

        // ── Okuma yardımcıları (alan yoksa ya da türü farklıysa varsayılan döner) ──

        public static Dictionary<string, object> AsObject(object value) => value as Dictionary<string, object>;
        public static List<object> AsArray(object value) => value as List<object>;

        public static Dictionary<string, object> Obj(IDictionary<string, object> d, string key) =>
            d != null && d.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;

        public static List<object> Arr(IDictionary<string, object> d, string key) =>
            d != null && d.TryGetValue(key, out var v) ? v as List<object> : null;

        public static string Str(IDictionary<string, object> d, string key)
        {
            if (d == null || !d.TryGetValue(key, out var v) || v == null) return null;
            if (v is string s) return s;
            if (v is long l) return l.ToString(CultureInfo.InvariantCulture);
            if (v is double db) return db.ToString("R", CultureInfo.InvariantCulture);
            if (v is bool b) return b ? "true" : "false";
            return null;
        }

        public static long Long(IDictionary<string, object> d, string key, long fallback = 0)
        {
            if (d == null || !d.TryGetValue(key, out var v) || v == null) return fallback;
            if (v is long l) return l;
            if (v is double db) return (long)db;
            if (v is string s && long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var p)) return p;
            return fallback;
        }

        public static double? Double(IDictionary<string, object> d, string key)
        {
            if (d == null || !d.TryGetValue(key, out var v) || v == null) return null;
            if (v is long l) return l;
            if (v is double db) return db;
            return null;
        }

        public static bool Bool(IDictionary<string, object> d, string key, bool fallback = false) =>
            d != null && d.TryGetValue(key, out var v) && v is bool b ? b : fallback;

        /// <summary>Metin→metin sözlük (lobi metadata'sı). Metin olmayan değerler atlanır.</summary>
        public static Dictionary<string, string> StringMap(IDictionary<string, object> d, string key)
        {
            var result = new Dictionary<string, string>();
            var obj = Obj(d, key);
            if (obj == null) return result;
            foreach (var kv in obj)
            {
                if (kv.Value is string s) result[kv.Key] = s;
            }
            return result;
        }

        // ── Yazma ──

        private static void Write(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null:
                    sb.Append("null");
                    return;
                case string s:
                    WriteString(sb, s);
                    return;
                case bool b:
                    sb.Append(b ? "true" : "false");
                    return;
                case int i:
                    sb.Append(i.ToString(CultureInfo.InvariantCulture));
                    return;
                case long l:
                    sb.Append(l.ToString(CultureInfo.InvariantCulture));
                    return;
                case float f:
                    WriteDouble(sb, f);
                    return;
                case double d:
                    WriteDouble(sb, d);
                    return;
                case decimal m:
                    sb.Append(m.ToString(CultureInfo.InvariantCulture));
                    return;
                case DateTime dt:
                    WriteString(sb, dt.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
                    return;
                case DateTimeOffset dto:
                    WriteString(sb, dto.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture));
                    return;
                case IDictionary dict:
                {
                    sb.Append('{');
                    var first = true;
                    foreach (DictionaryEntry entry in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        WriteString(sb, Convert.ToString(entry.Key, CultureInfo.InvariantCulture));
                        sb.Append(':');
                        Write(sb, entry.Value);
                    }
                    sb.Append('}');
                    return;
                }
                case IEnumerable list:
                {
                    sb.Append('[');
                    var first = true;
                    foreach (var item in list)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        Write(sb, item);
                    }
                    sb.Append(']');
                    return;
                }
                default:
                    if (value is IJsonWritable writable)
                    {
                        Write(sb, writable.ToJsonValue());
                        return;
                    }
                    if (value.GetType().IsPrimitive)
                    {
                        sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                        return;
                    }
                    throw new ArgumentException("JSON'a yazılamayan tür: " + value.GetType().FullName);
            }
        }

        private static void WriteDouble(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) throw new ArgumentException("NaN/Infinity JSON'da yok.");
            sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        // U+2028/2029 JS'te satır sonu; HTML içine gömülse bile güvenli kalsın.
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        private sealed class Parser
        {
            private const int MaxDepth = 64;
            private readonly string _s;
            private int _i;

            public Parser(string s) { _s = s; }

            public bool AtEnd => _i >= _s.Length;

            public void SkipWhitespace()
            {
                while (_i < _s.Length && (_s[_i] == ' ' || _s[_i] == '\t' || _s[_i] == '\n' || _s[_i] == '\r')) _i++;
            }

            private FormatException Error(string message) => new FormatException(message + " (konum " + _i + ")");

            public object ReadValue(int depth)
            {
                if (depth > MaxDepth) throw Error("JSON çok derin.");
                if (AtEnd) throw Error("Beklenmeyen JSON sonu.");
                var c = _s[_i];
                switch (c)
                {
                    case '{': return ReadObject(depth);
                    case '[': return ReadArray(depth);
                    case '"': return ReadString();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw Error("Beklenmeyen karakter '" + c + "'.");
                }
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0) throw Error("'" + word + "' bekleniyordu.");
                _i += word.Length;
            }

            private Dictionary<string, object> ReadObject(int depth)
            {
                var result = new Dictionary<string, object>();
                _i++; // {
                SkipWhitespace();
                if (!AtEnd && _s[_i] == '}') { _i++; return result; }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || _s[_i] != '"') throw Error("Nesne anahtarı bekleniyordu.");
                    var key = ReadString();
                    SkipWhitespace();
                    if (AtEnd || _s[_i] != ':') throw Error("':' bekleniyordu.");
                    _i++;
                    SkipWhitespace();
                    result[key] = ReadValue(depth + 1);
                    SkipWhitespace();
                    if (AtEnd) throw Error("Nesne kapanmadı.");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == '}') { _i++; return result; }
                    throw Error("',' ya da '}' bekleniyordu.");
                }
            }

            private List<object> ReadArray(int depth)
            {
                var result = new List<object>();
                _i++; // [
                SkipWhitespace();
                if (!AtEnd && _s[_i] == ']') { _i++; return result; }
                while (true)
                {
                    SkipWhitespace();
                    result.Add(ReadValue(depth + 1));
                    SkipWhitespace();
                    if (AtEnd) throw Error("Dizi kapanmadı.");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == ']') { _i++; return result; }
                    throw Error("',' ya da ']' bekleniyordu.");
                }
            }

            private string ReadString()
            {
                _i++; // "
                var sb = new StringBuilder();
                while (true)
                {
                    if (AtEnd) throw Error("Metin kapanmadı.");
                    var c = _s[_i++];
                    if (c == '"') return sb.ToString();
                    if (c == '\\')
                    {
                        if (AtEnd) throw Error("Kaçış dizisi yarım.");
                        var e = _s[_i++];
                        switch (e)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (_i + 4 > _s.Length) throw Error("\\u kaçışı yarım.");
                                if (!int.TryParse(_s.Substring(_i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code))
                                    throw Error("Geçersiz \\u kaçışı.");
                                sb.Append((char)code);
                                _i += 4;
                                break;
                            default:
                                throw Error("Geçersiz kaçış '\\" + e + "'.");
                        }
                    }
                    else
                    {
                        if (c < 0x20) throw Error("Metinde kaçışsız denetim karakteri.");
                        sb.Append(c);
                    }
                }
            }

            private object ReadNumber()
            {
                var start = _i;
                if (_s[_i] == '-') _i++;
                var isFloat = false;
                while (_i < _s.Length)
                {
                    var c = _s[_i];
                    if (c >= '0' && c <= '9') { _i++; continue; }
                    if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') { isFloat = true; _i++; continue; }
                    break;
                }
                var text = _s.Substring(start, _i - start);
                if (!isFloat && long.TryParse(text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var l)) return l;
                if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return d;
                throw Error("Geçersiz sayı '" + text + "'.");
            }
        }
    }

    /// <summary>Kendi JSON değerini (sözlük/dizi/ilkel) üreten modeller.</summary>
    public interface IJsonWritable
    {
        object ToJsonValue();
    }
}
