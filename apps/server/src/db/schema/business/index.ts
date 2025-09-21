// src/db/schema/business/index.ts

// 1. Core authentication dependency (if user was here, it would go first, but it's in auth.ts)
// (Note: user is in auth.ts, so it needs to be exported before business in the main index.ts)

// 2. Teams & members (depends on user)
export * from "./teams"; // Export teams early within business

// 3. Billing & subscriptions (might depend on user)
export * from "./billing";

// 4. Analytics & activity logs (might depend on user, forms)
export * from "./analytics";

// 5. Other features...
export * from "./featureFlags";
export * from "./feedback";
export * from "./experiments";
