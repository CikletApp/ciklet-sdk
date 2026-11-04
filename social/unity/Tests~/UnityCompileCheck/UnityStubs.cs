// Derleme denetimi için UnityEngine stub'ları — gerçek Unity DEĞİL.
#pragma warning disable CS0067, CS1591
using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public class Object { }
    public class Component : Object { }
    public class Behaviour : Component { }
    public class MonoBehaviour : Behaviour { }
    [AttributeUsage(AttributeTargets.Field)] public sealed class SerializeField : Attribute { }
    public enum RuntimePlatform { WindowsPlayer, WebGLPlayer }
    public static class Application
    {
        public static RuntimePlatform platform => RuntimePlatform.WindowsPlayer;
        public static void OpenURL(string url) { }
    }
    public static class PlayerPrefs
    {
        public static string GetString(string key, string defaultValue) => defaultValue;
        public static void SetString(string key, string value) { }
        public static void DeleteKey(string key) { }
        public static void Save() { }
    }
    public static class Time { public static float unscaledTime => 0; }
    public static class Screen { public static int height => 0; }
    public static class Random { public static int Range(int min, int max) => min; }
    public struct Rect { public Rect(float x, float y, float w, float h) { } }
    public class GUIStyle { }
    public class GUISkin { public GUIStyle box = new GUIStyle(); }
    public static class GUI { public static GUISkin skin = new GUISkin(); }
    public sealed class GUILayoutOption { }
    public static class GUILayout
    {
        public static void BeginArea(Rect r, GUIStyle s) { }
        public static void EndArea() { }
        public static void BeginHorizontal(params GUILayoutOption[] o) { }
        public static void EndHorizontal() { }
        public static void Label(string text, params GUILayoutOption[] o) { }
        public static bool Button(string text, params GUILayoutOption[] o) => false;
        public static string TextField(string text, params GUILayoutOption[] o) => text;
        public static GUILayoutOption Width(float w) => new GUILayoutOption();
    }
    public class AsyncOperation
    {
        public bool isDone => true;
        public event Action<AsyncOperation> completed;
    }
}

namespace UnityEngine.Networking
{
    public class DownloadHandler { public string text => ""; }
    public sealed class DownloadHandlerBuffer : DownloadHandler { }
    public class UploadHandler { public string contentType { get; set; } }
    public sealed class UploadHandlerRaw : UploadHandler { public UploadHandlerRaw(byte[] data) { } }
    public sealed class UnityWebRequestAsyncOperation : AsyncOperation { }
    public sealed class UnityWebRequest : IDisposable
    {
        public enum Result { InProgress, Success, ConnectionError, ProtocolError, DataProcessingError }
        public UnityWebRequest(string url, string method) { }
        public DownloadHandler downloadHandler { get; set; }
        public UploadHandler uploadHandler { get; set; }
        public int timeout { get; set; }
        public Result result => Result.Success;
        public string error => null;
        public long responseCode => 200;
        public void SetRequestHeader(string name, string value) { }
        public Dictionary<string, string> GetResponseHeaders() => null;
        public UnityWebRequestAsyncOperation SendWebRequest() => new UnityWebRequestAsyncOperation();
        public void Abort() { }
        public void Dispose() { }
    }
}
