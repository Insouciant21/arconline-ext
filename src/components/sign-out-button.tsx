"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button className="sign-out-button" variant="ghost" size="sm" onClick={() => signOut({ redirectTo: "/login" })}>
      <LogOut size={17} />
      退出
    </Button>
  );
}
