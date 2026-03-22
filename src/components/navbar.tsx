"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LayoutDashboard, Upload, BookOpen, LogOut, Globe } from "lucide-react";

interface NavbarProps {
  userEmail?: string;
  userName?: string;
}

export function Navbar({ userEmail, userName }: NavbarProps) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const supabase = createClient();

  const otherLocale = locale === "ko" ? "en" : "ko";
  const initials = userName
    ? userName.slice(0, 2).toUpperCase()
    : userEmail?.slice(0, 2).toUpperCase() ?? "U";

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push(`/${locale}/login`);
    router.refresh();
  }

  return (
    <header className="border-b border-border/40 bg-background/95 backdrop-blur sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href={`/${locale}/dashboard`} className="flex items-center gap-2">
          <span className="text-lg font-black tracking-tighter">Q:ED</span>
          <Badge variant="secondary" className="text-xs">Beta</Badge>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <Link href={`/${locale}/dashboard`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" />
              {t("dashboard")}
            </Button>
          </Link>
          <Link href={`/${locale}/upload`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <Upload className="h-4 w-4" />
              {t("upload")}
            </Button>
          </Link>
          <Link href={`/${locale}/study`}>
            <Button variant="ghost" size="sm" className="gap-1.5">
              <BookOpen className="h-4 w-4" />
              {t("study")}
            </Button>
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href={`/${otherLocale}/dashboard`}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Globe className="h-4 w-4" />
            </Button>
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger className="h-8 w-8 rounded-full flex items-center justify-center outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <Avatar className="h-8 w-8 cursor-pointer">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{userName || userEmail}</p>
                {userName && <p className="text-xs text-muted-foreground truncate">{userEmail}</p>}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => router.push(`/${locale}/dashboard`)}
                className="cursor-pointer"
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                {t("dashboard")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/${locale}/upload`)}
                className="cursor-pointer"
              >
                <Upload className="mr-2 h-4 w-4" />
                {t("upload")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
