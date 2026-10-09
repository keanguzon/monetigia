"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useNavigation } from "./navigation-provider";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { LogOut, RefreshCw, Settings, User as UserIcon } from "lucide-react";
import { getInitials } from "@/lib/utils";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { clearTabSessionMarker } from "@/lib/session-preferences";

interface HeaderProps {
  user: {
    email: string;
    name?: string;
    avatar_url?: string;
  } | null;
}

export function Header({ user }: HeaderProps) {
  const router = useRouter();
  const { navigate } = useNavigation();
  const supabase = createClient();
  const { toast } = useToast();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    clearTabSessionMarker();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <div className="min-w-0 flex-1 pr-2">
        <div className="flex items-center gap-2 font-heading text-lg font-bold md:text-xl">
          <Image src="/logos/main-logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-md" />
          <span className="truncate">Monetigia</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-4">
        <Button variant="ghost" size="icon" aria-label="Refresh page" data-tooltip="Refresh page" className="h-11 w-11 text-muted-foreground md:hidden" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
        {/* Theme toggle */}
        <ModeToggle />


        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-full p-0">
              <Avatar className="h-10 w-10">
                <AvatarImage src={user?.avatar_url} alt={user?.name || "User"} />
                <AvatarFallback>
                  {user?.name ? getInitials(user.name) : <UserIcon className="h-5 w-5" />}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-56"
            align="end"
            side="bottom"
            sideOffset={8}
            avoidCollisions={false}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user?.name || "User"}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
