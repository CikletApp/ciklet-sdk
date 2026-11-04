using System;
using System.Collections.Generic;
using System.Linq;

namespace Ciklet.Social
{
    /// <summary>`GET /users/@me` (Discord kullanıcı nesnesi biçimi).</summary>
    public sealed class CikletUser
    {
        public string Id;
        public string Username;
        public string GlobalName;
        public string Avatar;
        public string Banner;
        public bool Bot;
        /// <summary>Yalnızca `email` kapsamıyla.</summary>
        public string Email;
        public Dictionary<string, object> Raw;

        /// <summary>Gösterilecek ad: görünen ad yoksa kullanıcı adı.</summary>
        public string DisplayName => string.IsNullOrEmpty(GlobalName) ? Username : GlobalName;

        public static CikletUser FromJson(Dictionary<string, object> d)
        {
            if (d == null) return null;
            return new CikletUser
            {
                Id = CikletJson.Str(d, "id"),
                Username = CikletJson.Str(d, "username"),
                GlobalName = CikletJson.Str(d, "global_name"),
                Avatar = CikletJson.Str(d, "avatar"),
                Banner = CikletJson.Str(d, "banner"),
                Bot = CikletJson.Bool(d, "bot"),
                Email = CikletJson.Str(d, "email"),
                Raw = d,
            };
        }
    }

    public enum RelationshipType
    {
        None = 0,
        Friend = 1,
        Blocked = 2,
        IncomingRequest = 3,
        OutgoingRequest = 4,
    }

    /// <summary>`GET /users/@me/relationships` öğesi (`relationships.read`).</summary>
    public sealed class CikletRelationship
    {
        public string Id;
        public RelationshipType Type;
        public string Nickname;
        public CikletUser User;
        public string Since;

        public static CikletRelationship FromJson(Dictionary<string, object> d) => new CikletRelationship
        {
            Id = CikletJson.Str(d, "id"),
            Type = (RelationshipType)CikletJson.Long(d, "type"),
            Nickname = CikletJson.Str(d, "nickname"),
            User = CikletUser.FromJson(CikletJson.Obj(d, "user")),
            Since = CikletJson.Str(d, "since"),
        };
    }

    public enum ActivityType
    {
        Playing = 0,
        Streaming = 1,
        Listening = 2,
        Watching = 3,
        Competing = 5,
    }

    /// <summary>
    /// Kullanıcının profilinde görünen etkinlik (`activities.write`, headless session).
    /// Etkinliğin adı her zaman uygulamanızın adıdır.
    /// </summary>
    public sealed class CikletActivity : IJsonWritable
    {
        public ActivityType Type = ActivityType.Playing;
        public string Details;
        public string State;
        /// <summary>Başlangıç (Unix saniye). Boşsa süre gösterilmez.</summary>
        public long? StartTimestamp;
        /// <summary>https görsel adresleri.</summary>
        public string LargeImage;
        public string SmallImage;

        public object ToJsonValue()
        {
            var d = new Dictionary<string, object> { ["type"] = (int)Type };
            if (Details != null) d["details"] = Details;
            if (State != null) d["state"] = State;
            if (StartTimestamp != null) d["timestamps"] = new Dictionary<string, object> { ["start"] = StartTimestamp.Value };
            var assets = new Dictionary<string, object>();
            if (LargeImage != null) assets["large_image"] = LargeImage;
            if (SmallImage != null) assets["small_image"] = SmallImage;
            if (assets.Count > 0) d["assets"] = assets;
            return d;
        }
    }

    /// <summary>Lobi üye bayrakları (Discord LobbyMemberFlags).</summary>
    [Flags]
    public enum LobbyMemberFlags
    {
        None = 0,
        CanLinkLobby = 1,
    }

    public sealed class LobbyMember
    {
        public string Id;
        public Dictionary<string, string> Metadata = new Dictionary<string, string>();
        public LobbyMemberFlags Flags;

        public static LobbyMember FromJson(Dictionary<string, object> d) => d == null ? null : new LobbyMember
        {
            Id = CikletJson.Str(d, "id"),
            Metadata = CikletJson.StringMap(d, "metadata"),
            Flags = (LobbyMemberFlags)CikletJson.Long(d, "flags"),
        };
    }

    public sealed class LinkedChannel
    {
        public string Id;
        public string Name;
        public string GuildId;
    }

    public sealed class CikletLobby
    {
        public string Id;
        public string ApplicationId;
        public Dictionary<string, string> Metadata = new Dictionary<string, string>();
        public List<LobbyMember> Members = new List<LobbyMember>();
        public int IdleTimeoutSeconds;
        public LinkedChannel LinkedChannel;

        public static CikletLobby FromJson(Dictionary<string, object> d)
        {
            if (d == null) return null;
            var linked = CikletJson.Obj(d, "linked_channel");
            return new CikletLobby
            {
                Id = CikletJson.Str(d, "id"),
                ApplicationId = CikletJson.Str(d, "application_id"),
                Metadata = CikletJson.StringMap(d, "metadata"),
                Members = (CikletJson.Arr(d, "members") ?? new List<object>())
                    .Select(m => LobbyMember.FromJson(m as Dictionary<string, object>))
                    .Where(m => m != null)
                    .ToList(),
                IdleTimeoutSeconds = (int)CikletJson.Long(d, "idle_timeout_seconds"),
                LinkedChannel = linked == null ? null : new LinkedChannel
                {
                    Id = CikletJson.Str(linked, "id"),
                    Name = CikletJson.Str(linked, "name"),
                    GuildId = CikletJson.Str(linked, "guild_id"),
                },
            };
        }
    }

    public sealed class LobbyMessage
    {
        public string Id;
        public string LobbyId;
        public string ChannelId;
        public string ApplicationId;
        public string Content;
        /// <summary>Bot ya da sistem mesajında yazar null olabilir.</summary>
        public CikletUser Author;
        public Dictionary<string, string> Metadata = new Dictionary<string, string>();
        public string Timestamp;

        public static LobbyMessage FromJson(Dictionary<string, object> d) => d == null ? null : new LobbyMessage
        {
            Id = CikletJson.Str(d, "id"),
            LobbyId = CikletJson.Str(d, "lobby_id"),
            ChannelId = CikletJson.Str(d, "channel_id"),
            ApplicationId = CikletJson.Str(d, "application_id"),
            Content = CikletJson.Str(d, "content"),
            Author = CikletUser.FromJson(CikletJson.Obj(d, "author")),
            Metadata = CikletJson.StringMap(d, "metadata"),
            Timestamp = CikletJson.Str(d, "timestamp"),
        };
    }

    /// <summary>
    /// Lobi sesli sohbeti: LiveKit sunucu adresi + oda jetonu. Sesi LiveKit'in
    /// kendi Unity/Unreal SDK'sıyla bağlayın (`Url`, `Token`).
    /// </summary>
    public sealed class LobbyVoiceInfo
    {
        public string Token;
        public string Url;
        public string RoomName;
        public string Identity;

        public static LobbyVoiceInfo FromJson(Dictionary<string, object> d) => new LobbyVoiceInfo
        {
            Token = CikletJson.Str(d, "token"),
            Url = CikletJson.Str(d, "url"),
            RoomName = CikletJson.Str(d, "room_name"),
            Identity = CikletJson.Str(d, "identity"),
        };
    }

    /// <summary>Profil oyun istatistikleri: değerler long/double (tür 1), string (tür 2 ve 3 = ISO 8601).</summary>
    public sealed class GameStats
    {
        public Dictionary<string, object> Stats = new Dictionary<string, object>();
        public string UpdatedAt;

        public static GameStats FromJson(Dictionary<string, object> d) => new GameStats
        {
            Stats = CikletJson.Obj(d, "stats") ?? new Dictionary<string, object>(),
            UpdatedAt = CikletJson.Str(d, "updated_at"),
        };
    }

    public enum GameStatType
    {
        Number = 1,
        Text = 2,
        Date = 3,
    }

    /// <summary>Oyun istatistiği şeması alanı (bot jetonu).</summary>
    public sealed class GameStatField : IJsonWritable
    {
        public string Key;
        public string Name;
        public GameStatType Type;
        public Dictionary<string, string> NameLocalizations;

        public object ToJsonValue()
        {
            var d = new Dictionary<string, object> { ["key"] = Key, ["name"] = Name, ["type"] = (int)Type };
            if (NameLocalizations != null && NameLocalizations.Count > 0) d["name_localizations"] = NameLocalizations;
            return d;
        }

        public static GameStatField FromJson(Dictionary<string, object> d) => new GameStatField
        {
            Key = CikletJson.Str(d, "key"),
            Name = CikletJson.Str(d, "name"),
            Type = (GameStatType)CikletJson.Long(d, "type"),
            NameLocalizations = CikletJson.StringMap(d, "name_localizations"),
        };
    }

    /// <summary>Ağ geçidinden gelen `lobby.*` olayı.</summary>
    public sealed class LobbyEvent
    {
        /// <summary>Discord adı: LOBBY_CREATE, LOBBY_UPDATE, LOBBY_DELETE, LOBBY_MEMBER_ADD, LOBBY_MEMBER_UPDATE, LOBBY_MEMBER_REMOVE, LOBBY_MESSAGE_CREATE.</summary>
        public string Type;
        /// <summary>Ciklet adı (`lobby.message_create`…).</summary>
        public string EventType;
        public string LobbyId;
        /// <summary>LOBBY_CREATE / LOBBY_UPDATE.</summary>
        public CikletLobby Lobby;
        /// <summary>LOBBY_MEMBER_*; REMOVE'da yalnızca Id dolu.</summary>
        public LobbyMember Member;
        /// <summary>LOBBY_MESSAGE_CREATE.</summary>
        public LobbyMessage Message;
        public Dictionary<string, object> Raw;

        public static LobbyEvent FromFrame(Dictionary<string, object> frame)
        {
            var eventType = CikletJson.Str(frame, "eventType");
            if (eventType == null || !eventType.StartsWith("lobby.", StringComparison.Ordinal)) return null;
            var d = CikletJson.Obj(frame, "d") ?? new Dictionary<string, object>();
            var ev = new LobbyEvent
            {
                EventType = eventType,
                Type = CikletJson.Str(frame, "t") ?? eventType.Replace('.', '_').ToUpperInvariant(),
                Raw = frame,
            };
            switch (ev.Type)
            {
                case "LOBBY_CREATE":
                case "LOBBY_UPDATE":
                    ev.Lobby = CikletLobby.FromJson(d);
                    ev.LobbyId = ev.Lobby?.Id;
                    break;
                case "LOBBY_DELETE":
                    ev.LobbyId = CikletJson.Str(d, "id");
                    break;
                case "LOBBY_MEMBER_ADD":
                case "LOBBY_MEMBER_UPDATE":
                case "LOBBY_MEMBER_REMOVE":
                    ev.LobbyId = CikletJson.Str(d, "lobby_id");
                    ev.Member = LobbyMember.FromJson(CikletJson.Obj(d, "member"));
                    break;
                case "LOBBY_MESSAGE_CREATE":
                    ev.Message = LobbyMessage.FromJson(d);
                    ev.LobbyId = ev.Message?.LobbyId;
                    break;
            }
            return ev;
        }
    }
}
