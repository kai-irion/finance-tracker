import { redirect } from "next/navigation";

// Rules management moved into the Settings tab bar. Kept as a redirect so old
// bookmarks/links keep working.
export default function RulesRedirect() {
  redirect("/settings?tab=rules");
}
