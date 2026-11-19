import { useEffect, useId, useRef, type RefObject } from "react";

const rimWidth = 14;

/** Red and green encode the inward sampling offset at the rounded edge. */
function drawRim(width: number, height: number, radius: number): string | undefined {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width / 2);
  canvas.height = Math.ceil(height / 2);
  const context = canvas.getContext("2d");
  if (!context) return;
  const map = context.createImageData(canvas.width, canvas.height);
  for (let row = 0; row < canvas.height; row++) {
    const y = ((row + 0.5) / canvas.height - 0.5) * height;
    for (let col = 0; col < canvas.width; col++) {
      const x = ((col + 0.5) / canvas.width - 0.5) * width;
      const edgeX = Math.abs(x) - (width / 2 - radius);
      const edgeY = Math.abs(y) - (height / 2 - radius);
      const cornerX = Math.max(edgeX, 0);
      const cornerY = Math.max(edgeY, 0);
      const cornerLength = Math.hypot(cornerX, cornerY);
      const distance = cornerLength + Math.min(Math.max(edgeX, edgeY), 0) - radius;
      const depth = Math.max(0, Math.min(1, 1 + distance / rimWidth));
      const horizontal = cornerLength ? cornerX / cornerLength : Number(edgeX > edgeY);
      const vertical = cornerLength ? cornerY / cornerLength : Number(edgeY >= edgeX);
      const strength = 100 * depth ** 2;
      const pixel = (row * canvas.width + col) * 4;
      map.data[pixel] = 128 - Math.sign(x) * horizontal * strength;
      map.data[pixel + 1] = 128 - Math.sign(y) * vertical * strength;
      map.data[pixel + 2] = 128;
      map.data[pixel + 3] = 255;
    }
  }
  context.putImageData(map, 0, 0);
  return canvas.toDataURL("image/png");
}

export function ApplicationAudioGlassRim({
  dialog,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
}) {
  const filterId = useId();
  const map = useRef<SVGFEImageElement>(null);

  useEffect(() => {
    const surface = dialog.current;
    const image = map.current;
    if (!surface || !image || !CSS.supports("backdrop-filter", "url(#refraction)")) return;
    // The map is regenerated only when the card is resized, without sampling the desktop.
    const observer = new ResizeObserver(([entry]) => {
      const size = entry?.borderBoxSize[0];
      if (!size || size.inlineSize < 48 || size.blockSize < 48) return;
      const radius = Number.parseFloat(getComputedStyle(surface).borderTopLeftRadius);
      const url = drawRim(size.inlineSize, size.blockSize, radius);
      if (!url) return;
      image.setAttribute("width", String(size.inlineSize));
      image.setAttribute("height", String(size.blockSize));
      image.setAttribute("href", url);
      surface.style.setProperty("--audio-glass-rim", `url("#${filterId}")`);
    });
    observer.observe(surface, { box: "border-box" });
    return () => {
      observer.disconnect();
      surface.style.removeProperty("--audio-glass-rim");
    };
  }, [dialog, filterId]);

  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="absolute">
      <filter id={filterId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage ref={map} x="0" y="0" preserveAspectRatio="none" result="rim" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="rim"
          scale="24"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}
