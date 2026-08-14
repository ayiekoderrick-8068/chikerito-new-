import { useEffect } from "react";

// Injects a robots meta tag while mounted, so unlisted/private-by-search public
// pages aren't crawled unless the owner explicitly allows indexing.
export default function NoIndexTag({ allow }) {
  useEffect(() => {
    if (allow) return;
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.appendChild(tag);
    return () => document.head.removeChild(tag);
  }, [allow]);

  return null;
}
