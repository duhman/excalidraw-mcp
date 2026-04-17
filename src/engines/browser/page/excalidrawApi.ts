import {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  restore,
  restoreAppState,
  restoreElements,
  restoreLibraryItems,
} from "@excalidraw/excalidraw";

const api = {
  convertToExcalidrawElements,
  exportToBlob,
  exportToSvg,
  restore,
  restoreAppState,
  restoreElements,
  restoreLibraryItems,
};

(globalThis as unknown as { __excalidrawApi?: typeof api }).__excalidrawApi =
  api;

export {};
