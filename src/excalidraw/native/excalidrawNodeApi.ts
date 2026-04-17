const nodeGlobal = globalThis as Record<string, any>;

const mockCanvasContext = new Proxy(
  {
    filter: "none",
    canvas: {},
    font: "20px sans-serif",
    measureText(text: string) {
      return {
        width: String(text ?? "").length * 8,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 4,
      };
    },
  },
  {
    get(target, property) {
      if (property in target) {
        return target[property as keyof typeof target];
      }
      return () => undefined;
    },
  },
);

function createMockElement() {
  return {
    style: {},
    classList: {
      add() {
        return undefined;
      },
      remove() {
        return undefined;
      },
    },
    appendChild() {
      return undefined;
    },
    remove() {
      return undefined;
    },
    removeChild() {
      return undefined;
    },
    setAttribute() {
      return undefined;
    },
    getContext() {
      return mockCanvasContext;
    },
  };
}

nodeGlobal.window ??= nodeGlobal;
nodeGlobal.Element ??= class {};
nodeGlobal.HTMLElement ??= class extends nodeGlobal.Element {};
nodeGlobal.SVGElement ??= class extends nodeGlobal.Element {};
nodeGlobal.window.location ??= {
  origin: "http://localhost",
  href: "http://localhost/",
};
nodeGlobal.window.EXCALIDRAW_EXPORT_SOURCE ??= "http://localhost";
nodeGlobal.window.addEventListener ??= () => undefined;
nodeGlobal.window.removeEventListener ??= () => undefined;
nodeGlobal.navigator ??= {
  userAgent: "node",
  platform: "Node",
};
nodeGlobal.FontFace ??= class {
  family: string;
  source: string;
  descriptors: Record<string, unknown> | undefined;

  constructor(
    family: string,
    source: string,
    descriptors?: Record<string, unknown>,
  ) {
    this.family = family;
    this.source = source;
    this.descriptors = descriptors;
  }

  load() {
    return Promise.resolve(this);
  }
};
nodeGlobal.document ??= {
  body: {},
  documentElement: {},
  fonts: {
    add() {
      return undefined;
    },
    ready: Promise.resolve(),
  },
  createElement() {
    return createMockElement();
  },
  createElementNS() {
    return createMockElement();
  },
};
nodeGlobal.matchMedia ??= (() => ({
  matches: false,
  addEventListener() {
    return undefined;
  },
  removeEventListener() {
    return undefined;
  },
  addListener() {
    return undefined;
  },
  removeListener() {
    return undefined;
  },
}));
nodeGlobal.devicePixelRatio ??= 1;
nodeGlobal.performance ??= {
  now: () => Date.now(),
};

const excalidraw = await import("@excalidraw/excalidraw");

export const {
  convertToExcalidrawElements,
  restore,
  restoreAppState,
  restoreElements,
  restoreLibraryItems,
} = excalidraw;
