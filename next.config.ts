import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // في التطوير يُعطَّل الـSW حتى لا يخزن صفحات قديمة
  disable: process.env.NODE_ENV === "development",
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
};

export default withSerwist(nextConfig);
