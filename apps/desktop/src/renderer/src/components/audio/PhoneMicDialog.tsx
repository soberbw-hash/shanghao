import { useEffect, useRef, useState } from "react";

import QRCode from "qrcode";

import {
  phoneMicSource,
  type PhoneMicMode,
  type PhoneMicState,
} from "../../features/audio/phoneMicSource";
import { useSettingsStore } from "../../store/settingsStore";

interface PhoneMicDialogProps {
  open: boolean;
  relayUrl?: string;
  onClose: () => void;
  onStream: (stream: MediaStream) => void;
  onDisconnect: () => Promise<void>;
}

export const PhoneMicDialog = ({
  open,
  relayUrl,
  onClose,
  onStream,
  onDisconnect,
}: PhoneMicDialogProps) => {
  const [state, setState] = useState<PhoneMicState>(() => phoneMicSource.getState());
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [usbDevices, setUsbDevices] = useState<{ serial: string; label: string }[]>([]);
  const [usbSerial, setUsbSerial] = useState<string>();
  const saveSettings = useSettingsStore((value) => value.saveSettings);
  const lastTrackRef = useRef<MediaStreamTrack | undefined>(undefined);
  const onStreamRef = useRef(onStream);
  onStreamRef.current = onStream;

  useEffect(() => {
    return phoneMicSource.subscribe((next, stream) => {
      setState(next);
      const track = stream?.getAudioTracks()[0];
      if (next.status === "streaming" && track && track !== lastTrackRef.current) {
        lastTrackRef.current = track;
        onStreamRef.current(stream!);
      }
    });
  }, []);

  useEffect(() => {
    const mode = useSettingsStore.getState().settings?.phoneMicMode ?? "web";
    if (open && (relayUrl || mode === "usb") && phoneMicSource.getState().status === "idle") {
      void phoneMicSource.start(relayUrl ?? "", mode).catch(() => undefined);
    }
  }, [open, relayUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!state.pairingUrl) {
      setQrDataUrl(undefined);
      return;
    }
    void QRCode.toDataURL(state.pairingUrl, {
      margin: 1,
      width: 220,
      errorCorrectionLevel: "M",
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    });
    return () => {
      cancelled = true;
    };
  }, [state.pairingUrl]);

  useEffect(() => {
    if (!open || state.mode !== "usb") return;
    let cancelled = false;
    void window.desktopApi.audio
      .listPhoneMicUsbDevices()
      .then((devices) => {
        if (cancelled) return;
        setUsbDevices(devices);
        setUsbSerial((previous) =>
          devices.some((device) => device.serial === previous) ? previous : devices[0]?.serial,
        );
      })
      .catch(() => {
        if (!cancelled) setUsbDevices([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, state.mode]);

  if (!open) return null;
  const connect = (mode: PhoneMicMode, selectedSerial?: string) => {
    if (!relayUrl && mode !== "usb") {
      setState({
        ...phoneMicSource.getState(),
        mode,
        status: "error",
        error: "请先在设置中填写中继服务器地址。",
      });
      return;
    }
    void saveSettings({ phoneMicMode: mode });
    void phoneMicSource.start(relayUrl ?? "", mode, selectedSerial).catch((error: unknown) => {
      setState({
        ...phoneMicSource.getState(),
        status: "error",
        error:
          phoneMicSource.getState().error ?? (error instanceof Error ? error.message : "连接失败"),
      });
    });
  };
  const metrics = state.metrics;
  return (
    <div
      className="phone-mic-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="phone-mic-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="使用手机麦克风"
      >
        <header>
          <div>
            <small>SHANGHAO · 上号</small>
            <h2>使用手机麦克风</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <nav className="phone-mic-tabs" aria-label="连接方式">
          {(["wifi", "usb", "web"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={state.mode === mode ? "is-active" : ""}
              onClick={() => connect(mode)}
            >
              {mode === "wifi" ? "Wi-Fi" : mode === "usb" ? "USB" : "Web"}
            </button>
          ))}
        </nav>
        {state.mode === "usb" ? (
          <div className="phone-mic-usb-options">
            <p className="phone-mic-hint">
              Android 请开启 USB 调试并连接电脑。iPhone 请使用 Wi-Fi 或 Web。
            </p>
            {usbDevices.length > 1 ? (
              <select
                aria-label="Android USB 设备"
                value={usbSerial}
                onChange={(event) => setUsbSerial(event.target.value)}
              >
                {usbDevices.map((device) => (
                  <option key={device.serial} value={device.serial}>
                    {device.label}
                  </option>
                ))}
              </select>
            ) : null}
            {usbDevices.length > 1 ? (
              <button type="button" onClick={() => connect("usb", usbSerial)}>
                连接所选设备
              </button>
            ) : null}
          </div>
        ) : (
          <p className="phone-mic-hint">
            {state.mode === "wifi"
              ? "手机连接 Wi-Fi 后扫码；同一局域网可减少音频绕行。"
              : "手机浏览器扫码，无需安装应用。"}
          </p>
        )}
        <div className="phone-mic-pairing">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="手机麦克风配对二维码" />
          ) : (
            <div className="phone-mic-qr-placeholder">
              {state.status === "error"
                ? "暂时无法生成配对码"
                : relayUrl || state.mode === "usb"
                  ? "正在生成二维码…"
                  : "请先设置中继服务器"}
            </div>
          )}
          <p className={`phone-mic-status is-${state.status}`}>
            <i />
            {state.status === "streaming"
              ? "正在传输"
              : state.status === "connected"
                ? "已连接，等待手机开始传输"
                : state.status === "pairing"
                  ? "等待手机连接"
                  : state.status === "error"
                    ? "连接失败"
                    : "未连接"}
          </p>
        </div>
        {state.error ? (
          <p className="phone-mic-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="phone-mic-signal">
          <span>信号质量</span>
          <strong>{metrics.quality}</strong>
          <span>延迟</span>
          <strong>
            {metrics.latencyMs === undefined ? "—" : `${Math.round(metrics.latencyMs)} ms`}
          </strong>
        </div>
        <div className="phone-mic-actions">
          <button type="button" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? "收起详情" : "高级详情"}
          </button>
          {state.status === "error" ? (
            <button type="button" onClick={() => connect(state.mode, usbSerial)}>
              重试连接
            </button>
          ) : (
            <button type="button" onClick={() => void onDisconnect()}>
              断开连接
            </button>
          )}
        </div>
        {advanced ? (
          <dl className="phone-mic-debug">
            <dt>模式</dt>
            <dd>{state.mode}</dd>
            <dt>编解码</dt>
            <dd>{state.mode === "usb" ? "PCM / USB" : "WebRTC / Opus"}</dd>
            <dt>抖动</dt>
            <dd>{metrics.jitterMs?.toFixed(1) ?? "—"} ms</dd>
            <dt>丢包</dt>
            <dd>{metrics.packetLossPercent?.toFixed(2) ?? "—"}%</dd>
            <dt>码率</dt>
            <dd>{metrics.bitrateKbps?.toFixed(0) ?? "—"} kbps</dd>
            <dt>接收包</dt>
            <dd>{metrics.packetsReceived ?? "—"}</dd>
          </dl>
        ) : null}
      </section>
    </div>
  );
};
