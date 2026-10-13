/*
 * Vendored from Coss UI registry at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: apps/ui/registry/default/ui/sidebar.tsx
 * Upstream license: MIT (apps/ui exception in Coss LICENSING.md)
 * Modified: 2026-08-20
 * Local modifications: updated imports to local alias paths; removed unused exports.
 */
"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import * as React from "react";

type SidebarTooltipHandle = ReturnType<
  typeof TooltipCreateHandle<React.ComponentType>
>;

const SidebarMenuOpenContext: React.Context<{
  openMenuCount: number;
  registerMenu: () => () => void;
}> = React.createContext<{
  openMenuCount: number;
  registerMenu: () => () => void;
}>({
  openMenuCount: 0,
  registerMenu: () => () => {},
});

export const sidebarTooltipHandle: SidebarTooltipHandle =
  TooltipCreateHandle<React.ComponentType>();

export function SidebarProvider({
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  const [openMenuCount, setOpenMenuCount] = React.useState(0);

  const registerMenu = React.useCallback((): (() => void) => {
    setOpenMenuCount((prev) => prev + 1);
    return (): void => {
      setOpenMenuCount((prev) => Math.max(0, prev - 1));
    };
  }, []);

  return (
    <SidebarMenuOpenContext.Provider value={{ openMenuCount, registerMenu }}>
      <TooltipProvider delay={150} timeout={0}>
        <div
          className={cn(
            "group/sidebar-wrapper isolate flex min-h-svh w-full bg-sidebar [--sidebar-width:4rem] lg:[--sidebar-width:16rem] 2xl:[--sidebar-width:18rem]",
            className,
          )}
          data-slot="sidebar-wrapper"
          {...props}
        >
          {children}
          <Tooltip handle={sidebarTooltipHandle}>
            {({
              payload: Payload,
            }: {
              payload: React.ComponentType | undefined;
            }): React.ReactElement => (
              <TooltipPopup align="center" side="right">
                {Payload !== undefined && <Payload />}
              </TooltipPopup>
            )}
          </Tooltip>
        </div>
      </TooltipProvider>
    </SidebarMenuOpenContext.Provider>
  );
}

export function useSidebarMenuOpen(): {
  openMenuCount: number;
  registerMenu: () => () => void;
} {
  return React.useContext(SidebarMenuOpenContext);
}

export function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className="group peer hidden w-(--sidebar-width) text-sidebar-foreground md:block"
      data-slot="sidebar"
    >
      <div
        className={cn(
          "fixed inset-y-0 h-svh w-(--sidebar-width) pt-2",
          className,
        )}
        data-slot="sidebar-container"
        {...props}
      >
        <div
          className="flex h-full w-full flex-col"
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function SidebarInset({
  className,
  children,
  ...props
}: React.ComponentProps<"main">): React.ReactElement {
  return (
    <main
      className={cn(
        "relative flex w-full min-w-0 flex-1 flex-col border-sidebar-border bg-background not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] md:my-2 md:me-2 md:rounded-2xl md:border dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    >
      <div className="px-4 py-6 max-md:pb-24 md:p-6 xl:px-10">{children}</div>
    </main>
  );
}

export function SidebarHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col gap-2 px-1 py-2 lg:px-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

export function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>): React.ReactElement {
  return (
    <Separator
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      data-sidebar="separator"
      data-slot="sidebar-separator"
      {...props}
    />
  );
}

export function SidebarContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <ScrollArea className="min-h-0 flex-1" fill overscrollContain scrollFade>
      <div
        className={cn("flex h-full flex-col gap-2 px-2", className)}
        data-sidebar="content"
        data-slot="sidebar-content"
        {...props}
      />
    </ScrollArea>
  );
}

export function SidebarGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col px-1 py-2",
        className,
      )}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 font-medium text-base text-sidebar-accent-foreground outline-hidden ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 sm:text-sm lg:h-7 [&>svg]:size-4.5 [&>svg]:shrink-0 sm:[&>svg]:size-4",
      "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
      className,
    ),
    "data-sidebar": "group-label",
    "data-slot": "sidebar-group-label",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps(defaultProps, props),
    render,
  });
}

export function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<"button">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      "after:absolute after:-inset-2 md:after:hidden",
      className,
    ),
    "data-sidebar": "group-action",
    "data-slot": "sidebar-group-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps(defaultProps, props),
    render,
  });
}

export function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

export function SidebarMenu({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement {
  return (
    <ul
      className={cn("flex min-w-0 flex-col gap-1 lg:w-full", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

export function SidebarMenuItem({
  className,
  ...props
}: React.ComponentProps<"li">): React.ReactElement {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

export function SidebarMenuButton({
  isActive = false,
  tooltip,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentType;
}): React.ReactElement {
  const isMobile = useMediaQuery("max-md");
  const isBetweenMdAndLg = useMediaQuery("md:max-lg");
  const state = isBetweenMdAndLg ? "collapsed" : "expanded";
  const showTooltip = state === "collapsed" && !isMobile;

  const defaultProps = {
    className: cn(
      "peer/menu-button relative flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg p-2 text-left font-medium text-base text-sidebar-foreground outline-hidden ring-sidebar-ring after:absolute after:top-full after:h-1 after:w-full hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pe-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-pressed:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-pressed:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground max-lg:size-10 max-lg:justify-center max-lg:p-0 sm:text-sm lg:h-8 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-button",
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, props);

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip || !showTooltip) {
    return buttonElement;
  }

  // Convert string tooltip to a component
  const TooltipContent: React.ComponentType =
    typeof tooltip === "string" ? (): React.ReactNode => tooltip : tooltip;

  return (
    <TooltipTrigger
      handle={sidebarTooltipHandle}
      payload={TooltipContent}
      render={buttonElement as React.ReactElement<Record<string, unknown>>}
    />
  );
}

export function SidebarMenuAction({
  className,
  showOnHover = false,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  showOnHover?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-lg p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0",
      "after:absolute after:-inset-2 md:after:hidden",
      showOnHover &&
        "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
      className,
    ),
    "data-sidebar": "menu-action",
    "data-slot": "sidebar-menu-action",
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

export function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean;
}): React.ReactElement {
  // Random width between 50 to 90%.
  const width = React.useMemo((): string => {
    return `${Math.floor(Math.random() * 40) + 50}%`;
  }, []);

  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2 rounded-lg px-2 lg:h-7",
        className,
      )}
      data-sidebar="menu-skeleton"
      data-slot="sidebar-menu-skeleton"
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-lg"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export function SidebarMenuSub({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        className,
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

export function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">): React.ReactElement {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

export function SidebarMenuSubButton({
  isActive = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & {
  isActive?: boolean;
}): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex h-9 min-w-0 -translate-x-px cursor-pointer items-center gap-2 rounded-lg px-2 text-base text-sidebar-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:text-sm lg:h-7 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
      "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-sub-button",
    "data-slot": "sidebar-menu-sub-button",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}
