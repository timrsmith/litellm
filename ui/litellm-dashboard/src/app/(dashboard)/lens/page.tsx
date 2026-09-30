"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { EngineView } from "./_components/EngineView";

export default function EnginePage() {
  const { accessToken, isViewOnly } = useAuthorized();
  if (!accessToken) return null;
  return <EngineView accessToken={accessToken} readOnly={isViewOnly} />;
}
