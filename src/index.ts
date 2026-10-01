// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — Public API
// ─────────────────────────────────────────────────────────────────

// Main SDK class
export { CikletSDK, RPCError, DEFAULT_COMMAND_TIMEOUT_MS, type CikletSDKOptions } from "./CikletSDK.js";

// Types
export {
  // Enums
  RPCCloseCodes,
  RPCCommands,
  RPCEvents,
  Orientation,
  LayoutMode,
  ThermalState,
  Platform,

  // Interfaces
  type User,
  type Channel,
  type Participant,
  type AuthorizeInput,
  type AuthorizeResponse,
  type AuthenticateInput,
  type AuthenticateResponse,
  type GetChannelInput,
  type GetChannelResponse,
  type GetInstanceConnectedParticipantsResponse,
  type SetActivityInput,
  type FetchExternalInput,
  type FetchExternalResponse,
  type OpenExternalLinkInput,
  type SetConfigInput,
  type SetConfigResponse,
  type CaptureLogInput,
  type GetPlatformBehaviorsResponse,
  type UserSettingsGetLocaleResponse,
  type RPCMessage,
  type ReadyPayload,
  type EventPayloadMap,
  type ActivityInstanceParticipantsUpdatePayload,
  type ActivityLayoutModeUpdatePayload,
  type OrientationUpdatePayload,
  type ThermalStateUpdatePayload,
  type CurrentUserUpdatePayload,
  type ErrorPayload,
  type ActivityMetadata,
} from "./types.js";
