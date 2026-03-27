import { redirect } from "next/navigation";

/** Root route — redirect straight to the marketplace. */
export default function Home() {
  redirect("/marketplace");
}
