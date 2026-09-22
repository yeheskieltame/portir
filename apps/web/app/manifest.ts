import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Portir",
    short_name: "Portir",
    description: "US stocks on BNB Chain, bought at a fair price.",
    start_url: "/",
    display: "standalone",
    background_color: "#04070d",
    theme_color: "#04070d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
