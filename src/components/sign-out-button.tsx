"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button className="sign-out-button" variant="ghost" size="sm" onClick={async () => { const response = await fetch("/api/auth/logout", { method: "POST" }); if (response.ok) window.location.assign("/login"); }}>
      <LogOut size={17} />
      退出
    </Button>
  );
}
