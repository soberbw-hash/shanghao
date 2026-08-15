import { useLayoutEffect, useRef } from "react";
import { Gamepad2 } from "lucide-react";
import { gsap } from "gsap";

import type { GameDetectionSnapshot } from "@private-voice/shared";

import { normalizePresenceGameIconDataUrl } from "../../features/room/presenceSignal";

import apexLegendsArtwork from "../../assets/games/apex-legends.jpg";
import blackMythWukongArtwork from "../../assets/games/black-myth-wukong.jpg";
import counterStrike2Artwork from "../../assets/games/counter-strike-2.jpg";
import deltaForceArtwork from "../../assets/games/delta-force.jpg";
import dota2Artwork from "../../assets/games/dota-2.jpg";
import eldenRingArtwork from "../../assets/games/elden-ring.jpg";
import fortniteArtwork from "../../assets/games/fortnite.png";
import genshinImpactArtwork from "../../assets/games/genshin-impact.ico";
import gtaVArtwork from "../../assets/games/gta-v.jpg";
import honkaiStarRailArtwork from "../../assets/games/honkai-star-rail.ico";
import itTakesTwoArtwork from "../../assets/games/it-takes-two.jpg";
import kingdomRushArtwork from "../../assets/games/kingdom-rush.jpg";
import leagueOfLegendsArtwork from "../../assets/games/league-of-legends.svg";
import lostCastle2Artwork from "../../assets/games/lost-castle-2.jpg";
import minecraftArtwork from "../../assets/games/minecraft.png";
import monsterHunterArtwork from "../../assets/games/monster-hunter.jpg";
import narakaArtwork from "../../assets/games/naraka.jpg";
import overcooked2Artwork from "../../assets/games/overcooked-2.jpg";
import overwatch2Artwork from "../../assets/games/overwatch-2.jpg";
import palworldArtwork from "../../assets/games/palworld.jpg";
import pubgArtwork from "../../assets/games/pubg.jpg";
import rainbowSixSiegeArtwork from "../../assets/games/rainbow-six-siege.jpg";
import redDeadRedemption2Artwork from "../../assets/games/red-dead-redemption-2.jpg";
import slayTheSpireArtwork from "../../assets/games/slay-the-spire.jpg";
import valorantArtwork from "../../assets/games/valorant.png";

type SupportedGameName = NonNullable<GameDetectionSnapshot["gameName"]>;

interface GameArtwork {
  src: string;
  layout: "capsule" | "mark";
}

export const gameArtworkCatalog: Partial<Record<SupportedGameName, GameArtwork>> = {
  我的世界: { src: minecraftArtwork, layout: "mark" },
  王国保卫战: { src: kingdomRushArtwork, layout: "capsule" },
  杀戮尖塔: { src: slayTheSpireArtwork, layout: "capsule" },
  英雄联盟: { src: leagueOfLegendsArtwork, layout: "mark" },
  无畏契约: { src: valorantArtwork, layout: "mark" },
  三角洲行动: { src: deltaForceArtwork, layout: "capsule" },
  CS2: { src: counterStrike2Artwork, layout: "capsule" },
  "Dota 2": { src: dota2Artwork, layout: "capsule" },
  "Apex 英雄": { src: apexLegendsArtwork, layout: "capsule" },
  绝地求生: { src: pubgArtwork, layout: "capsule" },
  守望先锋: { src: overwatch2Artwork, layout: "capsule" },
  永劫无间: { src: narakaArtwork, layout: "capsule" },
  原神: { src: genshinImpactArtwork, layout: "mark" },
  "崩坏：星穹铁道": {
    src: honkaiStarRailArtwork,
    layout: "mark",
  },
  Fortnite: { src: fortniteArtwork, layout: "mark" },
  "GTA V": { src: gtaVArtwork, layout: "capsule" },
  "彩虹六号：围攻": {
    src: rainbowSixSiegeArtwork,
    layout: "capsule",
  },
  怪物猎人: { src: monsterHunterArtwork, layout: "capsule" },
  "黑神话：悟空": {
    src: blackMythWukongArtwork,
    layout: "capsule",
  },
  "失落城堡 2": { src: lostCastle2Artwork, layout: "capsule" },
  艾尔登法环: { src: eldenRingArtwork, layout: "capsule" },
  双人成行: { src: itTakesTwoArtwork, layout: "capsule" },
  幻兽帕鲁: { src: palworldArtwork, layout: "capsule" },
  胡闹厨房: { src: overcooked2Artwork, layout: "capsule" },
  "荒野大镖客 2": {
    src: redDeadRedemption2Artwork,
    layout: "capsule",
  },
};

export const GameMonitorContent = ({
  gameName,
  iconDataUrl,
  shouldReduceMotion = false,
}: {
  gameName: string;
  iconDataUrl?: string;
  shouldReduceMotion?: boolean;
}) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const artwork = gameArtworkCatalog[gameName as SupportedGameName];
  const runtimeIconDataUrl = normalizePresenceGameIconDataUrl(gameName, iconDataUrl);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let observer: IntersectionObserver | undefined;
    const context = gsap.context(() => {
      gsap.set("[data-game-mark]", { opacity: 1, scale: 1, y: 0 });
      gsap.set("[data-game-scan]", { opacity: shouldReduceMotion ? 0.38 : 0, x: -28 });
      if (shouldReduceMotion) return;

      const timeline = gsap
        .timeline({ repeat: -1, repeatDelay: 0.7 })
        .fromTo(
          "[data-game-mark]",
          { opacity: 0.7, scale: 0.94, y: 1 },
          { opacity: 1, scale: 1, y: 0, duration: 0.52, ease: "power2.out" },
        )
        .fromTo(
          "[data-game-scan]",
          { opacity: 0, x: -28 },
          { opacity: 0.64, x: 32, duration: 0.9, ease: "power1.inOut" },
          0.08,
        )
        .to("[data-game-scan]", { opacity: 0, duration: 0.18 });

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
  }, [shouldReduceMotion]);

  const layout = runtimeIconDataUrl ? "runtime" : (artwork?.layout ?? "fallback");

  return (
    <span
      ref={rootRef}
      className={`scene-game-monitor-content scene-game-monitor-content--${layout}`}
      aria-label={`正在玩 ${gameName}`}
    >
      {runtimeIconDataUrl ? (
        <img
          className="scene-game-monitor-runtime-icon"
          src={runtimeIconDataUrl}
          alt=""
          draggable={false}
          aria-hidden="true"
          data-game-mark
        />
      ) : artwork ? (
        <img
          className="scene-game-monitor-art"
          src={artwork.src}
          alt=""
          draggable={false}
          aria-hidden="true"
          data-game-mark
        />
      ) : (
        <Gamepad2 aria-hidden="true" data-game-mark />
      )}
      <span className="scene-game-monitor-scan" data-game-scan aria-hidden="true" />
    </span>
  );
};
