import { redirect } from "next/navigation";

// Categories management moved into the Settings tab bar. Kept as a redirect so old
// bookmarks/links keep working.
export default function CategoriesRedirect() {
  redirect("/settings?tab=categories");
}
