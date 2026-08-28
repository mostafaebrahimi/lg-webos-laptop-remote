import type { TvDesktopApi } from "./index";

declare global {
  interface Window {
    tvApi: TvDesktopApi;
  }
}

export {};
