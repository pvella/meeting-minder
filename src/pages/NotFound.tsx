import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">
        404
      </p>
      <h1 className="font-display text-4xl">That page doesn't exist.</h1>
      <Link
        href="/"
        className="mt-2 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"
      >
        Back to recording
      </Link>
    </div>
  );
}
