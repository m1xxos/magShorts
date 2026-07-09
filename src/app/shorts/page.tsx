import { Suspense } from "react";
import { ShortsReader } from "@/components/ShortsReader";

export default function ShortsPage() {
  return (
    <Suspense>
      <ShortsReader />
    </Suspense>
  );
}
