import { redirect } from "next/navigation";

// This page was superseded by the generic /accounts/connect (covers Revolut, Wise, PayPal,
// Hamburger Sparkasse). Kept as a redirect so old bookmarks/links keep working.
export default function ConnectRevolutRedirect() {
  redirect("/accounts/connect");
}
