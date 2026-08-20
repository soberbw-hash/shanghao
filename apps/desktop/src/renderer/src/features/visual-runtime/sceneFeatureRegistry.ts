export type SceneFeatureId =
  | "weather-window"
  | "date-calendar"
  | "wall-clock"
  | "characters"
  | "workstations"
  | "collection-shelf"
  | "chat"
  | "screen-share"
  | "recording";

export type SceneCapability =
  | "local-time"
  | "weather-data"
  | "presence"
  | "activity"
  | "chat-data"
  | "screen-capture"
  | "local-storage";

export interface SceneFeatureManifest {
  id: SceneFeatureId;
  version: 1;
  type: "ambient" | "presence" | "content" | "communication" | "capture";
  visual: boolean;
  interactive: boolean;
  audio: boolean;
  network: boolean;
  backgroundAllowed: boolean;
  heavyResource: boolean;
  privacySensitive: boolean;
  defaultSlot: "wall-left" | "wall-center" | "wall-right" | "floor" | "overlay" | null;
  pausableWhenHidden: boolean;
  requiresRealtime: boolean;
  dataRate: "static" | "event" | "realtime";
  capabilities: SceneCapability[];
  visualPriority: "ambient" | "content" | "realtime";
}

export interface SceneManifest {
  id: string;
  theme: "shanghao-room";
  composition: Record<Exclude<SceneFeatureManifest["defaultSlot"], null>, SceneFeatureId[]>;
}

export class SceneFeatureRegistry {
  private readonly features = new Map<SceneFeatureId, SceneFeatureManifest>();

  register(manifest: SceneFeatureManifest): void {
    if (this.features.has(manifest.id)) {
      throw new Error(`Scene feature already registered: ${manifest.id}`);
    }
    if (manifest.requiresRealtime && manifest.pausableWhenHidden) {
      throw new Error(`Realtime scene feature cannot pause its business state: ${manifest.id}`);
    }
    this.features.set(manifest.id, Object.freeze({ ...manifest }));
  }

  has(id: SceneFeatureId): boolean {
    return this.features.has(id);
  }

  list(capability?: SceneCapability): SceneFeatureManifest[] {
    return [...this.features.values()].filter(
      (feature) => !capability || feature.capabilities.includes(capability),
    );
  }
}

export const sceneFeatureRegistry = new SceneFeatureRegistry();

const builtInFeatures: SceneFeatureManifest[] = [
  {
    id: "weather-window",
    version: 1,
    type: "ambient",
    visual: true,
    interactive: false,
    audio: false,
    network: true,
    backgroundAllowed: false,
    heavyResource: false,
    privacySensitive: false,
    defaultSlot: "wall-left",
    pausableWhenHidden: true,
    requiresRealtime: false,
    dataRate: "event",
    capabilities: ["weather-data"],
    visualPriority: "ambient",
  },
  {
    id: "date-calendar",
    version: 1,
    type: "ambient",
    visual: true,
    interactive: true,
    audio: false,
    network: false,
    backgroundAllowed: false,
    heavyResource: false,
    privacySensitive: false,
    defaultSlot: "wall-center",
    pausableWhenHidden: true,
    requiresRealtime: false,
    dataRate: "static",
    capabilities: ["local-time"],
    visualPriority: "ambient",
  },
  {
    id: "wall-clock",
    version: 1,
    type: "ambient",
    visual: true,
    interactive: true,
    audio: false,
    network: false,
    backgroundAllowed: false,
    heavyResource: false,
    privacySensitive: false,
    defaultSlot: "wall-right",
    pausableWhenHidden: true,
    requiresRealtime: false,
    dataRate: "event",
    capabilities: ["local-time"],
    visualPriority: "ambient",
  },
  {
    id: "characters",
    version: 1,
    type: "presence",
    visual: true,
    interactive: true,
    audio: false,
    network: true,
    backgroundAllowed: true,
    heavyResource: false,
    privacySensitive: false,
    defaultSlot: "floor",
    pausableWhenHidden: false,
    requiresRealtime: true,
    dataRate: "realtime",
    capabilities: ["presence"],
    visualPriority: "realtime",
  },
  {
    id: "workstations",
    version: 1,
    type: "content",
    visual: true,
    interactive: true,
    audio: false,
    network: true,
    backgroundAllowed: false,
    heavyResource: false,
    privacySensitive: false,
    defaultSlot: "floor",
    pausableWhenHidden: true,
    requiresRealtime: false,
    dataRate: "event",
    capabilities: ["activity"],
    visualPriority: "content",
  },
  {
    id: "collection-shelf",
    version: 1,
    type: "content",
    visual: true,
    interactive: true,
    audio: false,
    network: false,
    backgroundAllowed: false,
    heavyResource: false,
    privacySensitive: true,
    defaultSlot: "floor",
    pausableWhenHidden: true,
    requiresRealtime: false,
    dataRate: "event",
    capabilities: ["local-storage", "chat-data"],
    visualPriority: "content",
  },
  {
    id: "chat",
    version: 1,
    type: "communication",
    visual: true,
    interactive: true,
    audio: false,
    network: true,
    backgroundAllowed: true,
    heavyResource: false,
    privacySensitive: true,
    defaultSlot: "overlay",
    pausableWhenHidden: false,
    requiresRealtime: true,
    dataRate: "realtime",
    capabilities: ["chat-data"],
    visualPriority: "realtime",
  },
  {
    id: "screen-share",
    version: 1,
    type: "capture",
    visual: true,
    interactive: true,
    audio: false,
    network: true,
    backgroundAllowed: true,
    heavyResource: true,
    privacySensitive: true,
    defaultSlot: "overlay",
    pausableWhenHidden: false,
    requiresRealtime: true,
    dataRate: "realtime",
    capabilities: ["screen-capture"],
    visualPriority: "realtime",
  },
  {
    id: "recording",
    version: 1,
    type: "capture",
    visual: false,
    interactive: true,
    audio: true,
    network: false,
    backgroundAllowed: true,
    heavyResource: false,
    privacySensitive: true,
    defaultSlot: null,
    pausableWhenHidden: false,
    requiresRealtime: true,
    dataRate: "realtime",
    capabilities: ["local-storage"],
    visualPriority: "realtime",
  },
];

builtInFeatures.forEach((feature) => sceneFeatureRegistry.register(feature));

export const defaultRoomSceneManifest: SceneManifest = {
  id: "shanghao-room-default",
  theme: "shanghao-room",
  composition: {
    "wall-left": ["weather-window"],
    "wall-center": ["date-calendar"],
    "wall-right": ["wall-clock"],
    floor: ["workstations", "characters", "collection-shelf"],
    overlay: ["chat", "screen-share"],
  },
};
