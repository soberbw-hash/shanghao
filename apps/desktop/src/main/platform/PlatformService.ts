export type SupportedDesktopPlatform = "windows" | "macos" | "unsupported";

export interface PlatformCapabilities {
  desktopPlatform: SupportedDesktopPlatform;
  nodePlatform: NodeJS.Platform;
  screenCapture: boolean;
  systemAudioLoopback: boolean;
  foregroundActivity: boolean;
  firewallIntegration: boolean;
  startupIntegration: boolean;
}

export interface PlatformService {
  readonly capabilities: PlatformCapabilities;
  readonly isWindows: boolean;
  readonly isMacOS: boolean;
}

abstract class BasePlatformService implements PlatformService {
  abstract readonly capabilities: PlatformCapabilities;

  get isWindows(): boolean {
    return this.capabilities.desktopPlatform === "windows";
  }

  get isMacOS(): boolean {
    return this.capabilities.desktopPlatform === "macos";
  }
}

export class WindowsPlatformService extends BasePlatformService {
  readonly capabilities: PlatformCapabilities = {
    desktopPlatform: "windows",
    nodePlatform: "win32",
    screenCapture: true,
    systemAudioLoopback: true,
    foregroundActivity: true,
    firewallIntegration: true,
    startupIntegration: true,
  };
}

export class MacOSPlatformService extends BasePlatformService {
  readonly capabilities: PlatformCapabilities = {
    desktopPlatform: "macos",
    nodePlatform: "darwin",
    screenCapture: true,
    systemAudioLoopback: false,
    foregroundActivity: false,
    firewallIntegration: false,
    startupIntegration: false,
  };
}

class UnsupportedPlatformService extends BasePlatformService {
  readonly capabilities: PlatformCapabilities;

  constructor(nodePlatform: NodeJS.Platform) {
    super();
    this.capabilities = {
      desktopPlatform: "unsupported",
      nodePlatform,
      screenCapture: false,
      systemAudioLoopback: false,
      foregroundActivity: false,
      firewallIntegration: false,
      startupIntegration: false,
    };
  }
}

const createPlatformService = (nodePlatform: NodeJS.Platform): PlatformService => {
  if (nodePlatform === "win32") return new WindowsPlatformService();
  if (nodePlatform === "darwin") return new MacOSPlatformService();
  return new UnsupportedPlatformService(nodePlatform);
};

// Reading process.platform is intentionally centralized here for new 3.0 code.
// Existing Windows integration modules are migrated incrementally so their proven
// behavior is not changed merely to satisfy a structural metric.
export const platformService = createPlatformService(process.platform);
