import { memory } from "./memory";
import { graph } from "./graph";
import { operations } from "./operations";
import { profile } from "./profile";
import { shared } from "./shared";

export const zhCN = {
  ...shared,
  ...memory,
  ...graph,
  ...profile,
  ...operations,
} as const;
