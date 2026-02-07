import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;

export function getConvexClient(): ConvexHttpClient {
  if (!client) {
    const url = process.env.CONVEX_SELF_HOSTED_URL;
    if (!url) throw new Error("CONVEX_SELF_HOSTED_URL not set");
    client = new ConvexHttpClient(url);

    const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
    if (adminKey) {
      // setAdminAuth exists at runtime but is not in the public TS types
      (client as any).setAdminAuth(adminKey);
    }
  }
  return client;
}
