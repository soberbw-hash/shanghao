import workstationAsset from "../../assets/scenes/shanghao-room/workstation.png";

export const WorkstationArt = ({ className = "" }: { className?: string }) => {
  return (
    <img src={workstationAsset} className={className} alt="" aria-hidden="true" draggable={false} />
  );
};
