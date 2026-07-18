/**
 * Ciklet çekirdek alan tipleri.
 *
 * Kaynak gerçeği ciklet-web'deki Prisma şemasıdır (prisma/schema.prisma);
 * buradaki tipler onun İSTEMCİYE GİDEN halini tanımlar:
 *  - Tarihler JSON üzerinde ISO string olarak taşınır (Date değil).
 *  - Profil her zaman PublicProfile alt kümesidir; hashedPassword/email gibi
 *    alanlar API yanıtlarına asla girmez (bkz. ciklet-web profile-select.ts).
 * Şemada alan değişirse önce burası güncellenir — istemciler (mobil, desktop,
 * bot) yalnızca bu sözleşmeye yaslanır.
 */

// ── Enum'lar (Prisma şemasıyla birebir) ─────────────────────────────

export const PresenceStatus = {
  ONLINE: "ONLINE",
  IDLE: "IDLE",
  DND: "DND",
  INVISIBLE: "INVISIBLE",
  OFFLINE: "OFFLINE",
} as const;
export type PresenceStatus = (typeof PresenceStatus)[keyof typeof PresenceStatus];

export const MemberRole = {
  ADMIN: "ADMIN",
  MODERATOR: "MODERATOR",
  GUEST: "GUEST",
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const ChannelType = {
  TEXT: "TEXT",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const MessageType = {
  DEFAULT: "DEFAULT",
  CALL_MISSED: "CALL_MISSED",
  CALL_STARTED: "CALL_STARTED",
  CALL_ENDED: "CALL_ENDED",
  ACTIVITY_INVITE: "ACTIVITY_INVITE",
  ACTIVITY_REPLY: "ACTIVITY_REPLY",
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const FriendRequestStatus = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  BLOCKED: "BLOCKED",
} as const;
export type FriendRequestStatus =
  (typeof FriendRequestStatus)[keyof typeof FriendRequestStatus];

// ── Modeller ────────────────────────────────────────────────────────

/** Herkese açık profil alt kümesi (PROFILE_PUBLIC_SELECT ile birebir). */
export interface PublicProfile {
  id: string;
  username: string;
  name: string | null;
  imageUrl: string | null;
  isBot: boolean;
  bannerColor: string | null;
  pronouns: string | null;
  bio: string | null;
  createdAt: string;
  presenceStatus: PresenceStatus;
}

/** Kullanıcının KENDİ profili — auth yanıtlarında dönen genişletilmiş küme. */
export interface OwnProfile extends PublicProfile {
  isRoot: boolean;
}

export interface Server {
  id: string;
  name: string;
  imageUrl: string;
  inviteCode: string;
  profileId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  id: string;
  role: MemberRole;
  profileId: string;
  serverId: string;
  nickname: string | null;
  serverPronouns: string | null;
  serverBio: string | null;
  serverImageUrl: string | null;
  serverBannerColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberWithProfile extends Member {
  profile: PublicProfile;
}

export interface ServerWithMembers extends Server {
  members: MemberWithProfile[];
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  profileId: string;
  serverId: string;
  latestMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerWithChannels extends Server {
  channels: Channel[];
  members: MemberWithProfile[];
}

export interface Reaction {
  id: string;
  emoji: string;
  profileId: string;
  messageId: string | null;
  directMessageId: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  content: string;
  fileUrl: string | null;
  memberId: string;
  channelId: string;
  type: MessageType;
  deleted: boolean;
  /** Yapılandırılmış ekstra veri (örn. ACTIVITY_INVITE kart bilgileri). */
  metadata: Record<string, unknown> | null;
  replyToId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageWithMember extends Message {
  member: MemberWithProfile;
  reactions?: Reaction[];
  replyTo?: MessageWithMember | null;
}

export interface Direct {
  id: string;
  profileOneId: string;
  profileTwoId: string;
  latestMessageId: string | null;
}

export interface DirectWithProfiles extends Direct {
  profileOne: PublicProfile;
  profileTwo: PublicProfile;
}

export interface DirectMessage {
  id: string;
  content: string;
  fileUrl: string | null;
  profileId: string;
  directId: string;
  type: MessageType;
  deleted: boolean;
  metadata: Record<string, unknown> | null;
  replyToId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirectMessageWithProfile extends DirectMessage {
  profile: PublicProfile;
  reactions?: Reaction[];
  replyTo?: DirectMessageWithProfile | null;
}

export interface Friend {
  id: string;
  profileOneId: string;
  profileTwoId: string;
  status: FriendRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FriendWithProfiles extends Friend {
  profileOne: PublicProfile;
  profileTwo: PublicProfile;
}
