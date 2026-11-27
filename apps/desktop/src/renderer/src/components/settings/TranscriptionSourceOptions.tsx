export function TranscriptionSourceOptions({ isOffline }: { isOffline: boolean }) {
  return (
    <>
      <option value="cloud">云端</option>
      <option value="hybrid">云端 + 本地辅助</option>
      <option value="custom">自定义语音 API</option>
      {isOffline ? (
        <option value="local" hidden disabled>
          本地离线（当前配置）
        </option>
      ) : null}
    </>
  );
}
