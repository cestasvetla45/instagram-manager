"use client";
import { useEffect, useState } from "react";

export default function ConfigBanner() {
  const [status, setStatus] = useState<{ airtable: boolean; rocksolid: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);
  if (!status) return null;
  if (status.airtable && status.rocksolid) return null;
  const missing: string[] = [];
  if (!status.airtable) missing.push("Airtable (AIRTABLE_TOKEN / AIRTABLE_BASE_ID)");
  if (!status.rocksolid) missing.push("RockSolidAPIs (ROCKSOLID_BASE_URL / ROCKSOLID_API_KEY)");
  return (
    <div className="banner">
      ⚠ Not fully configured. Missing: {missing.join(", ")}. Set these env vars (see README) and redeploy.
    </div>
  );
}
