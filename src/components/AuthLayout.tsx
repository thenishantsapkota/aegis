import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

// Shared frame for the screens you see before the vault is open (setup,
// unlock, cloud sign-up, restore): an open, left-aligned column with no card,
// a plain title, the form, and secondary options as text links underneath.
export function AuthLayout({
  title,
  subtitle,
  back,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Route for the back arrow; without one the app name shows instead. */
  back?: "/setup" | "/unlock";
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-safe-screen flex pt-safe pb-safe pl-safe pr-safe">
      <main className="w-full max-w-sm mx-auto px-6 py-10 flex flex-col justify-center">
        {back ? (
          <Link to={back} className="icon-btn -ml-3 mb-8 self-start" aria-label="Back">
            <ArrowLeft size={20} />
          </Link>
        ) : (
          <p className="mb-10 text-sm font-semibold tracking-tight text-zinc-500">
            Aegis
          </p>
        )}
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">{subtitle}</p>
        )}
        <div className="mt-8">{children}</div>
        {footer && (
          <div className="mt-10 space-y-3 text-sm text-zinc-400">{footer}</div>
        )}
      </main>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-sm text-danger" role="alert">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// A sentence with a link at the end, for the secondary options under a form.
export function FooterLink({
  text,
  link,
  to,
}: {
  text: string;
  link: string;
  to: "/signup" | "/restore";
}) {
  return (
    <p>
      {text}{" "}
      <Link
        to={to}
        className="font-medium text-zinc-100 underline decoration-zinc-600 underline-offset-4 hover:decoration-zinc-300"
      >
        {link}
      </Link>
    </p>
  );
}
