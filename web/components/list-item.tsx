/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/list-item.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: heavily trimmed — removed sortable/drag-and-drop support, label colors, and badge/button variants; uses @base-ui/react directly.
 */
"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  cloneElement,
  type Attributes,
  type ComponentPropsWithoutRef,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";

type ListItemProps = useRender.ComponentProps<"div">;

const spanningTriggerClasses = "cursor-pointer before:absolute before:inset-0";

type ListItemSpanningTriggerProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "render"
> & {
  render?: ReactElement;
};

export function ListItem({
  children,
  className,
  render,
  ...props
}: ListItemProps): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn(
      "not-last:border-b bg-clip-padding has-[[data-spanning-trigger]:hover]:z-1 has-[[data-spanning-trigger]:hover]:bg-[color-mix(in_srgb,var(--card),var(--color-black)_2%)] dark:has-[[data-spanning-trigger]:hover]:bg-[color-mix(in_srgb,var(--card),var(--color-white)_2%)] first:rounded-t-[calc(var(--radius-2xl)-1px)] last:rounded-b-[calc(var(--radius-2xl)-1px)] in-[[data-slot=card-frame]:has([data-slot=card-frame-header])]:first:rounded-t-[calc(var(--radius-xl)-1px)] in-[[data-slot=card-frame]:has([data-slot=card-frame-footer])]:last:rounded-b-[calc(var(--radius-xl)-1px)] transition-[background-color]",
      className,
    ),
    "data-slot": "list-item",
  };
  const mergedProps = mergeProps<"div">(defaultProps, props);

  return useRender({
    defaultTagName: "div",
    props: {
      ...mergedProps,
      children: (
        <div className="relative flex items-center justify-between gap-4 px-6 py-4">
          {children}
        </div>
      ),
    },
    render,
  });
}

export function ListItemContent({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("flex min-w-0 flex-1 flex-col gap-3", className),
    "data-slot": "list-item-content",
  };
  const mergedProps = mergeProps<"div">(defaultProps, props);

  return useRender({
    defaultTagName: "div",
    props: { ...mergedProps, children },
    render,
  });
}

export function ListItemHeader({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("flex flex-col gap-1", className),
    "data-slot": "list-item-header",
  };
  const mergedProps = mergeProps<"div">(defaultProps, props);

  return useRender({
    defaultTagName: "div",
    props: { ...mergedProps, children },
    render,
  });
}

export function ListItemTitle({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"h2">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("font-semibold sm:text-sm", className),
    "data-slot": "list-item-title",
  };
  const mergedProps = mergeProps<"h2">(defaultProps, props);

  return useRender({
    defaultTagName: "h2",
    props: { ...mergedProps, children },
    render,
  });
}

export function ListItemSpanningTrigger({
  children,
  className,
  render,
  ...props
}: ListItemSpanningTriggerProps): ReactElement {
  const mergedProps = {
    className: cn(spanningTriggerClasses, className),
    "data-spanning-trigger": "",
    ...props,
  };

  if (render) {
    const renderProps = (render.props || {}) as Record<string, unknown>;
    return cloneElement(render, {
      ...renderProps,
      ...mergedProps,
      children: children ?? renderProps.children,
      className: cn(
        renderProps.className as string,
        spanningTriggerClasses,
        className,
      ),
    } as Attributes);
  }

  return <div {...mergedProps}>{children}</div>;
}

export function ListItemDescription({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"p">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("text-muted-foreground text-sm", className),
    "data-slot": "list-item-description",
  };
  const mergedProps = mergeProps<"p">(defaultProps, props);

  return useRender({
    defaultTagName: "p",
    props: { ...mergedProps, children },
    render,
  });
}

export function ListItemBadges({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("flex flex-wrap items-center gap-2", className),
    "data-slot": "list-item-badges",
  };
  const mergedProps = mergeProps<"div">(defaultProps, props);

  return useRender({
    defaultTagName: "div",
    props: { ...mergedProps, children },
    render,
  });
}

export function ListItemActions({
  children,
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): ReturnType<typeof useRender> {
  const defaultProps = {
    className: cn("relative flex items-center gap-4", className),
    "data-slot": "list-item-actions",
  };
  const mergedProps = mergeProps<"div">(defaultProps, props);

  return useRender({
    defaultTagName: "div",
    props: { ...mergedProps, children },
    render,
  });
}
