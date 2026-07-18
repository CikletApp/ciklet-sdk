// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — Public API
// ─────────────────────────────────────────────────────────────────

// Main SDK class
export { CikletSDK } from "./CikletSDK";

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
} from "./types";
