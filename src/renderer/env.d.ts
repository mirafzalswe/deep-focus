import type { DeepFocusApi } from '../preload/index';

declare global {
  interface Window {
    deepFocus: DeepFocusApi;
  }
}

export {};
