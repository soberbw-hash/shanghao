import type { AppSettings, AudioDeviceDescriptor } from "@private-voice/shared";

import { InputDevicePicker } from "../audio/InputDevicePicker";
import { OutputDevicePicker } from "../audio/OutputDevicePicker";
import { Switch } from "../base/Switch";
import { SettingsItemRow } from "./SettingsItemRow";
import { SettingsSection } from "./SettingsSection";

export const AudioSettingsCard = ({
  settings,
  inputDevices,
  outputDevices,
  onChange,
}: {
  settings: AppSettings;
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  onChange: (patch: Partial<AppSettings>) => void;
}) => (
  <SettingsSection title="Audio devices" description="Choose the default path for voice in and voice out.">
    <div className="space-y-3">
      <SettingsItemRow label="Input device">
        <InputDevicePicker
          devices={inputDevices}
          value={settings.preferredInputDeviceId}
          onChange={(preferredInputDeviceId) => onChange({ preferredInputDeviceId })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="Output device">
        <OutputDevicePicker
          devices={outputDevices}
          value={settings.preferredOutputDeviceId}
          onChange={(preferredOutputDeviceId) => onChange({ preferredOutputDeviceId })}
        />
      </SettingsItemRow>
      <SettingsItemRow label="Noise suppression" description="Uses Chromium or system-level suppression only.">
        <Switch
          isChecked={settings.isNoiseSuppressionEnabled}
          onChange={(isNoiseSuppressionEnabled) => onChange({ isNoiseSuppressionEnabled })}
        />
      </SettingsItemRow>
    </div>
  </SettingsSection>
);
