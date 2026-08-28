import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { gsap } from "gsap";

import type { ChatMessage } from "@private-voice/shared";

import { motionDuration, motionEase } from "../../features/motion/motionSystem";

type ChatImage = NonNullable<ChatMessage["image"]>;

interface ChatImageLightboxProps {
  image: ChatImage;
  index: number;
  total: number;
  direction: -1 | 0 | 1;
  originElement: HTMLButtonElement | null;
  reduceMotion: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onCopy: (dataUrl: string) => void;
  onClosed: () => void;
}

const getSpatialTransform = (source: DOMRect, target: DOMRect) => {
  const sourceCenterX = source.left + source.width / 2;
  const sourceCenterY = source.top + source.height / 2;
  const targetCenterX = target.left + target.width / 2;
  const targetCenterY = target.top + target.height / 2;
  const scale = Math.max(
    0.04,
    Math.min(source.width / Math.max(target.width, 1), source.height / Math.max(target.height, 1)),
  );

  return {
    x: sourceCenterX - targetCenterX,
    y: sourceCenterY - targetCenterY,
    scale,
  };
};

export const ChatImageLightbox = ({
  image,
  index,
  total,
  direction,
  originElement,
  reduceMotion,
  onPrevious,
  onNext,
  onCopy,
  onClosed,
}: ChatImageLightboxProps) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const initialOriginRef = useRef(originElement);
  const previousImageUrlRef = useRef(image.dataUrl);

  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    const imageElement = imageRef.current;
    const controls = controlsRef.current;
    if (!backdrop || !imageElement || !controls) return;

    let animationFrame = 0;
    let cancelled = false;
    const context = gsap.context(() => {
      const reveal = () => {
        if (cancelled || closingRef.current) return;
        const targetRect = imageElement.getBoundingClientRect();
        const sourceRect = initialOriginRef.current?.getBoundingClientRect();

        gsap.set(backdrop, { opacity: 0 });
        gsap.set(controls, { opacity: 0, y: 6 });
        // Promote the two moving surfaces before the first animated frame so
        // the compositor does not pay the layer-promotion cost mid-transition.
        gsap.set(imageElement, { willChange: "transform, opacity" });
        gsap.set(controls, { willChange: "transform, opacity" });

        if (reduceMotion || !sourceRect) {
          gsap.set(imageElement, { opacity: 0, scale: reduceMotion ? 1 : 0.985, x: 0, y: 0 });
        } else {
          gsap.set(imageElement, {
            ...getSpatialTransform(sourceRect, targetRect),
            opacity: 0.72,
            transformOrigin: "50% 50%",
          });
        }

        const timeline = gsap.timeline({
          defaults: { overwrite: "auto" },
          onComplete: () => {
            gsap.set(imageElement, { clearProps: "willChange" });
            gsap.set(controls, { clearProps: "willChange" });
          },
        });
        timeline
          .to(backdrop, {
            opacity: 1,
            duration: reduceMotion ? motionDuration.instant : motionDuration.compact,
            ease: motionEase.standard,
          })
          .to(
            imageElement,
            {
              opacity: 1,
              x: 0,
              y: 0,
              scale: 1,
              duration: reduceMotion ? motionDuration.instant : motionDuration.relaxed,
              ease: motionEase.spatial,
            },
            0,
          )
          .to(
            controls,
            {
              opacity: 1,
              y: 0,
              duration: reduceMotion ? motionDuration.instant : motionDuration.compact,
              ease: motionEase.standard,
            },
            reduceMotion ? 0 : 0.12,
          );
      };

      const revealAfterDecode = async () => {
        try {
          if (imageElement.decode) await imageElement.decode();
        } catch {
          // A decode rejection does not mean the browser cannot display it.
        }
        if (cancelled || closingRef.current) return;
        animationFrame = window.requestAnimationFrame(reveal);
      };
      void revealAfterDecode();
    }, surfaceRef);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      context.revert();
    };
  }, [reduceMotion]);

  useLayoutEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement || previousImageUrlRef.current === image.dataUrl) return;
    previousImageUrlRef.current = image.dataUrl;

    if (reduceMotion) {
      gsap.set(imageElement, { clearProps: "transform,opacity" });
      return;
    }

    gsap.killTweensOf(imageElement);
    gsap.fromTo(
      imageElement,
      { x: direction * 26, opacity: 0.18, scale: 0.988 },
      {
        x: 0,
        opacity: 1,
        scale: 1,
        duration: motionDuration.normal,
        ease: motionEase.spatial,
        overwrite: "auto",
        onComplete: () => gsap.set(imageElement, { clearProps: "willChange" }),
        willChange: "transform, opacity",
      },
    );
  }, [direction, image.dataUrl, reduceMotion]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    const backdrop = backdropRef.current;
    const imageElement = imageRef.current;
    const controls = controlsRef.current;
    if (!backdrop || !imageElement || !controls || reduceMotion) {
      onClosed();
      return;
    }

    gsap.killTweensOf([backdrop, imageElement, controls]);
    const targetRect = imageElement.getBoundingClientRect();
    const sourceRect = originElement?.isConnected ? originElement.getBoundingClientRect() : null;
    const destination = sourceRect
      ? getSpatialTransform(sourceRect, targetRect)
      : { x: 0, y: 4, scale: 0.975 };

    const timeline = gsap.timeline({ onComplete: onClosed, defaults: { overwrite: "auto" } });
    timeline
      .to(controls, {
        opacity: 0,
        y: 4,
        duration: motionDuration.fast,
        ease: motionEase.inOut,
      })
      .to(
        imageElement,
        {
          ...destination,
          opacity: sourceRect ? 0.68 : 0,
          duration: motionDuration.normal,
          ease: motionEase.inOut,
          willChange: "transform, opacity",
        },
        0,
      )
      .to(
        backdrop,
        {
          opacity: 0,
          duration: motionDuration.compact,
          ease: motionEase.inOut,
        },
        0.04,
      );
  }, [onClosed, originElement, reduceMotion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") onPrevious();
      if (event.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, onNext, onPrevious]);

  return createPortal(
    <div
      ref={backdropRef}
      className="chat-image-preview-backdrop"
      style={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={surfaceRef} className="chat-image-preview-surface">
        <img
          ref={imageRef}
          key={image.dataUrl}
          src={image.dataUrl}
          alt={image.fileName || "聊天图片"}
          width={image.width}
          height={image.height}
          decoding="async"
          loading="eager"
          style={{ opacity: 0 }}
          draggable={false}
          onContextMenu={(event) => {
            event.preventDefault();
            onCopy(image.dataUrl);
          }}
        />
      </div>
      <div ref={controlsRef} className="chat-image-preview-controls" style={{ opacity: 0 }}>
        <button
          type="button"
          className="chat-image-preview-close"
          onClick={close}
          aria-label="关闭图片预览"
        >
          <X className="h-5 w-5" />
        </button>
        {total > 1 ? (
          <>
            <button
              type="button"
              className="chat-image-preview-nav is-previous"
              onClick={onPrevious}
              aria-label="查看上一张图片"
            >
              <ChevronLeft className="size-8" strokeWidth={2.4} aria-hidden="true" />
            </button>
            <span className="chat-image-preview-count">
              {index + 1} / {total}
            </span>
            <button
              type="button"
              className="chat-image-preview-nav is-next"
              onClick={onNext}
              aria-label="查看下一张图片"
            >
              <ChevronRight className="size-8" strokeWidth={2.4} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
};
