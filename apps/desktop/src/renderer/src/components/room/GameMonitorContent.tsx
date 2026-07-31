import { Gamepad2 } from "lucide-react";

import type { GameDetectionSnapshot } from "@private-voice/shared";

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
  shortLabel: string;
  layout: "capsule" | "mark";
}

export const gameArtworkCatalog: Partial<Record<SupportedGameName, GameArtwork>> = {
  我的世界: { src: minecraftArtwork, shortLabel: "我的世界", layout: "mark" },
  王国保卫战: { src: kingdomRushArtwork, shortLabel: "王国保卫战", layout: "capsule" },
  杀戮尖塔: { src: slayTheSpireArtwork, shortLabel: "杀戮尖塔", layout: "capsule" },
  英雄联盟: { src: leagueOfLegendsArtwork, shortLabel: "英雄联盟", layout: "mark" },
  无畏契约: { src: valorantArtwork, shortLabel: "无畏契约", layout: "mark" },
  三角洲行动: { src: deltaForceArtwork, shortLabel: "三角洲行动", layout: "capsule" },
  CS2: { src: counterStrike2Artwork, shortLabel: "CS2", layout: "capsule" },
  "Dota 2": { src: dota2Artwork, shortLabel: "Dota 2", layout: "capsule" },
  "Apex 英雄": { src: apexLegendsArtwork, shortLabel: "Apex 英雄", layout: "capsule" },
  绝地求生: { src: pubgArtwork, shortLabel: "绝地求生", layout: "capsule" },
  守望先锋: { src: overwatch2Artwork, shortLabel: "守望先锋", layout: "capsule" },
  永劫无间: { src: narakaArtwork, shortLabel: "永劫无间", layout: "capsule" },
  原神: { src: genshinImpactArtwork, shortLabel: "原神", layout: "mark" },
  "崩坏：星穹铁道": {
    src: honkaiStarRailArtwork,
    shortLabel: "星穹铁道",
    layout: "mark",
  },
  Fortnite: { src: fortniteArtwork, shortLabel: "Fortnite", layout: "mark" },
  "GTA V": { src: gtaVArtwork, shortLabel: "GTA V", layout: "capsule" },
  "彩虹六号：围攻": {
    src: rainbowSixSiegeArtwork,
    shortLabel: "彩虹六号",
    layout: "capsule",
  },
  怪物猎人: { src: monsterHunterArtwork, shortLabel: "怪物猎人", layout: "capsule" },
  "黑神话：悟空": {
    src: blackMythWukongArtwork,
    shortLabel: "黑神话",
    layout: "capsule",
  },
  "失落城堡 2": { src: lostCastle2Artwork, shortLabel: "失落城堡 2", layout: "capsule" },
  艾尔登法环: { src: eldenRingArtwork, shortLabel: "艾尔登法环", layout: "capsule" },
  双人成行: { src: itTakesTwoArtwork, shortLabel: "双人成行", layout: "capsule" },
  幻兽帕鲁: { src: palworldArtwork, shortLabel: "幻兽帕鲁", layout: "capsule" },
  胡闹厨房: { src: overcooked2Artwork, shortLabel: "胡闹厨房", layout: "capsule" },
  "荒野大镖客 2": {
    src: redDeadRedemption2Artwork,
    shortLabel: "荒野大镖客 2",
    layout: "capsule",
  },
};

export const GameMonitorContent = ({ gameName }: { gameName: string }) => {
  const artwork = gameArtworkCatalog[gameName as SupportedGameName];
  if (!artwork) {
    return (
      <span className="scene-game-monitor-content scene-game-monitor-content--fallback">
        <Gamepad2 aria-hidden="true" />
        <span className="scene-game-monitor-label">{gameName}</span>
      </span>
    );
  }

  return (
    <span
      className={`scene-game-monitor-content scene-game-monitor-content--${artwork.layout}`}
      aria-label={`正在玩 ${gameName}`}
    >
      <img
        className="scene-game-monitor-art"
        src={artwork.src}
        alt=""
        draggable={false}
        aria-hidden="true"
      />
      <span className="scene-game-monitor-label">{artwork.shortLabel}</span>
    </span>
  );
};
