import { useState } from "react";

/** Account portraits use square cropping, never the room animal's sprite crop. */
export const AccountAvatar = ({
  name,
  src,
  className = "",
  dimmed = false,
}: {
  name: string;
  src?: string;
  className?: string;
  dimmed?: boolean;
}) => {
  const [failedSource, setFailedSource] = useState<string>();
  const [loadedSource, setLoadedSource] = useState<string>();
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
      {src && src !== failedSource ? (
        <img
          key={src}
          src={src}
          alt={name}
          draggable={false}
          onError={() => setFailedSource(src)}
          onLoad={() => setLoadedSource(src)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: loadedSource === src ? 1 : 0,
          }}
        />
      ) : null}
    </span>
  );
};
