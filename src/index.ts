// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — Public API
// ─────────────────────────────────────────────────────────────────

// Main SDK class
export {
  CikletSDK,
  RPCError,
  DEFAULT_COMMAND_TIMEOUT_MS,
  SAFE_AREA_CSS_VARIABLES,
  type CikletSDKOptions,
} from "./CikletSDK.js";

// Discord-compatible URL mapping helper
export {
  patchUrlMappings,
  attemptRemap,
  matchAndRewriteURL,
  PROXY_PATH_PREFIX,
  type Mapping,
  type PatchUrlMappingsConfig,
} from "./utils/url-mappings.js";

// Types
export {
  // Enums
  RPCCloseCodes,
  RPCCommands,
  RPCErrorCodes,
  RPCEvents,
  Orientation,
  LayoutMode,
  ThermalState,
  Platform,
  ActivityType,

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
  type Activity,
  type LaunchContext,
  type FetchExternalInput,
  type FetchExternalResponse,
  type OpenExternalLinkInput,
  type OpenInviteDialogResponse,
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
  type VisibilityUpdatePayload,
  type SafeAreaInsetsUpdatePayload,
  type ErrorPayload,
  type ActivityMetadata,
} from "./types.js";
