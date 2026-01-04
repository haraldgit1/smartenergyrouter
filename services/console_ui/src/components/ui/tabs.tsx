// components/ui/tabs.tsx
"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-1 text-slate-300",
      className
    )}
    {...props}
  />
);

const TabsTrigger = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs transition-all hover:bg-slate-800/70 data-[state=active]:bg-slate-800 data-[state=active]:text-emerald-300",
      className
    )}
    {...props}
  />
);

const TabsContent = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    className={cn("rounded-md pt-2", className)}
    {...props}
  />
);

export { Tabs, TabsList, TabsTrigger, TabsContent };

