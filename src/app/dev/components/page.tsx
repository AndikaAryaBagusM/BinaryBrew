import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Showcase } from "./showcase";

export const metadata: Metadata = {
  title: "Komponen — Binary Brew",
  robots: { index: false, follow: false },
};

// Developer-only gallery of every component in every state (P0-05).
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Showcase />;
}
