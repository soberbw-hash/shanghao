import { useState } from "react";

/** Account portraits use square cropping, never the room animal's sprite crop. */
export const AccountAvatar = ({
  name,
  src,
  fallbackSrc,
  className = "",
  dimmed = false,
}: {
  name: string;
  src?: string;
  fallbackSrc?: string;
  className?: string;
  dimmed?: boolean;
}) => {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<string>();
  const visibleSource =
    src && !failedSources.includes(src)
      ? src
      : fallbackSrc && !failedSources.includes(fallbackSrc)
        ? fallbackSrc
        : undefined;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#eaf2fc",
        color: "#527399",
        filter: dimmed ? "saturate(0.5)" : undefined,
      }}
    >
      <span aria-label={name}>{Array.from(name.trim())[0] || "上"}</span>
      {visibleSource ? (
        <img
          key={visibleSource}
          src={visibleSource}
          alt={name}
          draggable={false}
          onError={() => setFailedSources((sources) => [...sources, visibleSource])}
          onLoad={() => setLoadedSource(visibleSource)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loadedSource === visibleSource ? 1 : 0,
          }}
        />
      ) : null}
    </span>
  );
};
