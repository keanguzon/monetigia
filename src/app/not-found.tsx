import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <h2 className="text-2xl font-bold tracking-tight">404 - Page Not Found</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Return to Dashboard</Link>
      </Button>
    </div>
  );
}
