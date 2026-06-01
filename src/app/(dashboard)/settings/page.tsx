"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { User, Upload, Loader2, ShieldCheck } from "lucide-react";
import { getInitials } from "@/lib/utils";

type ProfileData = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export default function SettingsPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    void loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Not authenticated");

      const appProviders = user.app_metadata?.providers;
      const provider = user.app_metadata?.provider;
      const parsedProviders = Array.isArray(appProviders)
        ? appProviders
        : provider
          ? [provider]
          : [];
      setProviders(parsedProviders.map((item) => String(item)));

      const { data: userData } = await supabase
        .from("users")
        .select("id, name, email, avatar_url")
        .eq("id", user.id)
        .single();

      if (userData) {
        setProfile(userData as ProfileData);
        setName((userData as ProfileData).name || "");
        setAvatarUrl((userData as ProfileData).avatar_url || "");
      }
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "Error",
        description: "Image must be less than 2MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;

      const fileExt = file.name.split(".").pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      // Use server-side upload to bypass RLS and ensure bucket existence
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", filePath);

      const uploadRes = await fetch("/api/user/upload-avatar", {
        method: "POST",
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadData.error || "Failed to upload image");
      }

      const { data: { publicUrl } } = supabase.storage
        .from("profiles")
        .getPublicUrl(uploadData.path);

      const { error: updateError } = await supabase
        .from("users")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);

      if (updateError) throw updateError;

      setAvatarUrl(publicUrl);

      toast({
        title: "Success!",
        description: "Profile picture updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to upload image",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) return;

      const { error: profileError } = await supabase
        .from("users")
        .update({
          name,
        })
        .eq("id", user.id);
      if (profileError) throw profileError;

      toast({
        title: "Success!",
        description: "Profile updated successfully",
      });
      void loadProfile();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-green-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your OAuth profile
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile
            </CardTitle>
            <CardDescription>Update your personal information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Profile Picture */}
            <div className="flex items-center gap-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src={avatarUrl} alt={name} />
                <AvatarFallback className="text-2xl">
                  {name ? getInitials(name) : <User className="h-12 w-12" />}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Label htmlFor="avatar" className="cursor-pointer">
                  <div className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-fit">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>{uploading ? "Uploading..." : "Upload Photo"}</span>
                  </div>
                </Label>
                <Input
                  id="avatar"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                  disabled={uploading}
                />
                <p className="text-xs text-muted-foreground">
                  JPG, PNG or GIF. Max size 2MB.
                </p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile?.email || ""}
                  disabled
                />
              </div>
            </div>

            <Button onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Profile
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Authentication
            </CardTitle>
            <CardDescription>All accounts use OAuth sign in only</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">
                Password and account-deletion controls were removed. Continue signing in through Google or Facebook only.
              </p>
              <div className="flex flex-wrap gap-2">
                {providers.length > 0 ? providers.map((provider) => (
                  <span
                    key={provider}
                    className="rounded-full border bg-background px-3 py-1 text-xs font-medium uppercase tracking-wide"
                  >
                    {provider}
                  </span>
                )) : (
                  <span className="text-xs text-muted-foreground">Provider will appear after next sign in.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
