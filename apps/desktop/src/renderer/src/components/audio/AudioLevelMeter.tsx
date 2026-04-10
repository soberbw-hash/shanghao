export const AudioLevelMeter = ({ level }: { level: number }) => (
  <div className="flex h-10 w-28 items-end gap-1">
    {Array.from({ length: 10 }, (_, index) => {
      const threshold = (index + 1) / 10;
      const isActive = level >= threshold;
      return (
        <span
          key={threshold}
          className={`w-2 rounded-full ${isActive ? "bg-sky-300" : "bg-white/10"}`}
          style={{ height: `${14 + index * 2}px` }}
        />
      );
    })}
  </div>
);
