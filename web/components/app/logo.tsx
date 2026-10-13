/*
 * Vendored/adapted from Coss Cal.com example at commit 19620ae8cae81e30775f2cde03829326cb4916b2
 * Source path: components/logo.tsx
 * Upstream license: AGPL-3.0-or-later (https://github.com/cosscom/coss)
 * Modified: 2026-08-21
 * Local modifications: ported from next/link to react-router NavLink; replaced Cal.com brand with Workmory.
 */
import type { ComponentPropsWithoutRef } from "react";
import { NavLink } from "react-router-dom";

type LogoProps = Omit<ComponentPropsWithoutRef<typeof NavLink>, "to">;

export function Logo(props: LogoProps): React.ReactElement {
  return (
    <NavLink to="/" {...props}>
      <h1 className="font-bold font-heading text-foreground text-xl leading-none [font-variation-settings:'GEOM'_50,'opsz'_32] md:text-base lg:text-lg">
        W<span className="md:max-lg:sr-only">orkmory</span>
      </h1>
    </NavLink>
  );
}
