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

export function normalizePlan(value: string | null | undefined): PlanId {
  return value === "pro" ? "pro" : "local";
}

export function entitlementsFor(plan: PlanId): Entitlements {
  if (plan === "enterprise") {
    return { plan, can: () => true };
  }
  if (plan === "pro") {
    return {
      plan,
      can: (feature) => feature === Features.WebhooksPublicTunnel,
    };
  }
  return { plan: "local", can: () => false };
}

export function getEntitlements(plan: PlanId = "local"): Entitlements {
  return entitlementsFor(plan);
}
