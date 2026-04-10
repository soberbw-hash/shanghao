const steps = [
  "Open a room when your group is ready",
  "Share the host address over Tailscale",
  "Use the mute shortcut whenever you need quiet fast",
];

export const SetupChecklist = () => (
  <div className="space-y-3">
    {steps.map((step, index) => (
      <div key={step} className="flex items-center gap-3 rounded-[14px] border border-white/8 bg-white/5 px-4 py-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/8 text-xs font-semibold text-white/80">
          {index + 1}
        </span>
        <span className="text-sm text-white/70">{step}</span>
      </div>
    ))}
  </div>
);
