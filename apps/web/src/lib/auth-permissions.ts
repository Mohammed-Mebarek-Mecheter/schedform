// web/src/lib/auth-permissions.ts
import { createAccessControl } from "better-auth/plugins/access";

// Create access control for SchedForm's permissions
export const schedFormStatement = {
    // Core business objects
    organization: ["create", "read", "update", "delete"],
    member: ["create", "read", "update", "delete"],
    invitation: ["create", "read", "cancel", "delete"],

    // Form management
    form: ["create", "read", "update", "delete", "publish", "archive"],
    form_response: ["read", "export", "delete"],

    // Scheduling
    event_type: ["create", "read", "update", "delete", "publish"],
    booking: ["create", "read", "update", "cancel", "reschedule"],
    calendar: ["connect", "read", "update", "disconnect"],

    // Team features
    team: ["create", "read", "update", "delete", "assign_members"],
    team_member: ["add", "remove", "update_role"],

    // Workflows and automation
    workflow: ["create", "read", "update", "delete", "activate", "deactivate"],
    integration: ["create", "read", "update", "delete", "connect"],

    // Analytics and insights
    analytics: ["read", "export"],
    ai_insights: ["read", "generate"],

    // Billing and subscription
    subscription: ["read", "update", "cancel"],
    billing: ["read", "update"],

    // White-labeling
    branding: ["read", "update"],
    custom_domain: ["create", "read", "update", "delete"],

    // Access control (for dynamic roles)
    ac: ["create", "read", "update", "delete"],

    // Better Auth default permissions
    user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password"],
    session: ["list", "revoke", "delete"],
} as const;

export const ac = createAccessControl(schedFormStatement);

// Define roles with appropriate permissions
export const memberRole = ac.newRole({
    // Basic form management
    form: ["create", "read", "update"],
    form_response: ["read"],

    // Basic scheduling
    event_type: ["create", "read", "update"],
    booking: ["read", "update", "cancel"],
    calendar: ["connect", "read", "update"],

    // Limited team access
    team: ["read"],
    team_member: ["add", "remove", "update_role"],

    // Basic workflows
    workflow: ["create", "read", "update"],
    integration: ["read"],

    // Analytics viewing
    analytics: ["read"],
    ai_insights: ["read"],

    // Basic branding
    branding: ["read"],
});

export const adminRole = ac.newRole({
    // Full form management
    form: ["create", "read", "update", "delete", "publish", "archive"],
    form_response: ["read", "export", "delete"],

    // Full scheduling
    event_type: ["create", "read", "update", "delete", "publish"],
    booking: ["create", "read", "update", "cancel", "reschedule"],
    calendar: ["connect", "read", "update", "disconnect"],

    // Team management
    team: ["create", "read", "update", "delete", "assign_members"],
    team_member: ["add", "remove", "update_role"],

    // Full workflow management
    workflow: ["create", "read", "update", "delete", "activate", "deactivate"],
    integration: ["create", "read", "update", "delete", "connect"],

    // Full analytics access
    analytics: ["read", "export"],
    ai_insights: ["read", "generate"],

    // Member management
    member: ["create", "read", "update", "delete"],
    invitation: ["create", "read", "cancel", "delete"],

    // Organization management (but not delete)
    organization: ["read", "update"],

    // Advanced branding
    branding: ["read", "update"],
    custom_domain: ["create", "read", "update", "delete"],

    // Dynamic access control
    ac: ["create", "read", "update", "delete"],

    // Better Auth admin permissions
    user: ["create", "list", "set-role", "ban", "impersonate", "set-password"],
    session: ["list", "revoke", "delete"],
});

export const ownerRole = ac.newRole({
    // All admin permissions
    ...adminRole.statements,

    // Additional owner permissions
    subscription: ["read", "update", "cancel"],
    billing: ["read", "update"],
    organization: ["create", "read", "update", "delete"],

    // Full user management for admins
    user: ["create", "list", "set-role", "ban", "impersonate", "delete", "set-password"],
});

// Custom roles for specific use cases
export const viewerRole = ac.newRole({
    // Read-only access to most resources
    form: ["read"],
    form_response: ["read"],
    event_type: ["read"],
    booking: ["read"],
    team: ["read"],
    analytics: ["read"],
    member: ["read"],
    organization: ["read"],
});

export const managerRole = ac.newRole({
    // Between admin and member - can manage workflows and teams but not billing
    ...adminRole.statements,
    // Override sensitive permissions - no billing or subscription access
    subscription: [],
    billing: [],
    // Limited organization management
    organization: ["read", "update"],
});
