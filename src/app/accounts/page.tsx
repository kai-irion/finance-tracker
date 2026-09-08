import { redirect } from "next/navigation";

// Accounts management moved into the Settings tab bar. Kept as a redirect so old
// bookmarks/links keep working.
export default function AccountsRedirect() {
  redirect("/settings?tab=accounts");
}
