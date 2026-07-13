"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface CurrentUser {
  id: number;
  username: string;
}

// Redirects to /login when there is no session; returns undefined while loading.
export function useUser(): CurrentUser | undefined {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me").then(async (response) => {
      if (cancelled) return;
      if (!response.ok) {
        router.replace("/login");
        return;
      }
      setUser(await response.json());
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return user;
}
