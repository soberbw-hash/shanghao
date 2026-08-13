import {
  BriefcaseBusiness,
  Braces,
  ChartNoAxesCombined,
  DraftingCompass,
  Palette,
  Video,
} from "lucide-react";

import type { WorkActivity } from "@private-voice/shared";

const categoryIcon = {
  development: Braces,
  design: Palette,
  engineering: DraftingCompass,
  office: BriefcaseBusiness,
  data: ChartNoAxesCombined,
  media: Video,
} satisfies Record<WorkActivity["category"], typeof Braces>;

export const WorkActivityBadge = ({ activity }: { activity: WorkActivity }) => {
  const Icon = categoryIcon[activity.category];
  return (
    <span
      className="work-activity-badge"
      data-activity-id={activity.id}
      title={`正在使用 ${activity.name}`}
      aria-label={`正在使用 ${activity.name}`}
    >
      {activity.iconDataUrl ? (
        <img src={activity.iconDataUrl} alt="" draggable={false} aria-hidden="true" />
      ) : (
        <Icon aria-hidden="true" />
      )}
    </span>
  );
};
