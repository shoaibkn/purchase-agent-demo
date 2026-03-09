import Link from "next/link";
import type { Route } from "next";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/demo-run", label: "Demo Run" },
  { href: "/suppliers", label: "Suppliers" },
  { href: "/materials", label: "Materials" },
  { href: "/purchase-orders", label: "Purchase Orders" },
  { href: "/communications", label: "Communications" },
  { href: "/settings", label: "Settings" },
] as const satisfies ReadonlyArray<{ href: Route; label: string }>;

export default function Home() {
  return (
    <section className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[color:var(--muted)]">Manufacturing Procurement</p>
        <h1 className="text-4xl font-semibold tracking-tight">Purchase Agent Demo</h1>
        <p className="max-w-3xl text-base text-[color:var(--muted)]">
          This scaffold includes Next.js, Prisma for Neon, LangChain/OpenAI wiring, and workflow placeholders for automatic supplier communication.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl border border-[color:var(--card-border)] bg-[color:var(--card)] p-5 shadow-sm transition hover:-translate-y-0.5"
          >
            <span className="text-lg font-medium">{link.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
