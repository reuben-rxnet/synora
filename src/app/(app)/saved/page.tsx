import type { Metadata } from "next";
import { SavedClient } from "@/components/saved";

export const metadata: Metadata = { title: "Saved" };

export default function SavedPage() {
  return <SavedClient />;
}
