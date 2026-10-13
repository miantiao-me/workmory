/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/shared/adaptive-menu.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: updated imports to local alias paths, added optional drawer title for accessibility, removed checkbox-item variant.
 */
"use client";

import {
  Drawer,
  DrawerClose,
  DrawerMenu,
  DrawerMenuGroup,
  DrawerMenuGroupLabel,
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import * as React from "react";

type AdaptiveMenuVariant = "drawer" | "menu";
type AdaptiveMenuVisibility = "all" | "desktop" | "mobile";
type MenuPopupProps = React.ComponentProps<typeof MenuPopup>;

const AdaptiveMenuContext: React.Context<AdaptiveMenuVariant | null> =
  React.createContext<AdaptiveMenuVariant | null>(null);

function useAdaptiveMenuVariant(): AdaptiveMenuVariant {
  const variant = React.useContext(AdaptiveMenuContext);

  if (!variant) {
    throw new Error(
      "AdaptiveMenu components must be used within AdaptiveMenu.",
    );
  }

  return variant;
}

function isVisible(
  variant: AdaptiveMenuVariant,
  show: AdaptiveMenuVisibility = "all",
): boolean {
  return (
    show === "all" ||
    (show === "desktop" && variant === "menu") ||
    (show === "mobile" && variant === "drawer")
  );
}

function withClassName(
  element: React.ReactElement,
  className: string,
): React.ReactElement {
  const props = element.props as { className?: string };

  return React.cloneElement(element, {
    className: cn(props.className, className),
  } as Partial<typeof element.props>);
}

export function AdaptiveMenu({
  children,
  drawerProps,
  menuProps,
}: {
  children: React.ReactNode;
  drawerProps?: Omit<React.ComponentProps<typeof Drawer>, "children">;
  menuProps?: Omit<React.ComponentProps<typeof Menu>, "children">;
}): React.ReactElement {
  return (
    <>
      <Menu {...menuProps}>
        <AdaptiveMenuContext.Provider value="menu">
          {children}
        </AdaptiveMenuContext.Provider>
      </Menu>
      <Drawer {...drawerProps}>
        <AdaptiveMenuContext.Provider value="drawer">
          {children}
        </AdaptiveMenuContext.Provider>
      </Drawer>
    </>
  );
}

export function AdaptiveMenuTrigger({
  "aria-label": ariaLabel,
  children,
  className,
  disabled,
  drawerChildren,
  drawerRender,
  menuChildren,
  menuRender,
  render,
}: {
  "aria-label"?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  drawerChildren?: React.ReactNode;
  drawerRender?: React.ReactElement;
  menuChildren?: React.ReactNode;
  menuRender?: React.ReactElement;
  render: React.ReactElement;
}): React.ReactElement {
  const variant = useAdaptiveMenuVariant();

  if (variant === "menu") {
    return (
      <MenuTrigger
        render={withClassName(menuRender ?? render, "max-md:hidden")}
        aria-label={ariaLabel}
        className={className}
        disabled={disabled}
      >
        {menuChildren ?? children}
      </MenuTrigger>
    );
  }

  return (
    <DrawerTrigger
      render={withClassName(drawerRender ?? render, "md:hidden")}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
    >
      {drawerChildren ?? children}
    </DrawerTrigger>
  );
}

export function AdaptiveMenuPopup({
  align,
  alignOffset,
  children,
  drawerMenuProps,
  drawerPanelProps,
  drawerPopupProps,
  side,
  sideOffset,
  title,
}: {
  align?: MenuPopupProps["align"];
  alignOffset?: MenuPopupProps["alignOffset"];
  children: React.ReactNode;
  drawerMenuProps?: Omit<React.ComponentProps<typeof DrawerMenu>, "children">;
  drawerPanelProps?: Omit<React.ComponentProps<typeof DrawerPanel>, "children">;
  drawerPopupProps?: Omit<React.ComponentProps<typeof DrawerPopup>, "children">;
  side?: MenuPopupProps["side"];
  sideOffset?: MenuPopupProps["sideOffset"];
  title?: React.ReactNode;
}): React.ReactElement {
  const variant = useAdaptiveMenuVariant();

  if (variant === "menu") {
    return (
      <MenuPopup
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        {children}
      </MenuPopup>
    );
  }

  return (
    <DrawerPopup showBar {...drawerPopupProps}>
      {title && (
        <DrawerHeader className="sr-only">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
      )}
      <DrawerPanel {...drawerPanelProps}>
        <DrawerMenu {...drawerMenuProps}>{children}</DrawerMenu>
      </DrawerPanel>
    </DrawerPopup>
  );
}

export function AdaptiveMenuGroup({
  children,
  className,
  show,
}: {
  children: React.ReactNode;
  className?: string;
  show?: AdaptiveMenuVisibility;
}): React.ReactElement | null {
  const variant = useAdaptiveMenuVariant();

  if (!isVisible(variant, show)) return null;

  if (variant === "menu") {
    return <MenuGroup className={className}>{children}</MenuGroup>;
  }

  return <DrawerMenuGroup className={className}>{children}</DrawerMenuGroup>;
}

export function AdaptiveMenuGroupLabel({
  children,
  className,
  show,
}: {
  children: React.ReactNode;
  className?: string;
  show?: AdaptiveMenuVisibility;
}): React.ReactElement | null {
  const variant = useAdaptiveMenuVariant();

  if (!isVisible(variant, show)) return null;

  if (variant === "menu") {
    return <MenuGroupLabel className={className}>{children}</MenuGroupLabel>;
  }

  return (
    <DrawerMenuGroupLabel className={className}>
      {children}
    </DrawerMenuGroupLabel>
  );
}

export function AdaptiveMenuSeparator({
  className,
  show,
}: {
  className?: string;
  show?: AdaptiveMenuVisibility;
}): React.ReactElement | null {
  const variant = useAdaptiveMenuVariant();

  if (!isVisible(variant, show)) return null;

  if (variant === "menu") return <MenuSeparator className={className} />;

  return <DrawerMenuSeparator className={className} />;
}

export function AdaptiveMenuItem({
  children,
  className,
  disabled,
  drawerCloseProps,
  drawerRender,
  menuRender,
  onClick,
  render,
  show,
  variant: itemVariant = "default",
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  drawerCloseProps?: Omit<
    React.ComponentProps<typeof DrawerClose>,
    "children" | "render"
  >;
  drawerRender?: React.ReactElement;
  menuRender?: React.ReactElement;
  onClick?: React.MouseEventHandler<HTMLElement>;
  render?: React.ReactElement;
  show?: AdaptiveMenuVisibility;
  variant?: "default" | "destructive";
}): React.ReactElement | null {
  const adaptiveVariant = useAdaptiveMenuVariant();

  if (!isVisible(adaptiveVariant, show)) return null;

  if (adaptiveVariant === "menu") {
    return (
      <MenuItem
        className={className}
        disabled={disabled}
        onClick={onClick}
        render={menuRender ?? render}
        variant={itemVariant}
      >
        {children}
      </MenuItem>
    );
  }

  const activeRender = drawerRender ?? render;

  return (
    <DrawerClose
      nativeButton={activeRender ? false : undefined}
      onClick={onClick}
      render={
        <DrawerMenuItem
          className={className}
          disabled={disabled}
          render={activeRender}
          variant={itemVariant}
        />
      }
      {...drawerCloseProps}
    >
      {children}
    </DrawerClose>
  );
}
