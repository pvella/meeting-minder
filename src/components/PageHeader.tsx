import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <header className="border-b border-border/60 bg-card/40 px-5 py-9 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">
            {eyebrow}
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
    </header>
  );
}
