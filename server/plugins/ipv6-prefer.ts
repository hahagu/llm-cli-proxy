import dns from "node:dns";

export default defineNitroPlugin(() => {
  if (process.env.PREFER_IPV6 === "true") {
    dns.setDefaultResultOrder("ipv6first");
    console.log("[ipv6-prefer] DNS resolution set to prefer IPv6");
  }
});
