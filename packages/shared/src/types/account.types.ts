export type AccountStatus =
  "loading" | "signed_out" | "signed_in" | "guest" | "verification_required" | "unavailable";

export interface AccountProfile {
  userId: string;
  username: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
}

export interface AccountSnapshot {
  status: AccountStatus;
  configured: boolean;
  guestAllowed: boolean;
  /** True only while the relay explicitly permits access-token auth over a development ws/http link. */
  developmentConnection?: boolean;
  profile?: AccountProfile;
  guestId?: string;
  message?: string;
}

export interface AccountLoginRequest {
  identifier: string;
  password: string;
}

export interface AccountRegisterRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  avatarDataUrl?: string;
}

export interface AccountPasswordResetRequest {
  email: string;
}

export interface AccountProfileUpdateRequest {
  displayName: string;
}

export interface AccountAvatarUpdateRequest {
  dataUrl: string;
}
