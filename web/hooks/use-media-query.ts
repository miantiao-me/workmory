import { useMediaQuery as useMediaQueryBase } from "usehooks-ts";

type MediaQuery = "max-md" | "md:max-lg";

const mediaQueries: Record<MediaQuery, string> = {
  "max-md": "(max-width: 767px)",
  "md:max-lg": "(min-width: 768px) and (max-width: 1023px)",
};

export function useMediaQuery(query: MediaQuery): boolean {
  return useMediaQueryBase(mediaQueries[query]);
}
