import { useLayoutEffect, useRef } from "react";
import { gsap } from "gsap";

import type { WorkActivity } from "@private-voice/shared";

type WorkVisualMode = "code" | "design" | "media" | "engineering" | "data" | "office";

const resolveVisualMode = (activity: WorkActivity): WorkVisualMode => {
  if (activity.id === "codex" || activity.category === "development") return "code";
  const modes: Record<Exclude<WorkActivity["category"], "development">, WorkVisualMode> = {
    design: "design",
    media: "media",
    engineering: "engineering",
    data: "data",
    office: "office",
  };
  return modes[activity.category as Exclude<WorkActivity["category"], "development">];
};

const motionSelector = "[data-work-motion]";

export const WorkMonitorContent = ({
  activity,
  shouldReduceMotion = false,
}: {
  activity: WorkActivity;
  shouldReduceMotion?: boolean;
}) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const mode = resolveVisualMode(activity);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let observer: IntersectionObserver | undefined;

    const context = gsap.context(() => {
      const movingParts = gsap.utils.toArray<HTMLElement>(motionSelector);
      gsap.set(movingParts, { opacity: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 });
      if (shouldReduceMotion) return;

      const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.36 });
      if (mode === "code") {
        timeline
          .fromTo(
            "[data-code-line]",
            { opacity: 0.28, scaleX: 0.16 },
            {
              opacity: 0.92,
              scaleX: 1,
              duration: 0.42,
              stagger: 0.085,
              transformOrigin: "0% 50%",
              ease: "power2.out",
            },
          )
          .fromTo(
            "[data-code-cursor]",
            { opacity: 0.2 },
            { opacity: 1, duration: 0.22, repeat: 3, yoyo: true, ease: "none" },
            "-=0.18",
          );
      } else if (mode === "media") {
        timeline
          .fromTo(
            "[data-media-track]",
            { opacity: 0.4, scaleX: 0.42 },
            {
              opacity: 0.9,
              scaleX: 1,
              duration: 0.5,
              stagger: 0.1,
              transformOrigin: "0% 50%",
              ease: "power2.out",
            },
          )
          .fromTo(
            "[data-media-playhead]",
            { x: -18, opacity: 0.45 },
            { x: 24, opacity: 1, duration: 1.1, ease: "none" },
            0,
          );
      } else if (mode === "data") {
        timeline.fromTo(
          "[data-data-bar]",
          { opacity: 0.35, scaleY: 0.2 },
          {
            opacity: 0.95,
            scaleY: 1,
            duration: 0.48,
            stagger: 0.1,
            transformOrigin: "50% 100%",
            ease: "back.out(1.4)",
          },
        );
      } else {
        timeline.fromTo(
          motionSelector,
          { opacity: 0.36, y: 3, scaleX: 0.82 },
          {
            opacity: 0.94,
            y: 0,
            scaleX: 1,
            duration: 0.46,
            stagger: 0.1,
            transformOrigin: "50% 50%",
            ease: "power2.out",
          },
        );
      }

      observer = new IntersectionObserver(
        ([entry]) => (entry?.isIntersecting ? timeline.play() : timeline.pause()),
        { threshold: 0.05 },
      );
      observer.observe(root);
    }, rootRef);

    return () => {
      observer?.disconnect();
      context.revert();
    };
  }, [mode, shouldReduceMotion]);

  return (
    <span
      ref={rootRef}
      className={`scene-work-monitor scene-work-monitor--${mode}`}
      aria-label={`正在使用 ${activity.name}`}
    >
      {mode === "code" ? (
        <span className="scene-work-code" aria-hidden="true">
          <span className="scene-work-code-bar">
            <i />
            <i />
            <i />
          </span>
          <span className="scene-work-code-body">
            {[62, 84, 48, 74, 56].map((width, index) => (
              <i
                key={`${width}-${index}`}
                data-work-motion
                data-code-line
                style={{ width: `${width}%` }}
              />
            ))}
            <b data-work-motion data-code-cursor />
          </span>
        </span>
      ) : null}

      {mode === "design" ? (
        <span className="scene-work-design" aria-hidden="true">
          <i className="scene-work-design-canvas" data-work-motion />
          <i className="scene-work-design-circle" data-work-motion />
          <i className="scene-work-design-panel" data-work-motion />
        </span>
      ) : null}

      {mode === "media" ? (
        <span className="scene-work-media" aria-hidden="true">
          {[72, 90, 58].map((width, index) => (
            <i
              key={`${width}-${index}`}
              data-work-motion
              data-media-track
              style={{ width: `${width}%` }}
            />
          ))}
          <b data-work-motion data-media-playhead />
        </span>
      ) : null}

      {mode === "engineering" ? (
        <span className="scene-work-engineering" aria-hidden="true">
          <i className="scene-work-engineering-frame" data-work-motion />
          <i className="scene-work-engineering-diagonal" data-work-motion />
          <i className="scene-work-engineering-node one" data-work-motion />
          <i className="scene-work-engineering-node two" data-work-motion />
          <i className="scene-work-engineering-node three" data-work-motion />
        </span>
      ) : null}

      {mode === "data" ? (
        <span className="scene-work-data" aria-hidden="true">
          {[44, 78, 58, 92].map((height, index) => (
            <i
              key={`${height}-${index}`}
              data-work-motion
              data-data-bar
              style={{ height: `${height}%` }}
            />
          ))}
        </span>
      ) : null}

      {mode === "office" ? (
        <span className="scene-work-office" aria-hidden="true">
          <i className="scene-work-office-sheet" data-work-motion />
          <i className="scene-work-office-line one" data-work-motion />
          <i className="scene-work-office-line two" data-work-motion />
          <i className="scene-work-office-line three" data-work-motion />
        </span>
      ) : null}
    </span>
  );
};
