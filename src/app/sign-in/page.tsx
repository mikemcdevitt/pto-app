import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-2xl font-bold">Sign In</h1>
      {error === "unauthorized" && (
        <p className="text-red-600 text-sm">
          That email isn't recognized. Contact your PTO board if this seems wrong.
        </p>
      )}
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl ?? "/post-sign-in" });
        }}
      >
        <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded">
          Sign in with Google
        </button>
      </form>
    </div>
  );
}