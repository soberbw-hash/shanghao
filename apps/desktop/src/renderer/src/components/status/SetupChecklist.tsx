const steps = [
  "人齐了就开房，把房间长期保持成一个固定入口",
  "把房主地址发给朋友，让他们直接粘贴加入",
  "需要安静时，随时用静音或按键说话控制自己",
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
