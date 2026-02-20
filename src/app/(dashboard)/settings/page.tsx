"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/components/ui/use-toast";
import { User, Upload, Loader2, DollarSign, Shield, Eye, EyeOff } from "lucide-react";
import { getInitials } from "@/lib/utils";
import { clearTabSessionMarker } from "@/lib/session-preferences";

export default function SettingsPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [profile, setProfile] = useState<any>(null);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [currentEmail, setCurrentEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string>("");
  const [checkingEmailVerified, setCheckingEmailVerified] = useState(false);

  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordMode, setPasswordMode] = useState<"password" | "oauth">("password");
  const [sendingPasswordLink, setSendingPasswordLink] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  // Currency state
  const [currency, setCurrency] = useState("PHP");

  const openPasswordModal = async () => {
    try {
      const { data } = await supabase.auth.getUser();
      const user = data?.user;

      const metaHasPassword = Boolean((user as any)?.user_metadata?.has_password);

      const providersFromAppMeta = user?.app_metadata?.providers;
      const provider = user?.app_metadata?.provider;
      const providers = Array.isArray(providersFromAppMeta)
        ? providersFromAppMeta
        : provider
          ? [provider]
          : [];

      const identityProviders = (user as any)?.identities?.map((i: any) => i?.provider).filter(Boolean) ?? [];
      const allProviders = Array.from(new Set([...(providers as string[]), ...identityProviders]));

      const providerSuggestsPassword = allProviders.includes("email");
      const hasPassword = metaHasPassword || providerSuggestsPassword;
      setPasswordMode(hasPassword ? "password" : "oauth");
    } catch {
      // Default to password mode; if it fails, the submit handler will show an error.
      setPasswordMode("password");
    }

    setShowPasswordModal(true);
  };

  const sendPasswordSetupLink = async () => {
    setSendingPasswordLink(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) throw new Error("No email found for this account");

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;

      toast({
        title: "Email sent!",
        description: "Check your inbox for the password setup link.",
      });
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send password setup link",
        variant: "destructive",
      });
    } finally {
      setSendingPasswordLink(false);
    }
  };

  const handleChangePassword = async () => {
    if (passwordMode === "oauth") {
      // OAuth users don't have a current password; they must set one via email link.
      await sendPasswordSetupLink();
      return;
    }

    // Validate current password
    if (!currentPassword) {
      toast({
        title: "Error",
        description: "Please enter your current password",
        variant: "destructive",
      });
      return;
    }

    // Validate new password
    if (!newPassword) {
      toast({
        title: "Error",
        description: "Please enter a new password",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (currentPassword === newPassword) {
      toast({
        title: "Error",
        description: "New password must be different from current password",
        variant: "destructive",
      });
      return;
    }

    setChangingPassword(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email) {
        throw new Error("Not authenticated");
      }

      // Reauthenticate with current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });

      if (signInError) {
        throw new Error("Current password is incorrect");
      }

      // Update password
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          has_password: true,
        },
      });

      if (error) throw error;

      toast({
        title: "Success!",
        description: "Password changed successfully",
      });
      setShowPasswordModal(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change password",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      toast({
        title: "Error",
        description: "Please enter your password",
        variant: "destructive",
      });
      return;
    }

    setDeletingAccount(true);
    try {
      const res = await fetch("/api/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to delete account");
      }

      toast({
        title: "Account deleted",
        description: "Your account has been permanently deleted",
      });

      await supabase.auth.signOut();
      clearTabSessionMarker();
      window.location.href = "/login";
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete account",
        variant: "destructive",
      });
    } finally {
      setDeletingAccount(false);
      setShowDeleteModal(false);
      setDeletePassword("");
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setCurrentEmail(session.user.email ?? "");
        // Load user profile
        const { data: userData } = await supabase
          .from("users")
          .select("*")
          .eq("id", session.user.id)
          .single();
        if (userData) {
          setProfile(userData);
          setName((userData as any).name || "");
          setUsername((userData as any).username || "");
          setAvatarUrl((userData as any).avatar_url || "");
        }
        // Load user preferences (currency)
        const { data: prefData } = await supabase
          .from("user_preferences")
          .select("currency")
          .eq("user_id", session.user.id)
          .single();
        if (prefData && (prefData as any).currency) {
          setCurrency((prefData as any).currency);
        }
      }
    } catch (error) {
      console.error("Error loading profile:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendEmailChange = async () => {
    const nextEmail = newEmail.trim().toLowerCase();

    if (!nextEmail) {
      toast({
        title: "Error",
        description: "Please enter a new email address",
        variant: "destructive",
      });
      return;
    }

    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);
    if (!looksLikeEmail) {
      toast({
        title: "Error",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    if (currentEmail && nextEmail === currentEmail.toLowerCase()) {
      toast({
        title: "Error",
        description: "New email must be different from your current email",
        variant: "destructive",
      });
      return;
    }

    setChangingEmail(true);
    try {
      const availabilityRes = await fetch("/api/auth/check-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: nextEmail }),
      });

      const availability = await availabilityRes.json().catch(() => ({}));
      if (!availabilityRes.ok) {
        throw new Error(availability?.error || "Failed to validate email");
      }

      if (availability?.emailExists) {
        toast({
          title: "Email already in use",
          description: "Please choose a different email address",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: `${window.location.origin}/auth/callback` }
      );

      if (error) throw error;

      setPendingEmail(nextEmail);
      toast({
        title: "Verification email sent",
        description: `We sent a verification link to ${nextEmail}. Please verify to complete the change.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to change email",
        variant: "destructive",
      });
    } finally {
      setChangingEmail(false);
    }
  };

  const handleCheckEmailVerified = async () => {
    if (!pendingEmail) return;

    setCheckingEmailVerified(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;

      const authedEmail = (data?.user?.email ?? "").toLowerCase();
      if (authedEmail !== pendingEmail.toLowerCase()) {
        toast({
          title: "Not verified yet",
          description: `Your email is still ${data?.user?.email || "unchanged"}. Verify the link sent to ${pendingEmail}.`,
          variant: "destructive",
        });
        return;
      }

      // Sync public profile record after confirmed
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { error: updateError } = await (supabase as any)
          .from("users")
          .update({ email: authedEmail })
          .eq("id", session.user.id);
        if (updateError) throw updateError;
      }

      setCurrentEmail(authedEmail);
      setNewEmail("");
      setPendingEmail("");
      toast({
        title: "Email updated",
        description: "Your email has been changed successfully.",
      });

      // Reload profile so the disabled field stays in sync
      loadProfile();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to verify email change",
        variant: "destructive",
      });
    } finally {
      setCheckingEmailVerified(false);
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const fileExt = file.name.split(".").pop();
      const fileName = `${session.user.id}-${Date.now()}.${fileExt}`;
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

      const { error: updateError } = await (supabase as any)
        .from("users")
        .update({ avatar_url: publicUrl })
        .eq("id", session.user.id);

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Update user profile
      const { error: userError } = await (supabase as any)
        .from("users")
        .update({
          name,
          username: username.toLowerCase(),
        })
        .eq("id", session.user.id);
      if (userError) throw userError;

      toast({
        title: "Success!",
        description: "Profile updated successfully",
      });
      loadProfile();
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

  const handleSaveCurrency = async () => {
    setSavingCurrency(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { error: prefError } = await supabase
        .from("user_preferences")
        .upsert({ user_id: session.user.id, currency } as any, { onConflict: "user_id" });
      if (prefError) throw prefError;

      toast({
        title: "Success!",
        description: "Currency updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update currency",
        variant: "destructive",
      });
    } finally {
      setSavingCurrency(false);
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
          Manage your account and preferences
        </p>
      </div>

      <div className="grid gap-6">
        {/* Profile Settings */}
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
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={currentEmail || profile?.email || ""}
                  disabled
                />
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Change email</p>
                <p className="text-xs text-muted-foreground">
                  We will send a verification link to your new email.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className="space-y-2">
                  <Label htmlFor="newEmail">New email</Label>
                  <Input
                    id="newEmail"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="you@domain.com"
                    disabled={changingEmail}
                  />
                </div>
                <Button onClick={handleSendEmailChange} disabled={changingEmail}>
                  {changingEmail && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send verification
                </Button>
              </div>

              {pendingEmail && (
                <div className="rounded-lg bg-muted p-3 space-y-2">
                  <p className="text-sm">
                    Verification sent to <span className="font-medium">{pendingEmail}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    After verifying, click the button below. If you didn’t receive it, check spam.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={handleCheckEmailVerified}
                      disabled={checkingEmailVerified}
                    >
                      {checkingEmailVerified && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      I’ve verified
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setPendingEmail("");
                      }}
                      disabled={checkingEmailVerified || changingEmail}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <Button onClick={handleSaveProfile} disabled={savingProfile}>
              {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Profile
            </Button>
          </CardContent>
        </Card>

        {/* Currency */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Currency
            </CardTitle>
            <CardDescription>Select your preferred currency</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Default Currency</Label>
                <select
                  id="currency"
                  className="w-full px-3 py-2 border rounded-lg dark:bg-slate-900 dark:border-slate-700"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                >
                  <option value="PHP">PHP - Philippine Peso</option>
                  <option value="USD">USD - US Dollar</option>
                  <option value="EUR">EUR - Euro</option>
                  <option value="GBP">GBP - British Pound</option>
                  <option value="JPY">JPY - Japanese Yen</option>
                </select>
              </div>

              <Button onClick={handleSaveCurrency} disabled={savingCurrency}>
                {savingCurrency && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Currency
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Security
            </CardTitle>
            <CardDescription>Manage your account security</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={openPasswordModal}
              >
                Change Password
              </Button>
              <Button
                variant="destructive"
                className="w-full sm:w-auto"
                onClick={() => setShowDeleteModal(true)}
              >
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
          onClick={() => {
            setShowPasswordModal(false);
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          }}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl animate-in slide-in-from-bottom-4 duration-300 m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">Change Password</h3>
              {passwordMode === "password" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <div className="relative">
                      <Input
                        id="currentPassword"
                        type={showCurrentPassword ? "text" : "password"}
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showCurrentPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <div className="relative">
                      <Input
                        id="newPassword"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={-1}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    You signed in using Google/Facebook, so you don’t have a password yet. To set one, we’ll send a password setup link to your email.
                  </p>
                </div>
              )}
              <div className="flex gap-3 mt-6">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleChangePassword}
                  disabled={changingPassword || sendingPasswordLink}
                >
                  {(changingPassword || sendingPasswordLink) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {passwordMode === "password" ? "Change Password" : "Send Link"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-in fade-in duration-200"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl animate-in slide-in-from-bottom-4 duration-300 m-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4 text-red-500">Delete Account</h3>
              <p className="text-muted-foreground mb-6">
                Are you sure you want to permanently delete your account? This action cannot be undone. All your data will be lost.
              </p>
              <div className="space-y-2 mb-6">
                <Label htmlFor="deletePassword">Password</Label>
                <div className="relative">
                  <Input
                    id="deletePassword"
                    type={showDeletePassword ? "text" : "password"}
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter your password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDeletePassword(!showDeletePassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showDeletePassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount}
                >
                  {deletingAccount && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
