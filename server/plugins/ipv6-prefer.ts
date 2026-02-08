import dns, { promises as dnsPromises } from "node:dns";

export default defineNitroPlugin(async () => {
  if (process.env.PREFER_IPV6 === "true") {
    dns.setDefaultResultOrder("ipv6first");
    console.log("[ipv6-prefer] DNS resolution set to prefer IPv6");

    // Diagnostic: resolve the Gemini API host to see what addresses are available
    try {
      const host = "generativelanguage.googleapis.com";
      const results = await dnsPromises.lookup(host, { all: true });
      console.log(`[ipv6-prefer] DNS lookup for ${host}:`);
      for (const r of results) {
        console.log(`  ${r.address} (IPv${r.family})`);
      }
      // Show which one would be picked by default
      const picked = await dnsPromises.lookup(host);
      console.log(`[ipv6-prefer] Default pick: ${picked.address} (IPv${picked.family})`);
    } catch (err) {
      console.error("[ipv6-prefer] DNS diagnostic failed:", err);
    }
  }
});
