export const Features = {
  WebhooksPublicTunnel: "webhooks.publicTunnel",
  WorkspacesShared: "workspaces.shared",
  AuthSso: "auth.sso",
  HistoryRetention: "history.retention",
  MembersInvite: "members.invite",
} as const;

export type FeatureId = (typeof Features)[keyof typeof Features];

export type PlanId = "local" | "free" | "pro" | "enterprise";

export interface Entitlements {
  plan: PlanId;
  can(feature: FeatureId): boolean;
}

export const localUnlimited: Entitlements = {
  plan: "local",
  can: () => true,
};

export function getEntitlements(): Entitlements {
  return localUnlimited;
}
