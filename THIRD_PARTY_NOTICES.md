# Third-party notices

## Phone microphone pairing QR codes

- Package: `qrcode` `1.5.4`
- Source: https://github.com/soldair/node-qrcode
- License: MIT
- Purpose: renders one-time phone pairing URLs in the desktop connection dialog.

MicYou (https://github.com/LanRhyme/MicYou) was reviewed as an architectural
reference. No MicYou source code, models, or assets are bundled or copied into
ShangHao. Android SDK Platform-Tools is a separately installed developer tool,
not redistributed with the app.

## DeepFilterNet 3 noise suppression

- Package: `deepfilternet3-noise-filter` `1.2.1`
- Package source: https://github.com/mezonai/mezon-noise-suppression
- Model source: https://github.com/Rikorose/DeepFilterNet
- License: Apache License 2.0 or MIT

ShangHao uses the Apache License 2.0 option. The package license text is included
with the packaged application under `resources/licenses/`. The matching
DeepFilterNet 3 WebAssembly runtime and ONNX model are distributed locally with
the application. Microphone samples are processed on the user's computer and are
not uploaded to a noise-suppression service.

## Noto Sans SC Variable

- Package: `@fontsource-variable/noto-sans-sc` `5.2.10`
- Typeface: Noto Sans SC, Google Inc.
- Packaging: Fontsource
- License: SIL Open Font License 1.1

The complete license text is included with the packaged application under
`resources/licenses/NotoSansSC-OFL-1.1.txt`.

## Game identification artwork

ShangHao bundles small official-site or official-store artwork solely to identify
a locally detected game on a member's workstation monitor. Game names, logos,
trademarks, and artwork remain the property of their respective publishers and
are not used to imply sponsorship or endorsement. Source details are recorded in
`apps/desktop/src/renderer/src/assets/games/SOURCES.md`.
